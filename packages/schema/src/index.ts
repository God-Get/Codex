import type { CodexProject, Diagnostic } from "@codex/core";

const projectKeys = new Set(["codexVersion", "id", "title", "profile", "objects"]);
const objectKeys = new Set(["id", "type", "title", "version", "status", "language", "derivedFrom", "relations", "metadata"]);
const relationKeys = new Set(["type", "target"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function add(diagnostics: Diagnostic[], code: string, message: string, path: string): void {
  diagnostics.push({ code, severity: "error", message, path });
}

function rejectAdditionalProperties(
  value: Record<string, unknown>,
  allowed: Set<string>,
  path: string,
  diagnostics: Diagnostic[]
): void {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) add(diagnostics, "ERR-2004", `Additional property is not allowed: ${key}`, `${path}.${key}`);
  }
}

export function validateProjectSchema(value: unknown): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  if (!isRecord(value)) {
    add(diagnostics, "ERR-2001", "Project must be a JSON object.", "$" );
    return diagnostics;
  }

  rejectAdditionalProperties(value, projectKeys, "$", diagnostics);
  for (const key of ["codexVersion", "id", "title", "objects"] as const) {
    if (!(key in value)) add(diagnostics, "ERR-2002", `Missing required property: ${key}`, `$.${key}`);
  }

  for (const key of ["codexVersion", "id", "title"] as const) {
    if (key in value && typeof value[key] !== "string") add(diagnostics, "ERR-2003", `${key} must be a string.`, `$.${key}`);
  }
  if ("profile" in value && typeof value.profile !== "string") add(diagnostics, "ERR-2003", "profile must be a string.", "$.profile");
  if (!("objects" in value) || !Array.isArray(value.objects)) {
    if ("objects" in value) add(diagnostics, "ERR-2003", "objects must be an array.", "$.objects");
    return diagnostics;
  }

  for (const [index, item] of value.objects.entries()) {
    const base = `$.objects[${index}]`;
    if (!isRecord(item)) {
      add(diagnostics, "ERR-2003", "Object entry must be a JSON object.", base);
      continue;
    }
    rejectAdditionalProperties(item, objectKeys, base, diagnostics);
    for (const key of ["id", "type", "title", "version", "status"] as const) {
      if (!(key in item)) add(diagnostics, "ERR-2002", `Missing required property: ${key}`, `${base}.${key}`);
      else if (typeof item[key] !== "string") add(diagnostics, "ERR-2003", `${key} must be a string.`, `${base}.${key}`);
    }
    if ("language" in item && typeof item.language !== "string") add(diagnostics, "ERR-2003", "language must be a string.", `${base}.language`);
    if ("derivedFrom" in item) {
      if (!Array.isArray(item.derivedFrom)) add(diagnostics, "ERR-2003", "derivedFrom must be an array.", `${base}.derivedFrom`);
      else for (const [sourceIndex, source] of item.derivedFrom.entries()) {
        if (typeof source !== "string") add(diagnostics, "ERR-2003", "derivedFrom entries must be strings.", `${base}.derivedFrom[${sourceIndex}]`);
      }
    }
    if ("relations" in item) {
      if (!Array.isArray(item.relations)) add(diagnostics, "ERR-2003", "relations must be an array.", `${base}.relations`);
      else for (const [relationIndex, relation] of item.relations.entries()) {
        const relationPath = `${base}.relations[${relationIndex}]`;
        if (!isRecord(relation)) {
          add(diagnostics, "ERR-2003", "Relation entry must be a JSON object.", relationPath);
          continue;
        }
        rejectAdditionalProperties(relation, relationKeys, relationPath, diagnostics);
        for (const key of ["type", "target"] as const) {
          if (!(key in relation)) add(diagnostics, "ERR-2002", `Missing required property: ${key}`, `${relationPath}.${key}`);
          else if (typeof relation[key] !== "string") add(diagnostics, "ERR-2003", `${key} must be a string.`, `${relationPath}.${key}`);
        }
      }
    }
    if ("metadata" in item && !isRecord(item.metadata)) add(diagnostics, "ERR-2003", "metadata must be a JSON object.", `${base}.metadata`);
  }

  return diagnostics;
}

export function isSchemaValid(value: unknown): value is CodexProject {
  return validateProjectSchema(value).length === 0;
}
