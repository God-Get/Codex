#!/usr/bin/env node

import { createHash } from "node:crypto";
import { access, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, parse, relative, resolve, sep } from "node:path";
import process from "node:process";
import { authoringDiagnostic, compileAuthoringProject, parseMarkdownDocument } from "@codex/authoring";
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
import {
  analyzeTranslationStatus,
  assessTranslationQuality,
  createTranslationDraft,
  emptyTranslationMemory,
  extractObjectText,
  OpenAICompatibleTranslationProvider,
  runTranslationBatch,
  StaticTranslationProvider,
  TranslationError,
  validateGlossary,
  validateTranslationMemory,
  type AutomationItem,
  type GlossaryEntry,
  type TranslationMemory,
  type TranslationProvider
} from "@codex/translation";
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

interface TranslationAutomationConfig {
  provider:
    | { kind: "static"; dataFile: string }
    | { kind: "openai-compatible"; endpoint: string; model: string; apiKeyEnv: string; timeoutMs?: number; organization?: string };
  glossaryFile?: string;
  memoryFile?: string;
  outputDirectory?: string;
  concurrency?: number;
  requestsPerMinute?: number;
  maxRetries?: number;
}

async function readJsonFile(path: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as unknown;
  } catch (error) {
    throw new TranslationError("CODEX_TRANSLATION_PROVIDER_CONFIG", `Cannot read JSON file ${path}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function automationConfig(value: unknown): TranslationAutomationConfig {
  if (!value || typeof value !== "object") throw new TranslationError("CODEX_TRANSLATION_PROVIDER_CONFIG", "Automation config must be a JSON object.");
  const config = value as Record<string, unknown>;
  const allowedConfigKeys = new Set(["$schema", "provider", "glossaryFile", "memoryFile", "outputDirectory", "concurrency", "requestsPerMinute", "maxRetries"]);
  const unknownConfigKey = Object.keys(config).find((key) => !allowedConfigKeys.has(key));
  if (unknownConfigKey) throw new TranslationError("CODEX_TRANSLATION_PROVIDER_CONFIG", `Unknown automation config property: ${unknownConfigKey}`);
  if (!config.provider || typeof config.provider !== "object") throw new TranslationError("CODEX_TRANSLATION_PROVIDER_CONFIG", "Automation config requires provider.");
  const provider = config.provider as Record<string, unknown>;
  for (const [key, minimum, maximum] of [["concurrency", 1, 16], ["requestsPerMinute", Number.MIN_VALUE, Number.MAX_VALUE], ["maxRetries", 0, 10]] as const) {
    const field = config[key];
    if (field !== undefined && (typeof field !== "number" || !Number.isFinite(field) || field < minimum || field > maximum || (key !== "requestsPerMinute" && !Number.isInteger(field)))) {
      throw new TranslationError("CODEX_TRANSLATION_PROVIDER_CONFIG", `Automation config ${key} is invalid.`);
    }
  }
  for (const key of ["glossaryFile", "memoryFile", "outputDirectory"] as const) {
    if (config[key] !== undefined && (typeof config[key] !== "string" || !config[key].trim())) {
      throw new TranslationError("CODEX_TRANSLATION_PROVIDER_CONFIG", `Automation config ${key} must be a non-empty string.`);
    }
  }
  if (provider.kind === "static" && typeof provider.dataFile === "string" && provider.dataFile.length > 0) {
    const unknownProviderKey = Object.keys(provider).find((key) => !["kind", "dataFile"].includes(key));
    if (unknownProviderKey) throw new TranslationError("CODEX_TRANSLATION_PROVIDER_CONFIG", `Unknown static provider property: ${unknownProviderKey}`);
    return { ...(config as unknown as TranslationAutomationConfig), provider: { kind: "static", dataFile: provider.dataFile } };
  }
  if (provider.kind === "openai-compatible"
    && typeof provider.endpoint === "string"
    && /^https:\/\//.test(provider.endpoint)
    && typeof provider.model === "string"
    && provider.model.length > 0
    && typeof provider.apiKeyEnv === "string"
    && /^[A-Z_][A-Z0-9_]*$/.test(provider.apiKeyEnv)
    && (provider.timeoutMs === undefined || (typeof provider.timeoutMs === "number" && Number.isInteger(provider.timeoutMs) && provider.timeoutMs >= 1_000 && provider.timeoutMs <= 600_000))
    && (provider.organization === undefined || (typeof provider.organization === "string" && provider.organization.length > 0))) {
    const unknownProviderKey = Object.keys(provider).find((key) => !["kind", "endpoint", "model", "apiKeyEnv", "timeoutMs", "organization"].includes(key));
    if (unknownProviderKey) throw new TranslationError("CODEX_TRANSLATION_PROVIDER_CONFIG", `Unknown openai-compatible provider property: ${unknownProviderKey}`);
    return {
      ...(config as unknown as TranslationAutomationConfig),
      provider: {
        kind: "openai-compatible",
        endpoint: provider.endpoint,
        model: provider.model,
        apiKeyEnv: provider.apiKeyEnv,
        ...(typeof provider.timeoutMs === "number" ? { timeoutMs: provider.timeoutMs } : {}),
        ...(typeof provider.organization === "string" ? { organization: provider.organization } : {})
      }
    };
  }
  throw new TranslationError("CODEX_TRANSLATION_PROVIDER_CONFIG", "Provider must be static or openai-compatible with all required fields.");
}

function resolveWithinRoot(root: string, path: string, label: string): string {
  const resolvedRoot = resolve(root);
  const resolvedPath = resolve(root, path);
  if (resolvedPath !== resolvedRoot && !resolvedPath.startsWith(`${resolvedRoot}${sep}`)) {
    throw new TranslationError("CODEX_TRANSLATION_PROVIDER_CONFIG", `${label} escapes project root: ${path}`);
  }
  return resolvedPath;
}

async function loadAutomationInputs(root: string, configPath: string): Promise<{
  config: TranslationAutomationConfig;
  provider: TranslationProvider;
  glossary: GlossaryEntry[];
  memory: TranslationMemory;
  memoryPath?: string;
}> {
  const resolvedConfigPath = resolve(configPath);
  const config = automationConfig(await readJsonFile(resolvedConfigPath));
  const configDirectory = dirname(resolvedConfigPath);
  let provider: TranslationProvider;
  if (config.provider.kind === "static") {
    const dataPath = resolve(configDirectory, config.provider.dataFile);
    const data = await readJsonFile(dataPath) as { translations?: unknown };
    if (!data || typeof data.translations !== "object" || data.translations === null || Array.isArray(data.translations)
      || Object.values(data.translations as Record<string, unknown>).some((value) => typeof value !== "string")) {
      throw new TranslationError("CODEX_TRANSLATION_PROVIDER_CONFIG", "Static provider data requires a translations object.");
    }
    provider = new StaticTranslationProvider({ translations: data.translations as Record<string, string> });
  } else {
    const apiKey = process.env[config.provider.apiKeyEnv];
    if (!apiKey) throw new TranslationError("CODEX_TRANSLATION_PROVIDER_CONFIG", `Required API key environment variable is not set: ${config.provider.apiKeyEnv}`);
    provider = new OpenAICompatibleTranslationProvider({
      endpoint: config.provider.endpoint,
      model: config.provider.model,
      apiKey,
      ...(config.provider.timeoutMs === undefined ? {} : { timeoutMs: config.provider.timeoutMs }),
      ...(config.provider.organization ? { organization: config.provider.organization } : {})
    });
  }
  const glossary = config.glossaryFile
    ? validateGlossary(await readJsonFile(resolve(configDirectory, config.glossaryFile)))
    : [];
  const memoryPath = config.memoryFile ? resolveWithinRoot(root, config.memoryFile, "memoryFile") : undefined;
  const memory = memoryPath && await pathExists(memoryPath)
    ? validateTranslationMemory(await readJsonFile(memoryPath))
    : emptyTranslationMemory();
  return { config, provider, glossary, memory, ...(memoryPath ? { memoryPath } : {}) };
}

function automaticTranslationId(sourceId: string, language: string): string {
  const hex = createHash("sha256").update(`${sourceId}\0${language}`, "utf8").digest("hex").slice(0, 12);
  const number = (BigInt(`0x${hex}`) % 100_000_000n).toString().padStart(8, "0");
  return `TRANS-${number}`;
}

async function atomicWrite(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.codex-tmp-${process.pid}`;
  try {
    await writeFile(temporary, content, "utf8");
    await rename(temporary, path);
  } finally {
    await rm(temporary, { force: true });
  }
}

function updateMarkdownFrontMatter(source: string, updates: Record<string, string | boolean | number>): string {
  const normalized = source.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n");
  if (!normalized.startsWith("---\n")) throw new TranslationError("CODEX_TRANSLATION_REVIEW_BLOCKED", "Translation file has no front matter.");
  const end = normalized.indexOf("\n---\n", 4);
  if (end < 0) throw new TranslationError("CODEX_TRANSLATION_REVIEW_BLOCKED", "Translation front matter is unterminated.");
  const remaining = new Map(Object.entries(updates));
  const lines = normalized.slice(4, end).split("\n").map((line) => {
    const separator = line.indexOf(":");
    if (separator < 1) return line;
    const key = line.slice(0, separator).trim();
    if (!remaining.has(key)) return line;
    const value = remaining.get(key)!;
    remaining.delete(key);
    return `${key}: ${typeof value === "string" ? JSON.stringify(value) : String(value)}`;
  });
  for (const [key, value] of remaining) lines.push(`${key}: ${typeof value === "string" ? JSON.stringify(value) : String(value)}`);
  return `---\n${lines.join("\n")}\n---\n${normalized.slice(end + 5)}`;
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
    if (action === "run") {
      const rootArg = args[0] && !args[0].startsWith("--") ? args[0] : ".";
      const root = resolve(optionValue(args, "--root") ?? rootArg);
      const configOption = optionValue(args, "--config");
      if (!configOption) throw new TranslationError("CLI-1901", "Usage: codex translation run [root] --config FILE [--source ID] [--language CODE] [--id ID] [--output FILE] [--force] [--dry-run] [--allow-partial] [--json]");
      const configPath = resolve(configOption);
      const config = automationConfig(await readJsonFile(configPath));
      const compiled = await compileProject(root);
      const context = resolveValidationContext(compiled.project.profile ?? "core");
      const status = analyzeTranslationStatus(compiled.project, context.registry);
      const requestedSource = optionValue(args, "--source");
      const requestedLanguage = optionValue(args, "--language");
      const candidates = requestedSource && requestedLanguage
        ? [{ sourceId: requestedSource, language: requestedLanguage }]
        : status.missing.filter((item) => (!requestedSource || item.sourceId === requestedSource)
          && (!requestedLanguage || item.language === requestedLanguage));
      if (candidates.length === 0) throw new TranslationError("CODEX_TRANSLATION_SOURCE_MISSING", "No matching missing translations were found.");
      if (candidates.length > 1 && (optionValue(args, "--id") || optionValue(args, "--output"))) {
        throw new TranslationError("CODEX_TRANSLATION_PROVIDER_CONFIG", "--id and --output are only valid for a single translation.");
      }
      const outputDirectory = resolveWithinRoot(root, config.outputDirectory ?? "translations", "outputDirectory");
      const planned = candidates.map((candidate) => {
        const existing = compiled.project.objects.find((object) => object.type === "translation"
          && object.language === candidate.language
          && object.derivedFrom?.length === 1
          && object.derivedFrom[0] === candidate.sourceId);
        const id = optionValue(args, "--id") ?? existing?.id ?? automaticTranslationId(candidate.sourceId, candidate.language);
        const existingSourceFile = existing?.metadata?.source && typeof existing.metadata.source === "object"
          ? (existing.metadata.source as { file?: unknown }).file
          : undefined;
        const output = resolve(optionValue(args, "--output")
          ?? (typeof existingSourceFile === "string" ? resolve(root, existingSourceFile) : resolve(outputDirectory, candidate.language, `${candidate.sourceId.toLowerCase()}.md`)));
        return { item: { sourceId: candidate.sourceId, targetLanguage: candidate.language, id } satisfies AutomationItem, output, existing };
      });
      const plannedIds = new Set<string>();
      const plannedOutputs = new Set<string>();
      for (const entry of planned) {
        if (plannedIds.has(entry.item.id)) throw new TranslationError("CODEX_TRANSLATION_ID_EXISTS", `Duplicate planned translation ID: ${entry.item.id}`);
        if (plannedOutputs.has(entry.output)) throw new TranslationError("CODEX_TRANSLATION_PROVIDER_CONFIG", `Duplicate planned output path: ${entry.output}`);
        plannedIds.add(entry.item.id);
        plannedOutputs.add(entry.output);
      }
      const force = args.includes("--force");
      for (const entry of planned) {
        if (entry.existing && !force) throw new TranslationError("CODEX_TRANSLATION_ID_EXISTS", `Translation already exists: ${entry.existing.id}`);
        if (await pathExists(entry.output) && !force) throw new TranslationError("CLI-1903", `Refusing to overwrite existing file without --force: ${entry.output}`);
      }
      if (args.includes("--dry-run")) {
        const result = { root, provider: config.provider.kind, planned: planned.map(({ item, output }) => ({ ...item, output })) };
        if (json) writeJson(success(command, result));
        else {
          console.log(`PLAN: ${planned.length} translation(s) with ${config.provider.kind}`);
          for (const entry of planned) console.log(`${entry.item.sourceId}\t${entry.item.targetLanguage}\t${entry.item.id}\t${entry.output}`);
        }
        return;
      }
      const inputs = await loadAutomationInputs(root, configPath);
      const replacedIds = new Set(force ? planned.flatMap((entry) => entry.existing ? [entry.existing.id] : []) : []);
      const project = replacedIds.size
        ? { ...compiled.project, objects: compiled.project.objects.filter((object) => !replacedIds.has(object.id)) }
        : compiled.project;
      const report = await runTranslationBatch(project, context.registry, planned.map((entry) => entry.item), {
        provider: inputs.provider,
        glossary: inputs.glossary,
        memory: inputs.memory,
        concurrency: inputs.config.concurrency,
        requestsPerMinute: inputs.config.requestsPerMinute,
        maxRetries: inputs.config.maxRetries
      });
      if (inputs.memoryPath) await atomicWrite(inputs.memoryPath, `${JSON.stringify(report.memory, null, 2)}\n`);
      if (report.failures.length > 0 && !args.includes("--allow-partial")) {
        throw new TranslationError("CODEX_TRANSLATION_BATCH_PARTIAL", report.failures.map((failure) => `${failure.item.sourceId}/${failure.item.targetLanguage}: ${failure.message}`).join("; "));
      }
      const generatedProject = { ...project, objects: [...project.objects, ...report.results.map((item) => item.object)] };
      const generatedValidation = validateProject(generatedProject, { registry: context.registry, profile: context.semanticProfile });
      const generatedErrors = generatedValidation.diagnostics.filter((diagnostic) => diagnostic.severity === "error");
      if (generatedErrors.length > 0) {
        throw new TranslationError(
          "CODEX_TRANSLATION_BATCH_PARTIAL",
          `Generated objects failed CODEX validation: ${generatedErrors.map((diagnostic) => `${diagnostic.code} ${diagnostic.message}`).join("; ")}`
        );
      }
      const outputs: string[] = [];
      for (const result of report.results) {
        const output = planned.find((entry) => entry.item.id === result.item.id)?.output;
        if (!output) continue;
        await atomicWrite(output, result.markdown);
        outputs.push(output);
      }
      const result = {
        root,
        provider: inputs.provider.id,
        generated: report.results.length,
        failed: report.failures.length,
        cacheHits: report.results.filter((item) => item.cacheHit).length,
        outputs,
        results: report.results.map((item) => ({
          id: item.object.id,
          sourceId: item.item.sourceId,
          language: item.item.targetLanguage,
          quality: item.quality,
          cacheHit: item.cacheHit,
          attempts: item.attempts,
          usage: item.usage
        })),
        failures: report.failures
      };
      if (json) writeJson(success(command, result));
      else {
        console.log(`GENERATED: ${result.generated}; FAILED: ${result.failed}; CACHE HITS: ${result.cacheHits}`);
        for (const output of outputs) console.log(`WROTE: ${output}`);
      }
      if (report.failures.length > 0) process.exitCode = 1;
      return;
    }
    if (action === "qa") {
      const rootArg = args[0] && !args[0].startsWith("--") ? args[0] : ".";
      const root = resolve(optionValue(args, "--root") ?? rootArg);
      const compiled = await compileProject(root);
      let glossary: GlossaryEntry[] = [];
      const configOption = optionValue(args, "--config");
      if (configOption) {
        const configPath = resolve(configOption);
        const config = automationConfig(await readJsonFile(configPath));
        if (config.glossaryFile) glossary = validateGlossary(await readJsonFile(resolve(dirname(configPath), config.glossaryFile)));
      }
      const objectsById = new Map(compiled.project.objects.map((object) => [object.id, object]));
      const results = compiled.project.objects.filter((object) => object.type === "translation").map((translation) => {
        const sourceId = translation.derivedFrom?.length === 1 ? translation.derivedFrom[0] : undefined;
        const source = sourceId ? objectsById.get(sourceId) : undefined;
        if (!source?.language || !translation.language) {
          return {
            id: translation.id,
            sourceId,
            quality: { score: 0, passed: false, issues: [{ code: "CODEX_TRANSLATION_PROVENANCE_INVALID", severity: "error", message: "Translation source or language is invalid." }] }
          };
        }
        return {
          id: translation.id,
          sourceId,
          quality: assessTranslationQuality({
            sourceId: source.id,
            sourceText: extractObjectText(source),
            sourceLanguage: source.language,
            targetLanguage: translation.language,
            glossary
          }, extractObjectText(translation))
        };
      });
      const passed = results.every((item) => item.quality.passed);
      const result = { projectId: compiled.project.id, passed, translations: results };
      if (json) writeJson(success(command, result));
      else {
        console.log(`QA: ${passed ? "PASS" : "FAIL"} — ${results.length} translation(s)`);
        for (const item of results) console.log(`${item.id}\t${item.quality.score}\t${item.quality.passed ? "pass" : "fail"}`);
      }
      if (!passed) process.exitCode = 1;
      return;
    }
    if (action === "review") {
      const fileOption = optionValue(args, "--file");
      const requestedStatus = optionValue(args, "--status");
      const reviewer = optionValue(args, "--reviewer");
      if (!fileOption || !requestedStatus || !["draft", "review", "approved"].includes(requestedStatus)) {
        throw new TranslationError("CLI-1901", "Usage: codex translation review --file FILE --status draft|review|approved [--reviewer NAME] [--config FILE] [--root DIR] [--json]");
      }
      if (requestedStatus !== "draft" && !reviewer) {
        throw new TranslationError("CODEX_TRANSLATION_REVIEW_REQUIRED", "A reviewer is required for review or approved status.");
      }
      const file = resolve(fileOption);
      const root = resolve(optionValue(args, "--root") ?? await discoverProjectRoot(file));
      const source = await readFile(file, "utf8");
      const document = parseMarkdownDocument(source, file);
      const id = typeof document.attributes.id === "string" ? document.attributes.id : undefined;
      if (!id || document.attributes.type !== "translation") {
        throw new TranslationError("CODEX_TRANSLATION_REVIEW_BLOCKED", "Review target must be a translation Markdown object.");
      }
      const currentStatus = typeof document.attributes.status === "string" ? document.attributes.status : undefined;
      const allowedTransitions: Record<string, string[]> = {
        draft: ["draft", "review"],
        review: ["draft", "review", "approved"],
        approved: ["draft", "approved"]
      };
      if (!currentStatus || !allowedTransitions[currentStatus]?.includes(requestedStatus)) {
        throw new TranslationError("CODEX_TRANSLATION_REVIEW_BLOCKED", `Invalid review transition: ${currentStatus ?? "unknown"} -> ${requestedStatus}`);
      }
      if (requestedStatus === "approved") {
        const compiled = await compileProject(root);
        const translation = compiled.project.objects.find((object) => object.id === id);
        const sourceId = translation?.derivedFrom?.length === 1 ? translation.derivedFrom[0] : undefined;
        const original = sourceId ? compiled.project.objects.find((object) => object.id === sourceId) : undefined;
        if (!translation?.language || !original?.language) {
          throw new TranslationError("CODEX_TRANSLATION_REVIEW_BLOCKED", "Approval requires valid translation provenance and languages.");
        }
        let reviewGlossary: GlossaryEntry[] = [];
        const configOption = optionValue(args, "--config");
        if (configOption) {
          const configPath = resolve(configOption);
          const config = automationConfig(await readJsonFile(configPath));
          if (config.glossaryFile) reviewGlossary = validateGlossary(await readJsonFile(resolve(dirname(configPath), config.glossaryFile)));
        }
        const quality = assessTranslationQuality({
          sourceId: original.id,
          sourceText: extractObjectText(original),
          sourceLanguage: original.language,
          targetLanguage: translation.language,
          glossary: reviewGlossary
        }, extractObjectText(translation));
        if (!quality.passed) {
          throw new TranslationError("CODEX_TRANSLATION_REVIEW_BLOCKED", quality.issues.map((issue) => issue.message).join("; "));
        }
      }
      const reviewedAt = new Date().toISOString();
      const updated = updateMarkdownFrontMatter(source, {
        status: requestedStatus,
        ...(reviewer ? { reviewedBy: reviewer, reviewedAt } : {})
      });
      await atomicWrite(file, updated);
      const result = { id, file, status: requestedStatus, reviewer, ...(reviewer ? { reviewedAt } : {}) };
      if (json) writeJson(success(command, result));
      else console.log(`REVIEWED: ${id} -> ${requestedStatus}${reviewer ? ` by ${reviewer}` : ""}`);
      return;
    }
    if (action === "memory") {
      const file = optionValue(args, "--file");
      if (!file) throw new TranslationError("CLI-1901", "Usage: codex translation memory --file FILE [--json]");
      const memory = validateTranslationMemory(await readJsonFile(resolve(file)));
      const entries = Object.values(memory.entries);
      const result = {
        file: resolve(file),
        entries: entries.length,
        languages: [...new Set(entries.map((entry) => entry.targetLanguage))].sort(),
        providers: [...new Set(entries.map((entry) => entry.provider))].sort()
      };
      if (json) writeJson(success(command, result));
      else console.log(`MEMORY: ${result.entries} entries; languages=${result.languages.join(",") || "none"}; providers=${result.providers.join(",") || "none"}`);
      return;
    }
    throw new TranslationError("CLI-1901", "Usage: codex translation create|status|run|qa|review|memory ...");
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
    "schemas/translation-automation.schema.json",
    "packages/authoring/package.json", "packages/translation/package.json",
    "examples/authoring/project.md", "reference/hermetica/translation.config.json",
    "releases/0.2.0/manifest.json"
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
