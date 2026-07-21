#!/usr/bin/env node

import process from "node:process";
import { compileProject } from "./index.js";

const API_VERSION = "0.2";

function optionValue(args: string[], name: string): string | undefined {
  return args.find((arg) => arg.startsWith(`${name}=`))?.slice(name.length + 1);
}

function writeJson(value: unknown, stream: NodeJS.WriteStream = process.stdout): void {
  stream.write(`${JSON.stringify(value, null, 2)}\n`);
}

async function main(): Promise<void> {
  const [, , root, ...args] = process.argv;
  const command = "import.compile";
  const json = [root, ...args].includes("--json");
  if (!root || root.startsWith("--")) {
    const diagnostic = { code: "IMPORT-1001", message: "Usage: codex-import <directory> [--output=project.json] [--profile=id] [--codex-version=x.y.z] [--json]" };
    if (json) writeJson({ ok: false, apiVersion: API_VERSION, command, diagnostic }, process.stderr);
    else console.error(`${diagnostic.code}: ${diagnostic.message}`);
    process.exitCode = 2;
    return;
  }

  try {
    const outputPath = optionValue(args, "--output");
    const result = await compileProject(root, {
      output: outputPath,
      profile: optionValue(args, "--profile"),
      codexVersion: optionValue(args, "--codex-version")
    });
    const payload = {
      project: result.project,
      files: result.files,
      statistics: result.graph.statistics(),
      ...(outputPath ? { outputPath } : {})
    };
    if (json) writeJson({ ok: true, apiVersion: API_VERSION, command, result: payload });
    else console.log(`IMPORTED: ${result.project.id} — ${result.project.objects.length} objects${outputPath ? ` -> ${outputPath}` : ""}`);
  } catch (error) {
    const diagnostic = { code: "IMPORT-1002", message: error instanceof Error ? error.message : String(error) };
    if (json) writeJson({ ok: false, apiVersion: API_VERSION, command, diagnostic }, process.stderr);
    else console.error(`${diagnostic.code}: ${diagnostic.message}`);
    process.exitCode = 1;
  }
}

void main();
