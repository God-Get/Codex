#!/usr/bin/env node

import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, parse, relative, resolve } from "node:path";
import process from "node:process";
import { authoringDiagnostic, compileAuthoringProject } from "@codex/authoring";
import type { CodexProject, Diagnostic, ValidationProfile, ValidationReport } from "@codex/core";
import { compileProject } from "@codex/importer";
import { listProfiles, loadProfile, resolveProfile } from "@codex/profiles";
import { isRegisteredValidationProfile, loadRegistry, type RegistryData } from "@codex/registry";
import {
  buildReleasePackage,
  signReleaseManifest,
  unpackReleasePackage,
  verifyReleaseManifest,
  verifyReleaseManifestSignature,
  verifyReleasePackage,
  writeEd25519KeyPair,
  writePreparedReleaseManifest
} from "@codex/release";
import { validateProjectSchema } from "@codex/schema";
import { analyzeTranslationStatus, createTranslationDraft, TranslationError } from "@codex/translation";
import { buildProjectGraph, graphToDot, inspectProject, validateProject } from "@codex/validator";

const CLI_API_VERSION = "0.2";

type CliDiagnostic = {
  code: string;
  message: string;
  source?: string;
  line?: number;
  column?: number;
};

function optionValue(args: string[], name: string): string | undefined {
  const inline = args.find((arg) => arg.startsWith(`${name}=`))?.slice(name.length + 1);
  if (inline !== undefined) return inline;
  const index = args.indexOf(name);
  const value = index >= 0 ? args[index + 1] : undefined;
  return value && !value.startsWith("--") ? value : undefined;
}

function positionalValue(args: string[]): string | undefined {
  return args.find((arg) => !arg.startsWith("--"));
}

function writeJson(value: unknown, stream: NodeJS.WriteStream = process.stdout): void {
  stream.write(`${JSON.stringify(value, null, 2)}\n`);
}

function success(command: string, result: unknown): object {
  return { ok: true, apiVersion: CLI_API_VERSION, command, result };
}

function failure(command: string, diagnostic: CliDiagnostic): object {
  return { ok: false, apiVersion: CLI_API_VERSION, command, diagnostic };
}

function genericDiagnostic(code: string, error: unknown): CliDiagnostic {
  return { code, message: error instanceof Error ? error.message : String(error) };
}

function emitFailure(command: string, diagnostic: CliDiagnostic, json: boolean, exitCode = 1): void {
  if (json) writeJson(failure(command, diagnostic), process.stderr);
  else console.error(`${diagnostic.code}: ${diagnostic.message}`);
  process.exitCode = exitCode;
}

function summarize(diagnostics: Diagnostic[]): ValidationReport["summary"] {
  const count = (severity: Diagnostic["severity"]): number => diagnostics.filter((item) => item.severity === severity).length;
  return { errors: count("error"), warnings: count("warning"), info: count("info"), total: diagnostics.length };
}

function mergedReport(diagnostics: Diagnostic[]): ValidationReport {
  const summary = summarize(diagnostics);
  return { valid: summary.errors === 0, diagnostics, summary };
}

function printHumanReport(report: ValidationReport): void {
  for (const diagnostic of report.diagnostics) {
    const location = diagnostic.path ? ` (${diagnostic.path})` : "";
    console.log(`${diagnostic.severity.toUpperCase()} ${diagnostic.code}: ${diagnostic.message}${location}`);
  }
  console.log(`SUMMARY: ${report.summary.errors} error(s), ${report.summary.warnings} warning(s), ${report.summary.info} info message(s).`);
}

async function loadJson(filePath: string, command: string, json: boolean): Promise<unknown | undefined> {
  try {
    return JSON.parse(await readFile(filePath, "utf8")) as unknown;
  } catch (error) {
    emitFailure(command, genericDiagnostic("CLI-1001", error), json, 2);
    return undefined;
  }
}

async function loadProject(filePath: string, command: string, json: boolean): Promise<CodexProject | undefined> {
  const value = await loadJson(filePath, command, json);
  if (value === undefined) return undefined;
  const diagnostics = validateProjectSchema(value);
  if (diagnostics.length > 0) {
    const report = mergedReport(diagnostics);
    if (json) writeJson(failure(command, { code: "CLI-1002", message: "Project schema validation failed", source: filePath }), process.stderr);
    else printHumanReport(report);
    process.exitCode = 1;
    return undefined;
  }
  return value as CodexProject;
}

function resolveValidationContext(profileId: string): { registry: RegistryData; semanticProfile: ValidationProfile; profileId: string; chain: string[] } {
  const base = loadRegistry();
  if (profileId === "core" || profileId === "strict") {
    if (!isRegisteredValidationProfile(profileId, base)) throw new Error(`Unknown validation profile: ${profileId}`);
    return { registry: base, semanticProfile: profileId, profileId, chain: [profileId] };
  }
  const resolved = resolveProfile(profileId);
  return { registry: resolved.registry, semanticProfile: "core", profileId, chain: resolved.chain };
}

function validateValue(value: unknown, requestedProfile: string): { report: ValidationReport; context: ReturnType<typeof resolveValidationContext> } {
  const schemaDiagnostics = validateProjectSchema(value);
  const context = resolveValidationContext(requestedProfile);
  const semanticDiagnostics = schemaDiagnostics.length === 0
    ? validateProject(value as CodexProject, { registry: context.registry, profile: context.semanticProfile }).diagnostics
    : [];
  return { report: mergedReport([...schemaDiagnostics, ...semanticDiagnostics]), context };
}

function reportToSarif(report: ValidationReport, filePath: string, registry: RegistryData): object {
  const titles = new Map(registry.diagnostics.map((item) => [item.code, item.title]));
  const rules = [...new Set(report.diagnostics.map((item) => item.code))].map((code) => ({
    id: code,
    shortDescription: { text: titles.get(code) ?? code },
    defaultConfiguration: { level: code.startsWith("ERR-") || code.startsWith("HERM-") ? "error" : code.startsWith("WARN-") ? "warning" : "note" }
  }));
  return {
    version: "2.1.0",
    $schema: "https://json.schemastore.org/sarif-2.1.0.json",
    runs: [{
      tool: { driver: { name: "CODEX Validator", version: "0.2.0", rules } },
      results: report.diagnostics.map((item) => ({
        ruleId: item.code,
        level: item.severity === "error" ? "error" : item.severity === "warning" ? "warning" : "note",
        message: { text: item.path ? `${item.message} (${item.path})` : item.message },
        locations: [{ physicalLocation: { artifactLocation: { uri: filePath } } }]
      }))
    }]
  };
}

async function validateCommand(filePath: string, args: string[]): Promise<void> {
  const command = "validate";
  const json = args.includes("--json");
  const value = await loadJson(filePath, command, json);
  if (value === undefined) return;
  const requestedProfile = optionValue(args, "--profile") ?? "core";
  let result;
  try {
    result = validateValue(value, requestedProfile);
  } catch (error) {
    emitFailure(command, genericDiagnostic("CLI-1101", error), json, 2);
    return;
  }
  const { report, context } = result;
  const outputPath = optionValue(args, "--output");
  const payload = { profile: context.profileId, profileChain: context.chain, report };
  const output = args.includes("--sarif")
    ? `${JSON.stringify(reportToSarif(report, filePath, context.registry), null, 2)}\n`
    : json ? `${JSON.stringify(success(command, payload), null, 2)}\n` : undefined;
  if (outputPath && output) {
    await writeFile(outputPath, output, "utf8");
    if (!json) console.log(`WROTE: ${outputPath}`);
  } else if (output) process.stdout.write(output);
  else {
    console.log(`PROFILE: ${context.profileId}`);
    console.log(`PROFILE CHAIN: ${context.chain.join(" -> ")}`);
    printHumanReport(report);
    console.log(report.valid ? "PASS: project conforms to CODEX checks." : "FAIL: project does not conform to CODEX checks.");
  }
  if (!report.valid) process.exitCode = 1;
}

async function authoringCommand(action: string | undefined, args: string[]): Promise<void> {
  const command = "authoring.compile";
  const json = args.includes("--json");
  const root = positionalValue(args);
  if (action !== "compile" || !root) {
    emitFailure(command, { code: "CLI-1201", message: "Usage: codex authoring compile <directory> [--output=project.json] [--profile=id] [--no-validate] [--json]" }, json, 2);
    return;
  }
  try {
    const project = await compileAuthoringProject(root, {
      projectFile: optionValue(args, "--project-file"),
      objectsDirectory: optionValue(args, "--objects-directory")
    });
    const outputPath = optionValue(args, "--output") ?? `${root.replace(/[\\/]$/, "")}/project.json`;
    await writeFile(outputPath, `${JSON.stringify(project, null, 2)}\n`, "utf8");
    const baseResult = { outputPath, project, projectId: project.id, objectCount: project.objects.length };
    const requestedProfile = optionValue(args, "--profile") ?? project.profile ?? "core";
    if (args.includes("--no-validate")) {
      if (json) writeJson(success(command, baseResult));
      else console.log(`COMPILED: ${project.id} — ${project.objects.length} objects -> ${outputPath}`);
      return;
    }
    const { report, context } = validateValue(project, requestedProfile);
    const result = { ...baseResult, profile: context.profileId, profileChain: context.chain, validation: report };
    if (json) writeJson(success(command, result));
    else {
      console.log(`COMPILED: ${project.id} — ${project.objects.length} objects -> ${outputPath}`);
      console.log(`PROFILE: ${context.profileId}`);
      printHumanReport(report);
      console.log(report.valid ? "PASS: compiled project conforms to CODEX checks." : "FAIL: compiled project does not conform to CODEX checks.");
    }
    if (!report.valid) process.exitCode = 1;
  } catch (error) {
    const diagnostic = authoringDiagnostic(error);
    if (json) writeJson(failure(command, diagnostic), process.stderr);
    else console.error(`Authoring operation failed [${diagnostic.code}]: ${diagnostic.message}`);
    process.exitCode = 1;
  }
}

async function profilesCommand(action: string | undefined, args: string[]): Promise<void> {
  const json = args.includes("--json");
  const command = `profiles.${action ?? "unknown"}`;
  try {
    if (action === "list") {
      const profiles = listProfiles();
      if (json) writeJson(success(command, { profiles }));
      else for (const profile of profiles) console.log(`${profile.id}\t${profile.version}\t${profile.name}`);
      return;
    }
    const id = positionalValue(args);
    if (action === "inspect" && id) {
      const resolved = resolveProfile(id);
      const result = {
        profile: loadProfile(id),
        chain: resolved.chain,
        registry: {
          objectTypes: resolved.registry.objectTypes,
          relationTypes: resolved.registry.relationTypes,
          languages: resolved.registry.languages,
          translationRules: resolved.registry.translationRules,
          diagnostics: resolved.registry.diagnostics
        }
      };
      if (json) writeJson(success(command, result));
      else console.log(JSON.stringify(result, null, 2));
      return;
    }
    if (action === "validate" && id) {
      const resolved = resolveProfile(id);
      const result = { id, version: resolved.descriptors.at(-1)?.version, chain: resolved.chain, valid: true };
      if (json) writeJson(success(command, result));
      else console.log(`PASS: ${id} ${result.version} (${resolved.chain.join(" -> ")})`);
      return;
    }
  } catch (error) {
    emitFailure(command, genericDiagnostic("CLI-1301", error), json);
    return;
  }
  emitFailure(command, { code: "CLI-1302", message: "Usage: codex profiles list|inspect|validate ..." }, json, 2);
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function discoverProjectRoot(outputPath: string): Promise<string> {
  let current = dirname(resolve(outputPath));
  const root = parse(current).root;
  while (true) {
    if (await pathExists(resolve(current, "project.yml")) || await pathExists(resolve(current, "project.yaml"))) return current;
    if (current === root) break;
    current = dirname(current);
  }
  throw new TranslationError("CLI-1902", "Could not discover a project.yml/project.yaml ancestor; pass --root.");
}

async function translationCommand(action: string | undefined, args: string[]): Promise<void> {
  const command = `translation.${action ?? "unknown"}`;
  const json = args.includes("--json");
  try {
    if (action === "create") {
      const sourceId = optionValue(args, "--source");
      const language = optionValue(args, "--language");
      const id = optionValue(args, "--id");
      const output = optionValue(args, "--output");
      if (!sourceId || !language || !id || !output) throw new TranslationError("CLI-1901", "Usage: codex translation create --source ID --language CODE --id ID --output FILE [--root DIR] [--force] [--json]");
      const outputPath = resolve(output);
      const root = resolve(optionValue(args, "--root") ?? await discoverProjectRoot(outputPath));
      const outputExists = await pathExists(outputPath);
      if (outputExists && !args.includes("--force")) throw new TranslationError("CLI-1903", `Refusing to overwrite existing file without --force: ${outputPath}`);
      const compiled = await compileProject(root);
      const context = resolveValidationContext(compiled.project.profile ?? "core");
      const relativeOutput = relative(root, outputPath).replaceAll("\\", "/");
      const existingAtOutput = compiled.project.objects.find((object) => object.metadata?.source && (object.metadata.source as { file?: unknown }).file === relativeOutput);
      if (outputExists && args.includes("--force") && existingAtOutput?.id !== id) throw new TranslationError("CODEX_TRANSLATION_ID_EXISTS", `Existing output belongs to a different object: ${existingAtOutput?.id ?? relativeOutput}`);
      const project = outputExists && args.includes("--force")
        ? { ...compiled.project, objects: compiled.project.objects.filter((object) => object !== existingAtOutput) }
        : compiled.project;
      const draft = createTranslationDraft(project, {
        id,
        sourceId,
        language,
        title: optionValue(args, "--title"),
        translationMode: optionValue(args, "--translation-mode")
      }, context.registry);
      await mkdir(dirname(outputPath), { recursive: true });
      await writeFile(outputPath, draft.markdown, "utf8");
      const result = { outputPath, root, sourceId, translation: draft.object };
      if (json) writeJson(success(command, result));
      else console.log(`CREATED: ${id} (${language}) from ${sourceId} -> ${outputPath}`);
      return;
    }
    if (action === "status") {
      const rootArg = args[0] && !args[0].startsWith("--") ? args[0] : ".";
      const root = resolve(optionValue(args, "--root") ?? rootArg);
      const compiled = await compileProject(root);
      const context = resolveValidationContext(compiled.project.profile ?? "core");
      const result = analyzeTranslationStatus(compiled.project, context.registry);
      if (json) writeJson(success(command, result));
      else {
        console.log(`PROJECT: ${result.projectId}`);
        console.log(`SOURCE OBJECTS: ${result.sources.length}`);
        for (const source of result.sources) console.log(`${source.id}\t${source.language ?? "und"}\t${source.translations.map((item) => `${item.language ?? "und"}:${item.status}`).join(",") || "none"}`);
        console.log(`EXISTING LANGUAGES: ${result.existingLanguages.join(", ") || "none"}`);
        console.log(`MISSING: ${result.missing.map((item) => `${item.sourceId}:${item.language}`).join(", ") || "none"}`);
        console.log(`STATUSES: ${JSON.stringify(result.statuses)}`);
        console.log(`ORPHANS: ${result.orphans.map((item) => item.id).join(", ") || "none"}`);
        console.log(`INVALID PROVENANCE: ${result.invalidProvenance.map((item) => `${item.translationId} (${item.reason})`).join(", ") || "none"}`);
      }
      return;
    }
    throw new TranslationError("CLI-1901", "Usage: codex translation create|status ...");
  } catch (error) {
    const diagnostic = error instanceof TranslationError
      ? { code: error.code, message: error.message }
      : genericDiagnostic("CLI-1904", error);
    emitFailure(command, diagnostic, json, error instanceof TranslationError && error.code === "CLI-1901" ? 2 : 1);
  }
}

async function inspectCommand(filePath: string, json: boolean): Promise<void> {
  const command = "inspect";
  const project = await loadProject(filePath, command, json);
  if (!project) return;
  const inspection = inspectProject(project);
  if (json) return void writeJson(success(command, inspection));
  console.log(`PROJECT: ${inspection.projectId} — ${inspection.title}`);
  console.log(`CODEX VERSION: ${inspection.codexVersion}`);
  console.log(`OBJECTS: ${inspection.objectCount}`);
  console.log(`RELATIONS: ${inspection.relationCount}`);
  console.log(`PROVENANCE LINKS: ${inspection.derivedFromCount}`);
  console.log(`ROOTS: ${inspection.rootObjectIds.join(", ") || "none"}`);
  console.log(`UNREACHABLE: ${inspection.unreachableObjectIds.join(", ") || "none"}`);
  console.log(`OBJECT TYPES: ${JSON.stringify(inspection.objectTypes)}`);
  console.log(`STATUSES: ${JSON.stringify(inspection.lifecycleStatuses)}`);
  console.log(`LANGUAGES: ${JSON.stringify(inspection.languages)}`);
}

async function graphCommand(filePath: string, args: string[]): Promise<void> {
  const command = "graph";
  const json = args.includes("--json");
  const project = await loadProject(filePath, command, json);
  if (!project) return;
  const format = optionValue(args, "--format") ?? "json";
  const relationFilter = optionValue(args, "--relations")?.split(",").map((value) => value.trim()).filter(Boolean);
  const graph = buildProjectGraph(project);
  const filtered = relationFilter?.length ? { ...graph, edges: graph.edges.filter((edge) => relationFilter.includes(edge.type)) } : graph;
  const output = format === "json"
    ? `${JSON.stringify(json ? success(command, filtered) : filtered, null, 2)}\n`
    : format === "dot" ? graphToDot(filtered) : undefined;
  if (!output) {
    emitFailure(command, { code: "CLI-1501", message: `Unknown graph format: ${format}` }, json, 2);
    return;
  }
  const outputPath = optionValue(args, "--output");
  if (outputPath) {
    await writeFile(outputPath, output, "utf8");
    if (!json) console.log(`WROTE: ${outputPath}`);
  } else process.stdout.write(output);
}

function diagnosticsCommand(args: string[]): void {
  const command = "diagnostics";
  const json = args.includes("--json");
  try {
    const profileId = optionValue(args, "--profile");
    const registry = profileId && profileId !== "core" && profileId !== "strict" ? resolveProfile(profileId).registry : loadRegistry();
    const severity = optionValue(args, "--severity");
    const diagnostics = severity ? registry.diagnostics.filter((item) => item.severity === severity) : registry.diagnostics;
    if (json) return void writeJson(success(command, { diagnostics, count: diagnostics.length }));
    for (const item of diagnostics) console.log(`${item.code}\t${item.severity.toUpperCase()}\t${item.title}`);
    console.log(`TOTAL: ${diagnostics.length}`);
  } catch (error) {
    emitFailure(command, genericDiagnostic("CLI-1601", error), json);
  }
}

async function releaseCommand(action: string | undefined, args: string[]): Promise<void> {
  const command = `release.${action ?? "unknown"}`;
  const json = args.includes("--json");
  const manifestPath = positionalValue(args) ?? "releases/0.2.0/manifest.json";
  try {
    if (action === "prepare") {
      const outputPath = optionValue(args, "--output") ?? manifestPath;
      const manifest = await writePreparedReleaseManifest(manifestPath, outputPath);
      if (json) writeJson(success(command, { manifest, outputPath }));
      else console.log(`PREPARED: ${manifest.id} ${manifest.version} -> ${outputPath}`);
      return;
    }
    if (action === "verify") {
      const report = await verifyReleaseManifest(manifestPath);
      if (json) writeJson(success(command, report));
      else {
        for (const item of report.items) console.log(`${item.ok ? "PASS" : "FAIL"}: ${item.path}${item.reason ? ` — ${item.reason}` : ""}`);
        console.log(`${report.valid ? "PASS" : "FAIL"}: release ${report.releaseId} ${report.version}`);
      }
      if (!report.valid) process.exitCode = 1;
      return;
    }
    if (action === "keygen") {
      const privateKey = optionValue(args, "--private-key") ?? "codex-private.pem";
      const publicKey = optionValue(args, "--public-key") ?? "codex-public.pem";
      const keyId = await writeEd25519KeyPair(privateKey, publicKey);
      if (json) writeJson(success(command, { keyId, privateKey, publicKey }));
      else console.log(`GENERATED: ${keyId} -> ${privateKey}, ${publicKey}`);
      return;
    }
    if (action === "sign") {
      const privateKey = optionValue(args, "--private-key");
      const outputPath = optionValue(args, "--output") ?? `${manifestPath}.sig.json`;
      if (!privateKey) throw new Error("--private-key is required");
      const signature = await signReleaseManifest(manifestPath, privateKey, outputPath);
      if (json) writeJson(success(command, { signature, outputPath }));
      else console.log(`SIGNED: ${manifestPath} -> ${outputPath} (${signature.keyId})`);
      return;
    }
    if (action === "signature-verify") {
      const signature = optionValue(args, "--signature");
      const publicKey = optionValue(args, "--public-key");
      if (!signature || !publicKey) throw new Error("--signature and --public-key are required");
      const valid = await verifyReleaseManifestSignature(manifestPath, signature, publicKey);
      if (json) writeJson(success(command, { valid, manifestPath, signature, publicKey }));
      else console.log(`${valid ? "PASS" : "FAIL"}: manifest signature`);
      if (!valid) process.exitCode = 1;
      return;
    }
  } catch (error) {
    emitFailure(command, genericDiagnostic("CLI-1701", error), json);
    return;
  }
  emitFailure(command, { code: "CLI-1702", message: "Usage: codex release prepare|verify|keygen|sign|signature-verify ..." }, json, 2);
}

async function packageCommand(action: string | undefined, args: string[]): Promise<void> {
  const command = `package.${action ?? "unknown"}`;
  const json = args.includes("--json");
  const input = positionalValue(args) ?? (action === "build" ? "releases/0.2.0/manifest.json" : "codex-package");
  try {
    if (action === "build") {
      const result = await buildReleasePackage(input, optionValue(args, "--output") ?? "codex-package");
      if (json) writeJson(success(command, result));
      else console.log(`BUILT: ${result.releaseId} ${result.version} — ${result.fileCount} files -> ${result.outputDirectory}`);
      return;
    }
    if (action === "verify") {
      const report = await verifyReleasePackage(input);
      if (json) writeJson(success(command, report));
      else console.log(`${report.valid ? "PASS" : "FAIL"}: package ${report.releaseId} ${report.version}`);
      if (!report.valid) process.exitCode = 1;
      return;
    }
    if (action === "unpack") {
      const result = await unpackReleasePackage(input, optionValue(args, "--output") ?? "codex-unpacked");
      if (json) writeJson(success(command, result));
      else console.log(`UNPACKED: ${result.releaseId} ${result.version} — ${result.fileCount} files -> ${result.outputDirectory}`);
      return;
    }
  } catch (error) {
    emitFailure(command, genericDiagnostic("CLI-1801", error), json);
    return;
  }
  emitFailure(command, { code: "CLI-1802", message: "Usage: codex package build|verify|unpack ..." }, json, 2);
}

async function doctorCommand(args: string[]): Promise<void> {
  const command = "doctor";
  const json = args.includes("--json");
  const checks: Array<{ name: string; ok: boolean; detail: string }> = [];
  const nodeMajor = Number.parseInt(process.versions.node.split(".")[0] ?? "0", 10);
  checks.push({ name: "Node.js", ok: nodeMajor >= 22, detail: `detected ${process.versions.node}; required >= 22` });
  const requiredFiles = [
    "package.json", "tsconfig.json", "schemas/project.schema.json", "schemas/profile.schema.json",
    "specs/core/README.md", "specs/core/rules.json", "profiles/core/profile.json",
    "profiles/scholarly-edition/profile.json", "profiles/hermetica/profile.json",
    "registry/object-types.json", "registry/relation-types.json", "registry/diagnostic-codes.json",
    "registry/translation-rules.json", "schemas/translation-rules.schema.json",
    "packages/authoring/package.json", "packages/translation/package.json",
    "examples/authoring/project.md", "releases/0.2.0/manifest.json"
  ];
  for (const file of requiredFiles) {
    try {
      await access(file);
      checks.push({ name: file, ok: true, detail: "present" });
    } catch {
      checks.push({ name: file, ok: false, detail: "missing" });
    }
  }
  try {
    for (const profile of listProfiles()) resolveProfile(profile.id);
    checks.push({ name: "Profiles", ok: true, detail: `${listProfiles().length} profiles resolved` });
  } catch (error) {
    checks.push({ name: "Profiles", ok: false, detail: error instanceof Error ? error.message : String(error) });
  }
  const valid = checks.every((check) => check.ok);
  if (json) writeJson(success(command, { valid, checks }));
  else {
    for (const check of checks) console.log(`${check.ok ? "PASS" : "FAIL"}: ${check.name} — ${check.detail}`);
    if (valid) console.log("PASS: CODEX development environment is ready.");
  }
  if (!valid) process.exitCode = 1;
}

async function main(): Promise<void> {
  const [, , command, argument, ...args] = process.argv;
  if (command === "validate" && argument) return validateCommand(argument, args);
  if (command === "authoring") return authoringCommand(argument, args);
  if (command === "profiles") return profilesCommand(argument, args);
  if (command === "inspect" && argument) return inspectCommand(argument, args.includes("--json"));
  if (command === "graph" && argument) return graphCommand(argument, args);
  if (command === "diagnostics") return diagnosticsCommand([argument, ...args].filter((value): value is string => Boolean(value)));
  if (command === "release") return releaseCommand(argument, args);
  if (command === "package") return packageCommand(argument, args);
  if (command === "translation") return translationCommand(argument, args);
  if (command === "doctor") return doctorCommand([argument, ...args].filter((value): value is string => Boolean(value)));
  const json = [argument, ...args].includes("--json");
  emitFailure(command ?? "unknown", { code: "CLI-1000", message: "Usage: codex validate|authoring|profiles|inspect|graph|diagnostics|release|package|translation|doctor ..." }, json, 2);
}

void main();
