#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import process from "node:process";
import type { CodexProject } from "@codex/core";
import { compileProject } from "@codex/importer";
import { queryProject } from "@codex/query";

function optionValue(args: string[], name: string): string | undefined {
  return args.find((arg) => arg.startsWith(`${name}=`))?.slice(name.length + 1);
}

async function compileCommand(root: string, args: string[]): Promise<void> {
  try {
    const output = optionValue(args, "--output") ?? ".codex/project.json";
    const profile = optionValue(args, "--profile");
    const result = await compileProject(root, { output, profile });
    const summary = {
      projectId: result.project.id,
      profile: result.project.profile,
      output,
      files: result.files.length,
      ...result.graph.statistics()
    };
    if (args.includes("--json")) process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
    else {
      console.log(`COMPILED: ${summary.projectId} -> ${output}`);
      console.log(`PROFILE: ${summary.profile ?? "core"}`);
      console.log(`FILES: ${summary.files}`);
      console.log(`OBJECTS: ${summary.objects}`);
      console.log(`RELATIONS: ${summary.relations}`);
      console.log(`ROOTS: ${summary.roots}`);
    }
  } catch (error) {
    console.error(`Compile failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}

async function queryCommand(projectPath: string, args: string[]): Promise<void> {
  const expression = args.filter((arg) => !arg.startsWith("--")).join(" ").trim();
  if (!expression) {
    console.error("Usage: codex query <project.json> <field=value [AND field=value]> [--json]");
    process.exitCode = 2;
    return;
  }
  try {
    const project = JSON.parse(await readFile(projectPath, "utf8")) as CodexProject;
    const result = queryProject(project, expression);
    if (args.includes("--json")) {
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      return;
    }
    for (const object of result.objects) console.log(`${object.id}\t${object.type}\t${object.title}`);
    console.log(`TOTAL: ${result.count}`);
  } catch (error) {
    console.error(`Query failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}

const [, , command, argument, ...args] = process.argv;
if (command === "compile" && argument) {
  await compileCommand(argument, args);
} else if (command === "compile") {
  console.error("Usage: codex compile <project-directory> [--output=path] [--profile=id] [--json]");
  process.exitCode = 2;
} else if (command === "query" && argument) {
  await queryCommand(argument, args);
} else if (command === "query") {
  console.error("Usage: codex query <project.json> <field=value [AND field=value]> [--json]");
  process.exitCode = 2;
} else {
  await import("./index.js");
}
