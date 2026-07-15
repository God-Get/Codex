#!/usr/bin/env node

import { access, readFile } from "node:fs/promises";
import process from "node:process";
import type { CodexProject, ValidationProfile, ValidationReport } from "@codex/core";
import { isRegisteredValidationProfile, loadRegistry } from "@codex/registry";
import { buildProjectGraph, graphToDot, inspectProject, validateProject } from "@codex/validator";

function printHumanReport(report: ValidationReport): void {
  for (const diagnostic of report.diagnostics) {
    const location = diagnostic.path ? ` (${diagnostic.path})` : "";
    console.log(`${diagnostic.severity.toUpperCase()} ${diagnostic.code}: ${diagnostic.message}${location}`);
  }
  console.log(`SUMMARY: ${report.summary.errors} error(s), ${report.summary.warnings} warning(s), ${report.summary.info} info message(s).`);
}

async function loadProject(filePath: string): Promise<CodexProject | undefined> {
  try {
    const raw = await readFile(filePath, "utf8");
    return JSON.parse(raw) as CodexProject;
  } catch (error) {
    console.error(`Failed to read project: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 2;
    return undefined;
  }
}

async function validateCommand(filePath: string, args: string[]): Promise<void> {
  const project = await loadProject(filePath);
  if (!project) return;

  let registry;
  try {
    registry = loadRegistry();
  } catch (error) {
    console.error(`Failed to load registry: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 2;
    return;
  }

  const jsonOutput = args.includes("--json");
  const profileArgument = args.find((arg) => arg.startsWith("--profile="));
  const profileValue = profileArgument?.split("=")[1] ?? "core";
  if (!isRegisteredValidationProfile(profileValue, registry)) {
    console.error(`Unknown validation profile: ${profileValue}. Registered profiles: ${registry.validationProfiles.join(", ")}`);
    process.exitCode = 2;
    return;
  }
  const profile = profileValue as ValidationProfile;

  const report = validateProject(project, { registry, profile });
  if (jsonOutput) console.log(JSON.stringify({ profile, ...report }, null, 2));
  else {
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
  if (jsonOutput) {
    console.log(JSON.stringify(inspection, null, 2));
    return;
  }

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
  const graph = buildProjectGraph(project);
  const formatArgument = args.find((arg) => arg.startsWith("--format="));
  const format = formatArgument?.split("=")[1] ?? "json";
  if (format === "json") {
    console.log(JSON.stringify(graph, null, 2));
    return;
  }
  if (format === "dot") {
    process.stdout.write(graphToDot(graph));
    return;
  }
  console.error(`Unknown graph format: ${format}. Supported formats: json, dot`);
  process.exitCode = 2;
}

async function doctorCommand(): Promise<void> {
  const checks: Array<{ name: string; ok: boolean; detail: string }> = [];
  const nodeMajor = Number.parseInt(process.versions.node.split(".")[0] ?? "0", 10);
  checks.push({ name: "Node.js", ok: nodeMajor >= 22, detail: `detected ${process.versions.node}; required >= 22` });

  const requiredFiles = [
    "package.json",
    "tsconfig.json",
    "schemas/project.schema.json",
    "schemas/registry-list.schema.json",
    "schemas/relation-constraints.schema.json",
    "examples/minimal-project.json",
    "registry/object-types.json",
    "registry/relation-types.json",
    "registry/lifecycle-statuses.json",
    "registry/validation-profiles.json",
    "registry/languages.json",
    "registry/relation-constraints.json"
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
    const registry = loadRegistry();
    checks.push({
      name: "Registry",
      ok: registry.objectTypes.length > 0 && registry.relationTypes.length > 0 && registry.lifecycleStatuses.length > 0 && registry.validationProfiles.length > 0 && registry.languages.length > 0,
      detail: `${registry.objectTypes.length} object types, ${registry.relationTypes.length} relation types, ${registry.lifecycleStatuses.length} statuses, ${registry.validationProfiles.length} validation profiles, ${registry.languages.length} languages`
    });
  } catch (error) {
    checks.push({ name: "Registry", ok: false, detail: error instanceof Error ? error.message : String(error) });
  }

  for (const check of checks) console.log(`${check.ok ? "PASS" : "FAIL"}: ${check.name} — ${check.detail}`);
  if (checks.some((check) => !check.ok)) {
    process.exitCode = 1;
    return;
  }
  console.log("PASS: CODEX development environment is ready.");
}

async function main(): Promise<void> {
  const [, , command, argument, ...args] = process.argv;

  if (command === "validate" && argument) {
    await validateCommand(argument, args);
    return;
  }
  if (command === "inspect" && argument) {
    await inspectCommand(argument, args.includes("--json"));
    return;
  }
  if (command === "graph" && argument) {
    await graphCommand(argument, args);
    return;
  }
  if (command === "doctor") {
    await doctorCommand();
    return;
  }

  console.error("Usage:\n  codex validate <project.json> [--json] [--profile=core|strict]\n  codex inspect <project.json> [--json]\n  codex graph <project.json> [--format=json|dot]\n  codex doctor");
  process.exitCode = 2;
}

void main();
