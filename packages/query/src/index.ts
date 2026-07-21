import type { CodexObject, CodexProject } from "@codex/core";
import { buildGraph, type CodexGraph } from "@codex/graph";

export interface QueryPredicate {
  field: string;
  value: string;
}

export interface QueryExpression {
  predicates: QueryPredicate[];
}

export interface QueryResult {
  expression: QueryExpression;
  objects: CodexObject[];
  count: number;
}

const fieldPattern = /^[A-Za-z][A-Za-z0-9_.-]*$/;

export function parseQuery(source: string): QueryExpression {
  const input = source.trim();
  if (!input) throw new Error("Query must not be empty");
  const predicates = input.split(/\s+AND\s+/i).map((clause) => {
    const separator = clause.indexOf("=");
    if (separator < 1) throw new Error(`Invalid query clause: ${clause}`);
    const field = clause.slice(0, separator).trim();
    const value = unquote(clause.slice(separator + 1).trim());
    if (!fieldPattern.test(field)) throw new Error(`Invalid query field: ${field}`);
    if (!value) throw new Error(`Query value must not be empty: ${field}`);
    return { field, value };
  });
  return { predicates };
}

export function executeQuery(graph: CodexGraph, query: string | QueryExpression): QueryResult {
  const expression = typeof query === "string" ? parseQuery(query) : query;
  const objects = [...graph.objects.values()].filter((object) =>
    expression.predicates.every((predicate) => matches(object, predicate))
  );
  return { expression, objects, count: objects.length };
}

export function queryProject(project: CodexProject, query: string | QueryExpression): QueryResult {
  return executeQuery(buildGraph(project), query);
}

function matches(object: CodexObject, predicate: QueryPredicate): boolean {
  const value = readField(object, predicate.field);
  if (Array.isArray(value)) return value.some((item) => String(item) === predicate.value);
  return value !== undefined && value !== null && String(value) === predicate.value;
}

function readField(object: CodexObject, field: string): unknown {
  if (field === "id") return object.id;
  if (field === "type") return object.type;
  if (field === "title") return object.title;
  if (field === "version") return object.version;
  if (field === "status") return object.status;
  if (field === "language") return object.language;
  if (field.startsWith("metadata.")) {
    return field.slice("metadata.".length).split(".").reduce<unknown>((current, key) => {
      if (!current || typeof current !== "object" || Array.isArray(current)) return undefined;
      return (current as Record<string, unknown>)[key];
    }, object.metadata);
  }
  return undefined;
}

function unquote(value: string): string {
  const match = value.match(/^(["'])(.*)\1$/);
  return match ? match[2] ?? "" : value;
}
