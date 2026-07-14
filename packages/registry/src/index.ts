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

export interface RelationConstraint {
  sourceTypes?: readonly string[];
  targetTypes?: readonly string[];
  disallowSelfReference?: boolean;
}

export const relationConstraints: Readonly<Record<string, RelationConstraint>> = {
  contains: {
    sourceTypes: ["project", "work", "edition", "volume", "chapter", "section"],
    targetTypes: ["work", "edition", "volume", "chapter", "section", "fragment", "translation", "commentary", "source", "term"],
    disallowSelfReference: true
  },
  belongsTo: {
    targetTypes: ["project", "work", "edition", "volume", "chapter", "section"],
    disallowSelfReference: true
  },
  translates: {
    sourceTypes: ["translation"],
    targetTypes: ["work", "edition", "chapter", "section", "fragment", "source"],
    disallowSelfReference: true
  },
  defines: {
    sourceTypes: ["term", "commentary", "document"],
    targetTypes: ["term"],
    disallowSelfReference: true
  },
  explains: {
    sourceTypes: ["commentary", "document"],
    disallowSelfReference: true
  },
  derivedFrom: { disallowSelfReference: true },
  dependsOn: { disallowSelfReference: true },
  supersedes: { disallowSelfReference: true }
};

export function isRegisteredObjectType(value: string): boolean {
  return (objectTypes as readonly string[]).includes(value);
}

export function isRegisteredRelationType(value: string): boolean {
  return (relationTypes as readonly string[]).includes(value);
}

export function isRegisteredLifecycleStatus(value: string): boolean {
  return (lifecycleStatuses as readonly string[]).includes(value);
}

export function getRelationConstraint(type: string): RelationConstraint | undefined {
  return relationConstraints[type];
}
