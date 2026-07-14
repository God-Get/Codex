#!/usr/bin/env node

import { access, readFile } from "node:fs/promises";
import process from "node:process";
import type { CodexProject, ValidationReport } from "@codex/core";
import { lifecycleStatuses, objectTypes, relationTypes } from "@codex/registry";
import { validateProject } from "@codex/validator";

function printHumanReport(report: ValidationReport): void {
  for (const diagnostic of report.diagnostics) {
    const location = diagnostic.path ? ` (${diagnostic.path})` : "";
    console.log(`${diagnostic.severity.toUpperCase()} ${diagnostic.code}: ${diagnostic.message}${location}`);
  }

  if (report.valid) {
    console.log("PASS: project conforms to the current CODEX MVP checks.");
  } else {
    console.error("FAIL: project does not conform to the current CODEX MVP checks.");
  }
}

async function validateCommand(filePath: string, jsonOutput: boolean): Promise<void> {
  let project: CodexProject;
  try {
    const raw = await readFile(filePath, "utf8");
    project = JSON.parse(raw) as CodexProject;
  } catch (error) {
    const message = `Failed to read project: ${error instanceof Error ? error.message : String(error)}`;
    if (jsonOutput) {
      console.log(JSON.stringify({ valid: false, diagnostics: [{ code: "ERR-0001", severity: "error", message }] }, null, 2));
    } else {
      console.error(message);
    }
    process.exitCode = 2;
    return;
  }

  const report = validateProject(project);
  if (jsonOutput) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    printHumanReport(report);
  }

  if (!report.valid) process.exitCode = 1;
}

async function doctorCommand(): Promise<void> {
  const checks: Array<{ name: string; ok: boolean; detail: string }> = [];
  const nodeMajor = Number.parseInt(process.versions.node.split(".")[0] ?? "0", 10);
  checks.push({
    name: "Node.js",
    ok: nodeMajor >= 22,
    detail: `detected ${process.versions.node}; required >= 22`
  });

  const requiredFiles = [
    "package.json",
    "tsconfig.json",
    "schemas/codex-project.schema.json",
    "registry/object-types.json",
    "registry/relation-types.json",
    "registry/lifecycle-statuses.json",
    "examples/minimal-project.json"
  ];

  for (const file of requiredFiles) {
    try {
      await access(file);
      checks.push({ name: file, ok: true, detail: "present" });
    } catch {
      checks.push({ name: file, ok: false, detail: "missing" });
    }
  }

  checks.push({
    name: "Registry",
    ok: objectTypes.length > 0 && relationTypes.length > 0 && lifecycleStatuses.length > 0,
    detail: `${objectTypes.length} object types, ${relationTypes.length} relation types, ${lifecycleStatuses.length} statuses`
  });

  for (const check of checks) {
    console.log(`${check.ok ? "PASS" : "FAIL"}: ${check.name} — ${check.detail}`);
  }

  if (checks.some((check) => !check.ok)) {
    process.exitCode = 1;
    return;
  }

  console.log("PASS: CODEX development environment is ready.");
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const command = args[0];

  if (command === "validate") {
    const filePath = args.find((arg) => !arg.startsWith("--") && arg !== "validate");
    if (!filePath) {
      console.error("Usage: codex validate <project.json> [--json]");
      process.exitCode = 2;
      return;
    }
    await validateCommand(filePath, args.includes("--json"));
    return;
  }

  if (command === "doctor") {
    await doctorCommand();
    return;
  }

  console.error("Usage:\n  codex validate <project.json> [--json]\n  codex doctor");
  process.exitCode = 2;
}

void main();
