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

export const identifierPattern = /^[A-Z][A-Z0-9]{1,15}-[0-9]{4,}$/;

export function isRegisteredObjectType(value: string): boolean {
  return (objectTypes as readonly string[]).includes(value);
}

export function isRegisteredRelationType(value: string): boolean {
  return (relationTypes as readonly string[]).includes(value);
}

export function isRegisteredLifecycleStatus(value: string): boolean {
  return (lifecycleStatuses as readonly string[]).includes(value);
}
