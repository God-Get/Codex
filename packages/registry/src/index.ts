import { readFileSync } from "node:fs";
import { resolve } from "node:path";

export const lifecycleStatuses = [
  "draft",
  "review",
  "approved",
  "published",
  "deprecated",
  "archived"
] as const;

export const objectTypes = [
  "project",
  "work",
  "edition",
  "volume",
  "chapter",
  "section",
  "fragment",
  "translation",
  "commentary",
  "source",
  "term",
  "document",
  "requirement",
  "validation"
] as const;

export const relationTypes = [
  "contains",
  "belongsTo",
  "references",
  "quotes",
  "translates",
  "defines",
  "explains",
  "extends",
  "derivedFrom",
  "dependsOn",
  "supersedes",
  "relatedTo"
] as const;

export const relationConstraints = {
  contains: {
    sources: ["project", "work", "edition", "volume", "chapter", "section", "document"],
    targets: ["work", "edition", "volume", "chapter", "section", "fragment", "translation", "commentary", "source", "term", "document", "requirement", "validation"]
  },
  translates: { sources: ["translation"], targets: ["work", "edition", "volume", "chapter", "section", "fragment", "source"] },
  defines: { sources: ["term", "document"], targets: ["term"] },
  explains: { sources: ["commentary", "document"], targets: ["work", "edition", "volume", "chapter", "section", "fragment", "term"] }
} as const;

export interface RegistryData {
  objectTypes: readonly string[];
  relationTypes: readonly string[];
  lifecycleStatuses: readonly string[];
  relationConstraints: Readonly<Record<string, { sources: readonly string[]; targets: readonly string[] }>>;
}

interface RegistryListFile {
  values: string[];
}

interface RelationConstraintFile {
  constraints: Record<string, { sources: string[]; targets: string[] }>;
}

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

export function loadRegistry(rootDirectory = process.cwd()): RegistryData {
  const registryDirectory = resolve(rootDirectory, "registry");
  return {
    objectTypes: readJson<RegistryListFile>(resolve(registryDirectory, "object-types.json")).values,
    relationTypes: readJson<RegistryListFile>(resolve(registryDirectory, "relation-types.json")).values,
    lifecycleStatuses: readJson<RegistryListFile>(resolve(registryDirectory, "lifecycle-statuses.json")).values,
    relationConstraints: readJson<RelationConstraintFile>(resolve(registryDirectory, "relation-constraints.json")).constraints
  };
}

export const defaultRegistry: RegistryData = {
  objectTypes,
  relationTypes,
  lifecycleStatuses,
  relationConstraints
};

export const identifierPattern = /^[A-Z][A-Z0-9]{1,15}-[0-9]{4,}$/;
export const semanticVersionPattern = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

export function isRegisteredObjectType(value: string, registry: RegistryData = defaultRegistry): boolean {
  return registry.objectTypes.includes(value);
}

export function isRegisteredRelationType(value: string, registry: RegistryData = defaultRegistry): boolean {
  return registry.relationTypes.includes(value);
}

export function isRegisteredLifecycleStatus(value: string, registry: RegistryData = defaultRegistry): boolean {
  return registry.lifecycleStatuses.includes(value);
}
