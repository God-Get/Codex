import type {
  CodexProject,
  Diagnostic,
  DiagnosticSeverity,
  ProjectInspection,
  ValidationProfile,
  ValidationReport,
  ValidationSummary
} from "@codex/core";
import {
  defaultRegistry,
  identifierPattern,
  isRegisteredLanguage,
  isRegisteredLifecycleStatus,
  isRegisteredObjectType,
  isRegisteredRelationType,
  semanticVersionPattern,
  type RegistryData
} from "@codex/registry";

export interface ValidationOptions {
  registry?: RegistryData;
  profile?: ValidationProfile;
}

export interface ProjectGraphNode {
  id: string;
  type: string;
  title: string;
  status: string;
  language?: string;
}

export interface ProjectGraphEdge {
  source: string;
  target: string;
  type: string;
}

export interface ProjectGraph {
  projectId: string;
  nodes: ProjectGraphNode[];
  edges: ProjectGraphEdge[];
}

function push(diagnostics: Diagnostic[], diagnostic: Diagnostic): void {
  diagnostics.push(diagnostic);
}

function summarize(diagnostics: Diagnostic[]): ValidationSummary {
  const count = (severity: DiagnosticSeverity): number => diagnostics.filter((diagnostic) => diagnostic.severity === severity).length;
  return { errors: count("error"), warnings: count("warning"), info: count("info"), total: diagnostics.length };
}

function report(diagnostics: Diagnostic[]): ValidationReport {
  const summary = summarize(diagnostics);
  return { valid: summary.errors === 0, diagnostics, summary };
}

function relationTargets(project: CodexProject, relationType: string): Set<string> {
  return new Set(project.objects.flatMap((object) => (object.relations ?? []).filter((relation) => relation.type === relationType).map((relation) => relation.target)));
}

function findRoots(project: CodexProject): string[] {
  const contained = relationTargets(project, "contains");
  const rootTypes = new Set(["project", "work", "edition", "volume", "document"]);
  const semanticRoots = project.objects.filter((object) => rootTypes.has(object.type) && !contained.has(object.id)).map((object) => object.id);
  if (semanticRoots.length > 0) return semanticRoots;
  return project.objects.filter((object) => !contained.has(object.id)).map((object) => object.id);
}

function findUnreachable(project: CodexProject): string[] {
  const objectsById = new Map(project.objects.map((object) => [object.id, object]));
  const reachable = new Set<string>();
  const queue = [...findRoots(project)];
  while (queue.length > 0) {
    const id = queue.shift();
    if (!id || reachable.has(id)) continue;
    reachable.add(id);
    const object = objectsById.get(id);
    for (const relation of object?.relations ?? []) {
      if (relation.type === "contains" && objectsById.has(relation.target)) queue.push(relation.target);
    }
  }
  return project.objects.map((object) => object.id).filter((id) => !reachable.has(id));
}

export function inspectProject(project: CodexProject): ProjectInspection {
  const countBy = (values: string[]): Record<string, number> => {
    const result: Record<string, number> = {};
    for (const value of values) result[value] = (result[value] ?? 0) + 1;
    return result;
  };
  return {
    projectId: project.id,
    title: project.title,
    codexVersion: project.codexVersion,
    objectCount: project.objects.length,
    relationCount: project.objects.reduce((sum, object) => sum + (object.relations?.length ?? 0), 0),
    derivedFromCount: project.objects.reduce((sum, object) => sum + (object.derivedFrom?.length ?? 0), 0),
    rootObjectIds: findRoots(project),
    unreachableObjectIds: findUnreachable(project),
    objectTypes: countBy(project.objects.map((object) => object.type)),
    lifecycleStatuses: countBy(project.objects.map((object) => object.status)),
    languages: countBy(project.objects.map((object) => object.language ?? "und"))
  };
}

export function buildProjectGraph(project: CodexProject): ProjectGraph {
  const nodes = project.objects.map((object) => ({
    id: object.id,
    type: object.type,
    title: object.title,
    status: object.status,
    ...(object.language ? { language: object.language } : {})
  }));
  const edges: ProjectGraphEdge[] = [];
  for (const object of project.objects) {
    for (const relation of object.relations ?? []) edges.push({ source: object.id, target: relation.target, type: relation.type });
    for (const source of object.derivedFrom ?? []) edges.push({ source: object.id, target: source, type: "derivedFrom" });
  }
  return { projectId: project.id, nodes, edges };
}

export function graphToDot(graph: ProjectGraph): string {
  const escape = (value: string): string => value.replaceAll("\\", "\\\\").replaceAll('"', '\\"');
  const lines = ["digraph CODEX {", "  rankdir=LR;"];
  for (const node of graph.nodes) lines.push(`  "${escape(node.id)}" [label="${escape(node.id)}\\n${escape(node.title)}", shape=box];`);
  for (const edge of graph.edges) lines.push(`  "${escape(edge.source)}" -> "${escape(edge.target)}" [label="${escape(edge.type)}"];`);
  lines.push("}");
  return `${lines.join("\n")}\n`;
}

function detectCycles(project: CodexProject, relationType: "contains" | "dependsOn", diagnostics: Diagnostic[]): void {
  const objectIds = new Set(project.objects.map((object) => object.id));
  const graph = new Map<string, string[]>();
  for (const object of project.objects) graph.set(object.id, (object.relations ?? []).filter((relation) => relation.type === relationType).map((relation) => relation.target).filter((target) => objectIds.has(target)));
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const stack: string[] = [];
  const reported = new Set<string>();
  function visit(id: string): void {
    if (visited.has(id)) return;
    if (visiting.has(id)) {
      const start = stack.indexOf(id);
      const cycle = [...stack.slice(start), id];
      const key = [...new Set(cycle)].sort().join("|");
      if (!reported.has(key)) {
        reported.add(key);
        push(diagnostics, { code: "ERR-1206", severity: "error", message: `Cyclic ${relationType} relationship: ${cycle.join(" -> ")}`, objectId: id, path: "objects[].relations" });
      }
      return;
    }
    visiting.add(id);
    stack.push(id);
    for (const target of graph.get(id) ?? []) visit(target);
    stack.pop();
    visiting.delete(id);
    visited.add(id);
  }
  for (const id of graph.keys()) visit(id);
}

function translationText(object: CodexProject["objects"][number]): string {
  const value = object.metadata?.content ?? object.metadata?.body ?? object.metadata?.text;
  if (typeof value !== "string") return "";
  return value
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/^#{1,6}\s+.*$/gm, "")
    .trim();
}

function detectTranslationProvenanceCycles(project: CodexProject, diagnostics: Diagnostic[]): void {
  const translations = new Map(project.objects.filter((object) => object.type === "translation").map((object) => [object.id, object]));
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const stack: string[] = [];
  const reported = new Set<string>();

  function visit(id: string): void {
    if (visited.has(id)) return;
    if (visiting.has(id)) {
      const start = stack.indexOf(id);
      const cycle = [...stack.slice(start), id];
      const key = [...new Set(cycle)].sort().join("|");
      if (!reported.has(key)) {
        reported.add(key);
        push(diagnostics, {
          code: "CODEX_TRANSLATION_PROVENANCE_CYCLE",
          severity: "error",
          message: `Translation provenance cycle: ${cycle.join(" -> ")}`,
          objectId: id,
          path: "objects[].derivedFrom"
        });
      }
      return;
    }
    visiting.add(id);
    stack.push(id);
    const sourceId = translations.get(id)?.derivedFrom?.length === 1 ? translations.get(id)?.derivedFrom?.[0] : undefined;
    if (sourceId && translations.has(sourceId)) visit(sourceId);
    stack.pop();
    visiting.delete(id);
    visited.add(id);
  }

  for (const id of translations.keys()) visit(id);
}

export function validateProject(project: CodexProject, options: ValidationOptions = {}): ValidationReport {
  const diagnostics: Diagnostic[] = [];
  const ids = new Set<string>();
  const registry = options.registry ?? defaultRegistry;
  const profile = options.profile ?? "core";

  if (!project.codexVersion?.trim()) push(diagnostics, { code: "ERR-1001", severity: "error", message: "Project is missing codexVersion.", path: "codexVersion" });
  else if (!semanticVersionPattern.test(project.codexVersion)) push(diagnostics, { code: "ERR-1004", severity: "error", message: `codexVersion is not valid semantic versioning: ${project.codexVersion}`, path: "codexVersion" });
  if (!identifierPattern.test(project.id)) push(diagnostics, { code: "ERR-1002", severity: "error", message: `Invalid project identifier: ${project.id}`, objectId: project.id, path: "id" });
  if (!Array.isArray(project.objects)) {
    push(diagnostics, { code: "ERR-1003", severity: "error", message: "Project objects must be an array.", path: "objects" });
    return report(diagnostics);
  }

  const objectsById = new Map(project.objects.map((object) => [object.id, object]));
  for (const [index, object] of project.objects.entries()) {
    const basePath = `objects[${index}]`;
    if (!identifierPattern.test(object.id)) push(diagnostics, { code: "ERR-1101", severity: "error", message: `Invalid object identifier: ${object.id}`, objectId: object.id, path: `${basePath}.id` });
    if (ids.has(object.id)) push(diagnostics, { code: "ERR-1102", severity: "error", message: `Duplicate object identifier: ${object.id}`, objectId: object.id, path: `${basePath}.id` });
    ids.add(object.id);
    if (!isRegisteredObjectType(object.type, registry)) push(diagnostics, { code: "ERR-1103", severity: "error", message: `Unregistered object type: ${object.type}`, objectId: object.id, path: `${basePath}.type` });
    if (!isRegisteredLifecycleStatus(object.status, registry)) push(diagnostics, { code: "ERR-1104", severity: "error", message: `Invalid lifecycle status: ${object.status}`, objectId: object.id, path: `${basePath}.status` });
    if (!object.title?.trim()) push(diagnostics, { code: "ERR-1105", severity: "error", message: "Object title must not be empty.", objectId: object.id, path: `${basePath}.title` });
    if (!semanticVersionPattern.test(object.version)) push(diagnostics, { code: "ERR-1106", severity: "error", message: `Object version is not valid semantic versioning: ${object.version}`, objectId: object.id, path: `${basePath}.version` });
    if (object.language && !isRegisteredLanguage(object.language, registry)) push(diagnostics, {
      code: object.type === "translation" ? "CODEX_TRANSLATION_LANGUAGE_UNKNOWN" : "ERR-1107",
      severity: "error",
      message: `Unregistered language code: ${object.language}`,
      objectId: object.id,
      path: `${basePath}.language`
    });

    for (const [sourceIndex, sourceId] of (object.type === "translation" ? [] : (object.derivedFrom ?? [])).entries()) {
      const path = `${basePath}.derivedFrom[${sourceIndex}]`;
      if (!identifierPattern.test(sourceId)) push(diagnostics, { code: "ERR-1301", severity: "error", message: `Invalid derivedFrom identifier: ${sourceId}`, objectId: object.id, path });
      else if (!objectsById.has(sourceId)) push(diagnostics, { code: "ERR-1302", severity: "error", message: `derivedFrom source does not exist: ${sourceId}`, objectId: object.id, path });
      else if (sourceId === object.id) push(diagnostics, { code: "ERR-1303", severity: "error", message: "An object cannot derive from itself.", objectId: object.id, path });
    }

    const relationKinds = new Set((object.relations ?? []).map((relation) => relation.type));
    const hasProvenance = (object.derivedFrom?.length ?? 0) > 0 || relationKinds.has("derivedFrom");
    if (object.type === "translation") {
      const sourceIds = object.derivedFrom ?? [];
      if (!object.language?.trim()) push(diagnostics, {
        code: "CODEX_TRANSLATION_LANGUAGE_REQUIRED", severity: "error", message: "Translation language is required.", objectId: object.id, path: `${basePath}.language`
      });
      if (sourceIds.length !== 1) push(diagnostics, {
        code: "CODEX_TRANSLATION_SOURCE_COUNT", severity: "error", message: `Translation must have exactly one derivedFrom source; found ${sourceIds.length}.`, objectId: object.id, path: `${basePath}.derivedFrom`
      });
      const sourceId = sourceIds.length === 1 ? sourceIds[0] : undefined;
      const source = sourceId ? objectsById.get(sourceId) : undefined;
      if (sourceId === object.id) push(diagnostics, {
        code: "CODEX_TRANSLATION_SELF_REFERENCE", severity: "error", message: "Translation cannot derive from itself.", objectId: object.id, path: `${basePath}.derivedFrom[0]`
      });
      else if (sourceId && !source) push(diagnostics, {
        code: "CODEX_TRANSLATION_SOURCE_MISSING", severity: "error", message: `Translation source does not exist: ${sourceId}`, objectId: object.id, path: `${basePath}.derivedFrom[0]`
      });
      if (source && !registry.translationRules.sourceTypes.includes(source.type)) push(diagnostics, {
        code: "CODEX_TRANSLATION_SOURCE_TYPE", severity: "error", message: `Object type ${source.type} cannot be a translation source.`, objectId: object.id, path: `${basePath}.derivedFrom[0]`
      });
      if (source && object.language && source.language && object.language === source.language) push(diagnostics, {
        code: "CODEX_TRANSLATION_SAME_LANGUAGE", severity: "error", message: `Translation language ${object.language} matches source language.`, objectId: object.id, path: `${basePath}.language`
      });
      if (source && object.status === "published" && source.status === "draft") push(diagnostics, {
        code: "CODEX_TRANSLATION_PUBLISHED_FROM_DRAFT", severity: "error", message: `Published translation cannot derive from draft source ${source.id}.`, objectId: object.id, path: `${basePath}.status`
      });
      if (source?.type === "translation") {
        const upstreamIds = source.derivedFrom ?? [];
        if (upstreamIds.length !== 1 || upstreamIds[0] === source.id || !objectsById.has(upstreamIds[0]!)) push(diagnostics, {
          code: "CODEX_TRANSLATION_PROVENANCE_INVALID", severity: "error", message: `Translation source ${source.id} does not preserve valid provenance.`, objectId: object.id, path: `${basePath}.derivedFrom[0]`
        });
      }
      if (!translationText(object)) push(diagnostics, {
        code: "CODEX_TRANSLATION_EMPTY_CONTENT", severity: "error", message: "Translation content must not be empty.", objectId: object.id, path: `${basePath}.metadata`
      });
      for (const key of registry.translationRules.requiredMetadata) {
        const value = object.metadata?.[key];
        if (value === undefined || value === null || (typeof value === "string" && !value.trim())) push(diagnostics, {
          code: "CODEX_TRANSLATION_METADATA_REQUIRED", severity: "error", message: `Translation metadata.${key} is required by the active profile.`, objectId: object.id, path: `${basePath}.metadata.${key}`
        });
      }
      const explicitRelations = (object.relations ?? []).filter((relation) => relation.type === "translation-of");
      if (explicitRelations.length > 0 && (explicitRelations.length !== 1 || explicitRelations[0]?.target !== sourceId)) push(diagnostics, {
        code: "CODEX_TRANSLATION_RELATION_MISMATCH", severity: "error", message: "translation-of must point to the single derivedFrom source.", objectId: object.id, path: `${basePath}.relations`
      });
    }
    if (object.type === "commentary" && !hasProvenance && !relationKinds.has("references") && !relationKinds.has("explains")) push(diagnostics, { code: "ERR-1305", severity: "error", message: "Commentary must identify the material it comments on.", objectId: object.id, path: basePath });

    for (const [relationIndex, relation] of (object.relations ?? []).entries()) {
      const relationPath = `${basePath}.relations[${relationIndex}]`;
      if (!isRegisteredRelationType(relation.type, registry)) {
        push(diagnostics, { code: "ERR-1201", severity: "error", message: `Unregistered relation type: ${relation.type}`, objectId: object.id, path: `${relationPath}.type` });
        continue;
      }
      const constraint = registry.relationConstraints[relation.type];
      if (constraint && constraint.sources.length > 0 && !constraint.sources.includes(object.type)) push(diagnostics, { code: "ERR-1203", severity: "error", message: `Object type ${object.type} cannot use relation ${relation.type}.`, objectId: object.id, path: `${relationPath}.type` });
      const target = objectsById.get(relation.target);
      if (target && constraint && constraint.targets.length > 0 && !constraint.targets.includes(target.type)) push(diagnostics, { code: "ERR-1204", severity: "error", message: `Relation ${relation.type} cannot target object type ${target.type}.`, objectId: object.id, path: `${relationPath}.target` });
      if (relation.target === object.id && (constraint?.disallowSelfReference ?? relation.type !== "relatedTo")) push(diagnostics, { code: "ERR-1205", severity: "error", message: `Self-reference is not allowed for relation ${relation.type}.`, objectId: object.id, path: `${relationPath}.target` });
    }
  }

  for (const [index, object] of project.objects.entries()) {
    for (const [relationIndex, relation] of (object.relations ?? []).entries()) {
      if (!ids.has(relation.target)) push(diagnostics, { code: "ERR-1202", severity: "error", message: `Relation target does not exist: ${relation.target}`, objectId: object.id, path: `objects[${index}].relations[${relationIndex}].target` });
    }
  }

  detectCycles(project, "contains", diagnostics);
  detectCycles(project, "dependsOn", diagnostics);
  detectTranslationProvenanceCycles(project, diagnostics);
  if (profile === "strict") {
    for (const objectId of findUnreachable(project)) push(diagnostics, { code: "WARN-1401", severity: "warning", message: "Object is unreachable from every containment root.", objectId, path: "objects[].relations" });
  }
  return report(diagnostics);
}
