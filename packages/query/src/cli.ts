#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import process from "node:process";
import type { CodexProject } from "@codex/core";
import { queryProject } from "./index.js";

const API_VERSION = "0.2";

function writeJson(value: unknown, stream: NodeJS.WriteStream = process.stdout): void {
  stream.write(`${JSON.stringify(value, null, 2)}\n`);
}

async function main(): Promise<void> {
  const [, , projectPath, ...args] = process.argv;
  const command = "query.execute";
  const json = args.includes("--json");
  const expression = args.find((arg) => !arg.startsWith("--"));
  if (!projectPath || projectPath.startsWith("--") || !expression) {
    const diagnostic = { code: "QUERY-1001", message: "Usage: codex-query <project.json> <expression> [--json]" };
    if (json) writeJson({ ok: false, apiVersion: API_VERSION, command, diagnostic }, process.stderr);
    else console.error(`${diagnostic.code}: ${diagnostic.message}`);
    process.exitCode = 2;
    return;
  }

  try {
    const project = JSON.parse(await readFile(projectPath, "utf8")) as CodexProject;
    const result = queryProject(project, expression);
    if (json) writeJson({ ok: true, apiVersion: API_VERSION, command, result });
    else {
      for (const object of result.objects) console.log(`${object.id}\t${object.type}\t${object.title}`);
      console.log(`TOTAL: ${result.count}`);
    }
  } catch (error) {
    const diagnostic = { code: "QUERY-1002", message: error instanceof Error ? error.message : String(error), source: projectPath };
    if (json) writeJson({ ok: false, apiVersion: API_VERSION, command, diagnostic }, process.stderr);
    else console.error(`${diagnostic.code}: ${diagnostic.message}`);
    process.exitCode = 1;
  }
}

void main();
