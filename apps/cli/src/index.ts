#!/usr/bin/env node

import { access, readFile, writeFile } from "node:fs/promises";
import process from "node:process";
import type { CodexProject, Diagnostic, ValidationProfile, ValidationReport } from "@codex/core";
import { isRegisteredValidationProfile, loadRegistry } from "@codex/registry";
import { validateProjectSchema } from "@codex/schema";
import { buildProjectGraph, graphToDot, inspectProject, validateProject } from "@codex/validator";

function optionValue(args: string[], name: string): string | undefined {
  return args.find((arg) => arg.startsWith(`${name}=`))?.slice(name.length + 1);
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

async function loadJson(filePath: string): Promise<unknown | undefined> {
  try {
    return JSON.parse(await readFile(filePath, "utf8")) as unknown;
  } catch (error) {
    console.error(`Failed to read project: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 2;
    return undefined;
  }
}

async function loadProject(filePath: string): Promise<CodexProject | undefined> {
  const value = await loadJson(filePath);
  if (value === undefined) return undefined;
  const diagnostics = validateProjectSchema(value);
  if (diagnostics.length > 0) {
    printHumanReport(mergedReport(diagnostics));
    process.exitCode = 1;
    return undefined;
  }
  return value as CodexProject;
}

function reportToSarif(report: ValidationReport, filePath: string): object {
  const registry = loadRegistry();
  const titles = new Map(registry.diagnostics.map((item) => [item.code, item.title]));
  const rules = [...new Set(report.diagnostics.map((item) => item.code))].map((code) => ({
    id: code,
    shortDescription: { text: titles.get(code) ?? code },
    defaultConfiguration: { level: code.startsWith("ERR-") ? "error" : code.startsWith("WARN-") ? "warning" : "note" }
  }));
  return {
    version: "2.1.0",
    $schema: "https://json.schemastore.org/sarif-2.1.0.json",
    runs: [{
      tool: { driver: { name: "CODEX Validator", version: "0.1.0", rules } },
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
  const value = await loadJson(filePath);
  if (value === undefined) return;
  const schemaDiagnostics = validateProjectSchema(value);
  let semanticDiagnostics: Diagnostic[] = [];
  let profile: ValidationProfile = "core";

  if (schemaDiagnostics.length === 0) {
    const registry = loadRegistry();
    const profileValue = optionValue(args, "--profile") ?? "core";
    if (!isRegisteredValidationProfile(profileValue, registry)) {
      console.error(`Unknown validation profile: ${profileValue}. Registered profiles: ${registry.validationProfiles.join(", ")}`);
      process.exitCode = 2;
      return;
    }
    profile = profileValue as ValidationProfile;
    semanticDiagnostics = validateProject(value as CodexProject, { registry, profile }).diagnostics;
  }

  const report = mergedReport([...schemaDiagnostics, ...semanticDiagnostics]);
  const outputPath = optionValue(args, "--output");
  const sarif = args.includes("--sarif");
  const output = sarif
    ? `${JSON.stringify(reportToSarif(report, filePath), null, 2)}\n`
    : args.includes("--json")
      ? `${JSON.stringify({ profile, ...report }, null, 2)}\n`
      : undefined;

  if (outputPath && output) {
    await writeFile(outputPath, output, "utf8");
    console.log(`WROTE: ${outputPath}`);
  } else if (output) {
    process.stdout.write(output);
  } else {
    console.log(`PROFILE: ${profile}`);
    printHumanReport(report);
    console.log(report.valid ? "PASS: project conforms to the current CODEX MVP checks." : "FAIL: project does not conform to the current CODEX MVP checks.");
  }
  if (!report.valid) process.exitCode = 1;
}

async function inspectCommand(filePath: string, jsonOutput: boolean): Promise<void> {
  const project = await loadProject(filePath);
  if (!project) return;
  const inspection = inspectProject(project);
  if (jsonOutput) return void console.log(JSON.stringify(inspection, null, 2));
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
  const project = await loadProject(filePath);
  if (!project) return;
  const format = optionValue(args, "--format") ?? "json";
  const relationFilter = optionValue(args, "--relations")?.split(",").map((value) => value.trim()).filter(Boolean);
  const outputPath = optionValue(args, "--output");
  const graph = buildProjectGraph(project);
  const filteredGraph = relationFilter?.length ? { ...graph, edges: graph.edges.filter((edge) => relationFilter.includes(edge.type)) } : graph;
  const output = format === "json" ? `${JSON.stringify(filteredGraph, null, 2)}\n` : format === "dot" ? graphToDot(filteredGraph) : undefined;
  if (!output) {
    console.error(`Unknown graph format: ${format}. Supported formats: json, dot`);
    process.exitCode = 2;
    return;
  }
  if (outputPath) {
    await writeFile(outputPath, output, "utf8");
    console.log(`WROTE: ${outputPath}`);
  } else process.stdout.write(output);
}

function diagnosticsCommand(args: string[]): void {
  const registry = loadRegistry();
  const severity = optionValue(args, "--severity");
  const diagnostics = severity ? registry.diagnostics.filter((item) => item.severity === severity) : registry.diagnostics;
  if (args.includes("--json")) return void console.log(JSON.stringify(diagnostics, null, 2));
  for (const item of diagnostics) console.log(`${item.code}\t${item.severity.toUpperCase()}\t${item.title}`);
  console.log(`TOTAL: ${diagnostics.length}`);
}

async function doctorCommand(): Promise<void> {
  const checks: Array<{ name: string; ok: boolean; detail: string }> = [];
  const nodeMajor = Number.parseInt(process.versions.node.split(".")[0] ?? "0", 10);
  checks.push({ name: "Node.js", ok: nodeMajor >= 22, detail: `detected ${process.versions.node}; required >= 22` });
  const requiredFiles = [
    "package.json", "tsconfig.json", "schemas/project.schema.json", "schemas/registry-list.schema.json",
    "schemas/relation-constraints.schema.json", "schemas/diagnostic-codes.schema.json", "examples/minimal-project.json",
    "registry/object-types.json", "registry/relation-types.json", "registry/lifecycle-statuses.json",
    "registry/validation-profiles.json", "registry/languages.json", "registry/relation-constraints.json",
    "registry/diagnostic-codes.json", "releases/0.1.0/manifest.json"
  ];
  for (const file of requiredFiles) {
    try { await access(file); checks.push({ name: file, ok: true, detail: "present" }); }
    catch { checks.push({ name: file, ok: false, detail: "missing" }); }
  }
  try {
    const registry = loadRegistry();
    checks.push({ name: "Registry", ok: registry.diagnostics.length > 0, detail: `${registry.diagnostics.length} registered diagnostics` });
  } catch (error) {
    checks.push({ name: "Registry", ok: false, detail: error instanceof Error ? error.message : String(error) });
  }
  for (const check of checks) console.log(`${check.ok ? "PASS" : "FAIL"}: ${check.name} — ${check.detail}`);
  if (checks.some((check) => !check.ok)) process.exitCode = 1;
  else console.log("PASS: CODEX development environment is ready.");
}

async function main(): Promise<void> {
  const [, , command, argument, ...args] = process.argv;
  if (command === "validate" && argument) return validateCommand(argument, args);
  if (command === "inspect" && argument) return inspectCommand(argument, args.includes("--json"));
  if (command === "graph" && argument) return graphCommand(argument, args);
  if (command === "diagnostics") return diagnosticsCommand([argument, ...args].filter((value): value is string => Boolean(value)));
  if (command === "doctor") return doctorCommand();
  console.error("Usage:\n  codex validate <project.json> [--json|--sarif] [--profile=core|strict] [--output=file]\n  codex inspect <project.json> [--json]\n  codex graph <project.json> [--format=json|dot] [--relations=contains,derivedFrom] [--output=file]\n  codex diagnostics [--json] [--severity=error|warning|info]\n  codex doctor");
  process.exitCode = 2;
}

void main();
