import { readFileSync } from "node:fs";
import { resolve } from "node:path";

export const lifecycleStatuses = ["draft", "review", "approved", "published", "deprecated", "archived"] as const;
export const validationProfiles = ["core", "strict"] as const;
export const languages = ["ar", "de", "el", "en", "es", "fr", "he", "it", "la", "ru"] as const;

export const objectTypes = [
  "project", "work", "edition", "volume", "chapter", "section", "fragment", "translation",
  "commentary", "source", "term", "document", "requirement", "validation"
] as const;

export const relationTypes = [
  "contains", "belongsTo", "references", "quotes", "translates", "defines", "explains",
  "extends", "derivedFrom", "translation-of", "dependsOn", "supersedes", "relatedTo"
] as const;

export const relationConstraints = {
  contains: {
    sources: ["project", "work", "edition", "volume", "chapter", "section", "document"],
    targets: ["work", "edition", "volume", "chapter", "section", "fragment", "translation", "commentary", "source", "term", "document", "requirement", "validation"]
  },
  translates: { sources: ["translation"], targets: ["work", "edition", "volume", "chapter", "section", "fragment", "source"] },
  "translation-of": { sources: ["translation"], targets: [] },
  defines: { sources: ["term", "document"], targets: ["term"] },
  explains: { sources: ["commentary", "document"], targets: ["work", "edition", "volume", "chapter", "section", "fragment", "term"] }
} as const;

export interface DiagnosticDefinition {
  code: string;
  severity: "error" | "warning" | "info";
  title: string;
}

export interface RelationConstraint {
  sources: readonly string[];
  targets: readonly string[];
  disallowSelfReference?: boolean;
}

export interface TranslationRules {
  sourceTypes: readonly string[];
  targetLanguages: readonly string[];
  requiredMetadata: readonly string[];
}

export interface RegistryData {
  objectTypes: readonly string[];
  relationTypes: readonly string[];
  lifecycleStatuses: readonly string[];
  validationProfiles: readonly string[];
  languages: readonly string[];
  relationConstraints: Readonly<Record<string, RelationConstraint>>;
  translationRules: TranslationRules;
  diagnostics: readonly DiagnosticDefinition[];
}

interface RegistryListFile { values: string[]; }
interface RawRelationConstraint {
  sourceTypes?: string[];
  targetTypes?: string[];
  sources?: string[];
  targets?: string[];
  disallowSelfReference?: boolean;
}
interface RelationConstraintFile { constraints: Record<string, RawRelationConstraint>; }
interface DiagnosticRegistryFile { diagnostics: DiagnosticDefinition[]; }
interface TranslationRuleFile {
  sourceTypes: string[];
  targetLanguages: string[];
  requiredMetadata: string[];
}

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

function normalizeRelationConstraints(constraints: Record<string, RawRelationConstraint>): Record<string, RelationConstraint> {
  return Object.fromEntries(Object.entries(constraints).map(([relation, constraint]) => [relation, {
    sources: constraint.sources ?? constraint.sourceTypes ?? [],
    targets: constraint.targets ?? constraint.targetTypes ?? [],
    ...(constraint.disallowSelfReference === undefined ? {} : { disallowSelfReference: constraint.disallowSelfReference })
  }]));
}

export function loadRegistry(rootDirectory = process.cwd()): RegistryData {
  const registryDirectory = resolve(rootDirectory, "registry");
  const relationConstraintFile = readJson<RelationConstraintFile>(resolve(registryDirectory, "relation-constraints.json"));
  return {
    objectTypes: readJson<RegistryListFile>(resolve(registryDirectory, "object-types.json")).values,
    relationTypes: readJson<RegistryListFile>(resolve(registryDirectory, "relation-types.json")).values,
    lifecycleStatuses: readJson<RegistryListFile>(resolve(registryDirectory, "lifecycle-statuses.json")).values,
    validationProfiles: readJson<RegistryListFile>(resolve(registryDirectory, "validation-profiles.json")).values,
    languages: readJson<RegistryListFile>(resolve(registryDirectory, "languages.json")).values,
    relationConstraints: normalizeRelationConstraints(relationConstraintFile.constraints),
    translationRules: readJson<TranslationRuleFile>(resolve(registryDirectory, "translation-rules.json")),
    diagnostics: readJson<DiagnosticRegistryFile>(resolve(registryDirectory, "diagnostic-codes.json")).diagnostics
  };
}

export const defaultRegistry: RegistryData = {
  objectTypes,
  relationTypes,
  lifecycleStatuses,
  validationProfiles,
  languages,
  relationConstraints,
  translationRules: {
    sourceTypes: ["work", "edition", "volume", "chapter", "section", "fragment", "source", "translation"],
    targetLanguages: [],
    requiredMetadata: []
  },
  diagnostics: []
};

export const identifierPattern = /^[A-Z][A-Z0-9]{1,15}-[0-9]{4,}$/;
export const semanticVersionPattern = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

export function isRegisteredObjectType(value: string, registry: RegistryData = defaultRegistry): boolean { return registry.objectTypes.includes(value); }
export function isRegisteredRelationType(value: string, registry: RegistryData = defaultRegistry): boolean { return registry.relationTypes.includes(value); }
export function isRegisteredLifecycleStatus(value: string, registry: RegistryData = defaultRegistry): boolean { return registry.lifecycleStatuses.includes(value); }
export function isRegisteredValidationProfile(value: string, registry: RegistryData = defaultRegistry): boolean { return registry.validationProfiles.includes(value); }
export function isRegisteredLanguage(value: string, registry: RegistryData = defaultRegistry): boolean { return registry.languages.includes(value); }
export function isRegisteredDiagnosticCode(value: string, registry: RegistryData = defaultRegistry): boolean { return registry.diagnostics.some((diagnostic) => diagnostic.code === value); }
