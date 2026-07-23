import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { DiagnosticDefinition, RegistryData, TranslationRules } from "@codex/registry";
import { loadRegistry } from "@codex/registry";

export interface ProfileExtensions {
  objectTypes?: string[];
  relationTypes?: string[];
  languages?: string[];
  diagnostics?: DiagnosticDefinition[];
  relationConstraints?: Record<string, { sources: string[]; targets: string[] }>;
  translationRules?: TranslationRules;
}

export interface ProfileDescriptor {
  $schema?: string;
  id: string;
  name: string;
  version: string;
  codexVersion: string;
  description?: string;
  inherits: string[];
  extensions: ProfileExtensions;
}

export interface ResolvedProfile {
  id: string;
  chain: string[];
  descriptors: ProfileDescriptor[];
  registry: RegistryData;
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}

export function listProfiles(rootDirectory = process.cwd()): ProfileDescriptor[] {
  const directory = resolve(rootDirectory, "profiles");
  return readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => resolve(directory, entry.name, "profile.json"))
    .map((path) => JSON.parse(readFileSync(path, "utf8")) as ProfileDescriptor)
    .sort((a, b) => a.id.localeCompare(b.id));
}

export function loadProfile(id: string, rootDirectory = process.cwd()): ProfileDescriptor {
  const path = resolve(rootDirectory, "profiles", id, "profile.json");
  const profile = JSON.parse(readFileSync(path, "utf8")) as ProfileDescriptor;
  if (!profile || profile.id !== id || !Array.isArray(profile.inherits) || !profile.extensions) {
    throw new Error(`Invalid CODEX profile descriptor: ${id}`);
  }
  return profile;
}

export function resolveProfile(id: string, rootDirectory = process.cwd()): ResolvedProfile {
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const ordered: ProfileDescriptor[] = [];

  function visit(profileId: string): void {
    if (visiting.has(profileId)) throw new Error(`Profile inheritance cycle: ${[...visiting, profileId].join(" -> ")}`);
    if (visited.has(profileId)) return;
    visiting.add(profileId);
    const descriptor = loadProfile(profileId, rootDirectory);
    for (const parent of descriptor.inherits) visit(parent);
    visiting.delete(profileId);
    visited.add(profileId);
    ordered.push(descriptor);
  }

  visit(id);
  const base = loadRegistry(rootDirectory);
  const constraints: Record<string, { sources: readonly string[]; targets: readonly string[] }> = { ...base.relationConstraints };
  const diagnosticByCode = new Map(base.diagnostics.map((item) => [item.code, item]));
  const objectTypes = [...base.objectTypes];
  const relationTypes = [...base.relationTypes];
  const languages = [...base.languages];
  let translationRules: TranslationRules = base.translationRules;

  for (const descriptor of ordered) {
    objectTypes.push(...(descriptor.extensions.objectTypes ?? []));
    relationTypes.push(...(descriptor.extensions.relationTypes ?? []));
    languages.push(...(descriptor.extensions.languages ?? []));
    if (descriptor.extensions.translationRules) translationRules = descriptor.extensions.translationRules;
    for (const diagnostic of descriptor.extensions.diagnostics ?? []) {
      const existing = diagnosticByCode.get(diagnostic.code);
      if (existing && (existing.severity !== diagnostic.severity || existing.title !== diagnostic.title)) {
        throw new Error(`Conflicting diagnostic definition: ${diagnostic.code}`);
      }
      diagnosticByCode.set(diagnostic.code, diagnostic);
    }
    for (const [relation, constraint] of Object.entries(descriptor.extensions.relationConstraints ?? {})) {
      const existing = constraints[relation];
      if (existing && (JSON.stringify(existing.sources) !== JSON.stringify(constraint.sources) || JSON.stringify(existing.targets) !== JSON.stringify(constraint.targets))) {
        throw new Error(`Conflicting relation constraint: ${relation}`);
      }
      constraints[relation] = constraint;
    }
  }

  return {
    id,
    chain: ordered.map((item) => item.id),
    descriptors: ordered,
    registry: {
      ...base,
      objectTypes: unique(objectTypes),
      relationTypes: unique(relationTypes),
      languages: unique(languages),
      validationProfiles: unique([...base.validationProfiles, ...ordered.map((item) => item.id)]),
      relationConstraints: constraints,
      translationRules,
      diagnostics: [...diagnosticByCode.values()].sort((a, b) => a.code.localeCompare(b.code))
    }
  };
}
