#!/usr/bin/env node

import process from "node:process";
import { resolve } from "node:path";
import { compileProject } from "./index.js";

function optionValue(args: string[], name: string): string | undefined {
  return args.find(argument => argument.startsWith(`${name}=`))?.slice(name.length + 1);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const root = args.find(argument => !argument.startsWith("--"));
  if (!root) {
    console.error("Usage: codex-compile <project-directory> [--output=project.json] [--profile=id] [--json]");
    process.exitCode = 2;
    return;
  }

  try {
    const output = optionValue(args, "--output") ?? resolve(root, "project.json");
    const result = await compileProject(root, {
      output,
      profile: optionValue(args, "--profile")
    });
    if (args.includes("--json")) {
      process.stdout.write(`${JSON.stringify({
        output,
        projectId: result.project.id,
        profile: result.project.profile,
        files: result.files,
        statistics: result.graph.statistics()
      }, null, 2)}\n`);
    } else {
      const statistics = result.graph.statistics();
      console.log(`COMPILED: ${result.project.id} -> ${output}`);
      console.log(`OBJECTS: ${statistics.objects}`);
      console.log(`RELATIONS: ${statistics.relations}`);
      console.log(`ROOTS: ${statistics.roots}`);
    }
  } catch (error) {
    console.error(`Compilation failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}

void main();
