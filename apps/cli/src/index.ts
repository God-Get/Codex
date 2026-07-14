#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import process from "node:process";
import type { CodexProject } from "@codex/core";
import { validateProject } from "@codex/validator";

async function main(): Promise<void> {
  const [, , command, filePath] = process.argv;

  if (command !== "validate" || !filePath) {
    console.error("Usage: codex validate <project.json>");
    process.exitCode = 2;
    return;
  }

  let project: CodexProject;
  try {
    const raw = await readFile(filePath, "utf8");
    project = JSON.parse(raw) as CodexProject;
  } catch (error) {
    console.error(`Failed to read project: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 2;
    return;
  }

  const report = validateProject(project);
  for (const diagnostic of report.diagnostics) {
    const location = diagnostic.path ? ` (${diagnostic.path})` : "";
    console.log(`${diagnostic.severity.toUpperCase()} ${diagnostic.code}: ${diagnostic.message}${location}`);
  }

  if (report.valid) {
    console.log("PASS: project conforms to the current CODEX MVP checks.");
    return;
  }

  console.error("FAIL: project does not conform to the current CODEX MVP checks.");
  process.exitCode = 1;
}

void main();
