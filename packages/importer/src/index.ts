import { promises as fs } from "node:fs";
import path from "node:path";
import type { CodexObject, CodexProject, LifecycleStatus } from "@codex/core";
import { buildGraph, type CodexGraph } from "@codex/graph";

export interface SourceLocation { file: string; line: number; column: number; }
export interface ParsedDocument { metadata: Record<string, unknown>; body: string; source: SourceLocation; }
export interface CompileOptions { codexVersion?: string; profile?: string; output?: string; }
export interface CompileResult { project: CodexProject; graph: CodexGraph; files: string[]; }

function portablePath(value: string): string {
  return value.replaceAll(path.sep, "/");
}

export function parseFrontMatter(source: string, file = "<memory>"): ParsedDocument {
  const normalized = source.replace(/\r\n/g, "\n");
  if (!normalized.startsWith("---\n")) throw new Error(`${file}: missing YAML front matter`);
  const end = normalized.indexOf("\n---\n", 4);
  if (end < 0) throw new Error(`${file}: unterminated YAML front matter`);
  const header = normalized.slice(4, end);
  const metadata: Record<string, unknown> = {};
  for (const [index, raw] of header.split("\n").entries()) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const separator = line.indexOf(":");
    if (separator < 1) throw new Error(`${file}:${index + 2}: invalid front matter entry`);
    const key = line.slice(0, separator).trim();
    metadata[key] = parseScalar(line.slice(separator + 1).trim());
  }
  return { metadata, body: normalized.slice(end + 5).trim(), source: { file, line: 1, column: 1 } };
}

export async function scanProject(root: string): Promise<string[]> {
  const files: string[] = [];
  async function walk(directory: string): Promise<void> {
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      if (entry.name.startsWith(".") || entry.name === "node_modules" || entry.name === "dist") continue;
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) await walk(absolute);
      else if (entry.isFile() && entry.name.endsWith(".md")) files.push(absolute);
    }
  }
  await walk(root);
  return files.sort();
}

export async function compileProject(root: string, options: CompileOptions = {}): Promise<CompileResult> {
  const descriptor = await readProjectDescriptor(root);
  const files = await scanProject(root);
  const objects: CodexObject[] = [];
  for (const file of files) {
    const parsed = parseFrontMatter(await fs.readFile(file, "utf8"), portablePath(path.relative(root, file)));
    objects.push(toObject(parsed));
  }
  const project: CodexProject = {
    codexVersion: options.codexVersion ?? stringValue(descriptor.codexVersion) ?? "0.2.0",
    id: stringValue(descriptor.id) ?? path.basename(path.resolve(root)),
    title: stringValue(descriptor.title) ?? path.basename(path.resolve(root)),
    profile: options.profile ?? stringValue(descriptor.profile),
    objects
  };
  const graph = buildGraph(project);
  if (options.output) {
    const outputPath = path.resolve(options.output);
    await fs.mkdir(path.dirname(outputPath), { recursive: true });
    await fs.writeFile(outputPath, `${JSON.stringify(project, null, 2)}\n`, "utf8");
  }
  return { project, graph, files: files.map((file) => portablePath(path.relative(root, file))) };
}

function toObject(document: ParsedDocument): CodexObject {
  const id = requiredString(document, "id");
  const type = requiredString(document, "type");
  const relationValues = stringArray(document.metadata.relations);
  return {
    id,
    type,
    title: stringValue(document.metadata.title) ?? firstHeading(document.body) ?? id,
    version: stringValue(document.metadata.version) ?? "0.1.0",
    status: (stringValue(document.metadata.status) ?? "draft") as LifecycleStatus,
    language: stringValue(document.metadata.language),
    derivedFrom: stringArray(document.metadata.derivedFrom),
    relations: relationValues.map((value) => {
      const separator = value.indexOf("->");
      if (separator < 1) throw new Error(`${document.source.file}: invalid relation '${value}'`);
      return { type: value.slice(0, separator).trim(), target: value.slice(separator + 2).trim() };
    }),
    metadata: { body: document.body, source: document.source }
  };
}

async function readProjectDescriptor(root: string): Promise<Record<string, unknown>> {
  for (const filename of ["project.yml", "project.yaml"]) {
    try {
      const text = await fs.readFile(path.join(root, filename), "utf8");
      const result: Record<string, unknown> = {};
      for (const raw of text.replace(/\r\n/g, "\n").split("\n")) {
        const line = raw.trim();
        if (!line || line.startsWith("#")) continue;
        const separator = line.indexOf(":");
        if (separator > 0) result[line.slice(0, separator).trim()] = parseScalar(line.slice(separator + 1).trim());
      }
      return result;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  return {};
}

function parseScalar(value: string): unknown {
  if (value === "true") return true;
  if (value === "false") return false;
  if (value === "null") return null;
  if (/^-?\d+(\.\d+)?$/.test(value)) return Number(value);
  if (value.startsWith("[") && value.endsWith("]")) return value.slice(1, -1).split(",").map((item) => stripQuotes(item.trim())).filter(Boolean);
  return stripQuotes(value);
}
function stripQuotes(value: string): string { return value.replace(/^(["'])(.*)\1$/, "$2"); }
function stringValue(value: unknown): string | undefined { return typeof value === "string" && value.length ? value : undefined; }
function stringArray(value: unknown): string[] { return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : stringValue(value) ? [stringValue(value)!] : []; }
function requiredString(document: ParsedDocument, key: string): string { const value = stringValue(document.metadata[key]); if (!value) throw new Error(`${document.source.file}: required field '${key}' is missing`); return value; }
function firstHeading(body: string): string | undefined { return body.split("\n").map((line) => line.match(/^#\s+(.+)$/)?.[1]).find(Boolean); }
