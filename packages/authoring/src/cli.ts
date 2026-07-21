#!/usr/bin/env node

import { writeFile } from "node:fs/promises";
import process from "node:process";
import { authoringDiagnostic, compileAuthoringProject } from "./index.js";

const CLI_API_VERSION = "0.2";
const COMMAND = "authoring.compile";

function optionValue(args: string[], name: string): string | undefined {
  return args.find((arg) => arg.startsWith(`${name}=`))?.slice(name.length + 1);
}

function writeJson(value: unknown, stream: NodeJS.WriteStream = process.stdout): void {
  stream.write(`${JSON.stringify(value, null, 2)}\n`);
}

function diagnosticLocation(diagnostic: { source?: string; line?: number; column?: number }): string {
  if (!diagnostic.source) return "";
  const line = diagnostic.line === undefined ? "" : `:${diagnostic.line}`;
  const column = diagnostic.column === undefined ? "" : `:${diagnostic.column}`;
  return `${diagnostic.source}${line}${column}: `;
}

async function main(): Promise<void> {
  const [, , root = ".", ...args] = process.argv;
  try {
    const project = await compileAuthoringProject(root, {
      projectFile: optionValue(args, "--project"),
      objectsDirectory: optionValue(args, "--objects")
    });
    const output = `${JSON.stringify(project, null, 2)}\n`;
    const outputPath = optionValue(args, "--output");
    if (outputPath) await writeFile(outputPath, output, "utf8");

    if (args.includes("--json")) {
      writeJson({
        ok: true,
        apiVersion: CLI_API_VERSION,
        command: COMMAND,
        result: {
          ...(outputPath ? { outputPath } : {}),
          project,
          projectId: project.id,
          objectCount: project.objects.length
        }
      });
    } else if (outputPath) {
      console.log(`COMPILED: ${project.id} — ${project.objects.length} objects -> ${outputPath}`);
    } else {
      process.stdout.write(output);
    }
  } catch (error) {
    const diagnostic = authoringDiagnostic(error);
    if (args.includes("--json")) {
      writeJson({ ok: false, apiVersion: CLI_API_VERSION, command: COMMAND, diagnostic }, process.stderr);
    } else {
      console.error(`Authoring compilation failed [${diagnostic.code}]: ${diagnosticLocation(diagnostic)}${diagnostic.message}`);
    }
    process.exitCode = 1;
  }
}

void main();