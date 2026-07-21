import { readdir, readFile, stat } from "node:fs/promises";
import { basename, join, relative, resolve, sep } from "node:path";
import type { CodexObject, CodexProject, LifecycleStatus } from "@codex/core";

export type AuthoringErrorCode =
  | "AUTH-1001"
  | "AUTH-1002"
  | "AUTH-1003"
  | "AUTH-1004"
  | "AUTH-1005"
  | "AUTH-1006"
  | "AUTH-1007"
  | "AUTH-1008"
  | "AUTH-1009";

export interface AuthoringDiagnostic {
  code: AuthoringErrorCode;
  message: string;
  source?: string;
  line?: number;
  column?: number;
}

export class AuthoringError extends Error {
  readonly diagnostic: AuthoringDiagnostic;

  constructor(diagnostic: AuthoringDiagnostic) {
    const location = diagnostic.source
      ? `${diagnostic.source}${diagnostic.line ? `:${diagnostic.line}${diagnostic.column ? `:${diagnostic.column}` : ""}` : ""}: `
      : "";
    super(`${location}${diagnostic.message}`);
    this.name = "AuthoringError";
    this.diagnostic = diagnostic;
  }
}

export function authoringDiagnostic(error: unknown): AuthoringDiagnostic {
  return error instanceof AuthoringError
    ? error.diagnostic
    : { code: "AUTH-1009", message: error instanceof Error ? error.message : String(error) };
}

export interface MarkdownDocument {
  attributes: Record<string, unknown>;
  body: string;
}

export interface CompileAuthoringOptions {
  projectFile?: string;
  objectsDirectory?: string;
}

function fail(code: AuthoringErrorCode, message: string, source?: string, line?: number, column?: number): never {
  throw new AuthoringError({ code, message, source, line, column });
}

function parseScalar(source: string): unknown {
  const value = source.trim();
  if (value === "true") return true;
  if (value === "false") return false;
  if (value === "null") return null;
  if (/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value)) return Number(value);
  if ((value.startsWith("[") && value.endsWith("]")) || (value.startsWith("{") && value.endsWith("}"))) {
    try { return JSON.parse(value) as unknown; } catch { return value; }
  }
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) return value.slice(1, -1);
  return value;
}

export function parseMarkdownDocument(source: string, sourceName = "document.md"): MarkdownDocument {
  const normalized = source.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n");
  if (!normalized.startsWith("---\n")) fail("AUTH-1001", "missing front matter", sourceName, 1, 1);
  const end = normalized.indexOf("\n---\n", 4);
  if (end < 0) fail("AUTH-1002", "unterminated front matter", sourceName, 1, 1);
  const attributes: Record<string, unknown> = {};
  for (const [index, line] of normalized.slice(4, end).split("\n").entries()) {
    if (!line.trim() || line.trimStart().startsWith("#")) continue;
    const lineNumber = index + 2;
    const separator = line.indexOf(":");
    if (separator < 1) fail("AUTH-1003", "expected key: value", sourceName, lineNumber, 1);
    const key = line.slice(0, separator).trim();
    if (!/^[A-Za-z][A-Za-z0-9_-]*$/.test(key)) fail("AUTH-1004", `invalid key ${key}`, sourceName, lineNumber, 1);
    if (Object.hasOwn(attributes, key)) fail("AUTH-1005", `duplicate key ${key}`, sourceName, lineNumber, 1);
    attributes[key] = parseScalar(line.slice(separator + 1));
  }
  return { attributes, body: normalized.slice(end + 5).trimEnd() };
}

function requiredString(attributes: Record<string, unknown>, key: string, sourceName: string): string {
  const value = attributes[key];
  if (typeof value !== "string" || value.length === 0) fail("AUTH-1006", `${key} must be a non-empty string`, sourceName);
  return value;
}

function optionalStrings(attributes: Record<string, unknown>, key: string, sourceName: string): string[] | undefined {
  const value = attributes[key];
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) fail("AUTH-1007", `${key} must be a JSON string array`, sourceName);
  return value as string[];
}

export function compileMarkdownObject(source: string, sourceName = "object.md"): CodexObject {
  const { attributes, body } = parseMarkdownDocument(source, sourceName);
  const known = new Set(["id", "type", "title", "version", "status", "language", "derivedFrom", "relations"]);
  const metadata = Object.fromEntries(Object.entries(attributes).filter(([key]) => !known.has(key)));
  metadata.content = body;
  metadata.sourcePath = sourceName;
  const status = requiredString(attributes, "status", sourceName) as LifecycleStatus;
  const relations = attributes.relations;
  if (relations !== undefined && (!Array.isArray(relations) || relations.some((item) => typeof item !== "object" || item === null || typeof (item as { type?: unknown }).type !== "string" || typeof (item as { target?: unknown }).target !== "string"))) {
    fail("AUTH-1008", "relations must be a JSON array of {type,target}", sourceName);
  }
  const derivedFrom = optionalStrings(attributes, "derivedFrom", sourceName);
  return {
    id: requiredString(attributes, "id", sourceName),
    type: requiredString(attributes, "type", sourceName),
    title: requiredString(attributes, "title", sourceName),
    version: requiredString(attributes, "version", sourceName),
    status,
    ...(typeof attributes.language === "string" ? { language: attributes.language } : {}),
    ...(derivedFrom ? { derivedFrom } : {}),
    ...(relations ? { relations: relations as CodexObject["relations"] } : {}),
    metadata
  };
}

async function markdownFiles(root: string): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) files.push(...await markdownFiles(path));
    else if (entry.isFile() && entry.name.endsWith(".md")) files.push(path);
  }
  return files;
}

function confinedPath(root: string, path: string): string {
  const resolvedRoot = resolve(root);
  const resolvedPath = resolve(path);
  if (resolvedPath !== resolvedRoot && !resolvedPath.startsWith(`${resolvedRoot}${sep}`)) fail("AUTH-1009", `path escapes authoring root: ${path}`);
  return resolvedPath;
}

export async function compileAuthoringProject(rootDirectory: string, options: CompileAuthoringOptions = {}): Promise<CodexProject> {
  const root = resolve(rootDirectory);
  if (!(await stat(root)).isDirectory()) fail("AUTH-1009", `authoring root is not a directory: ${rootDirectory}`);
  const projectPath = confinedPath(root, join(root, options.projectFile ?? "project.md"));
  const objectsRoot = confinedPath(root, join(root, options.objectsDirectory ?? "objects"));
  const projectDocument = parseMarkdownDocument(await readFile(projectPath, "utf8"), relative(root, projectPath));
  const objectPaths = await markdownFiles(objectsRoot);
  const objects = await Promise.all(objectPaths.map(async (path) => compileMarkdownObject(await readFile(path, "utf8"), relative(root, path))));
  const ids = new Set<string>();
  for (const object of objects) {
    if (ids.has(object.id)) fail("AUTH-1009", `duplicate object id: ${object.id}`, String(object.metadata?.sourcePath ?? object.id));
    ids.add(object.id);
  }
  return {
    codexVersion: requiredString(projectDocument.attributes, "codexVersion", basename(projectPath)),
    id: requiredString(projectDocument.attributes, "id", basename(projectPath)),
    title: requiredString(projectDocument.attributes, "title", basename(projectPath)),
    ...(typeof projectDocument.attributes.profile === "string" ? { profile: projectDocument.attributes.profile } : {}),
    objects
  };
}
