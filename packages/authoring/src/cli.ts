#!/usr/bin/env node

import { writeFile } from "node:fs/promises";
import process from "node:process";
import { compileAuthoringProject } from "./index.js";

function optionValue(args: string[], name: string): string | undefined {
  return args.find((arg) => arg.startsWith(`${name}=`))?.slice(name.length + 1);
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
    if (outputPath) {
      await writeFile(outputPath, output, "utf8");
      console.log(`COMPILED: ${project.id} — ${project.objects.length} objects -> ${outputPath}`);
    } else process.stdout.write(output);
  } catch (error) {
    console.error(`Authoring compilation failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}

void main();
