import type {
  CodexProject,
  Diagnostic,
  DiagnosticSeverity,
  ValidationReport,
  ValidationSummary
} from "@codex/core";
import {
  defaultRegistry,
  identifierPattern,
  isRegisteredLifecycleStatus,
  isRegisteredObjectType,
  isRegisteredRelationType,
  semanticVersionPattern,
  type RegistryData
} from "@codex/registry";

export interface ValidationOptions {
  registry?: RegistryData;
}

function push(diagnostics: Diagnostic[], diagnostic: Diagnostic): void {
  diagnostics.push(diagnostic);
}

function summarize(diagnostics: Diagnostic[]): ValidationSummary {
  const count = (severity: DiagnosticSeverity): number =>
    diagnostics.filter((diagnostic) => diagnostic.severity === severity).length;
  return {
    errors: count("error"),
    warnings: count("warning"),
    info: count("info"),
    total: diagnostics.length
  };
}

function report(diagnostics: Diagnostic[]): ValidationReport {
  const summary = summarize(diagnostics);
  return { valid: summary.errors === 0, diagnostics, summary };
}

function detectCycles(
  project: CodexProject,
  relationType: "contains" | "dependsOn",
  diagnostics: Diagnostic[]
): void {
  const graph = new Map<string, string[]>();
  for (const object of project.objects) {
    graph.set(
      object.id,
      (object.relations ?? [])
        .filter((relation) => relation.type === relationType)
        .map((relation) => relation.target)
        .filter((target) => project.objects.some((candidate) => candidate.id === target))
    );
  }

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
          code: "ERR-1206",
          severity: "error",
          message: `Cyclic ${relationType} relationship: ${cycle.join(" -> ")}`,
          objectId: id,
          path: "objects[].relations"
        });
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

export function validateProject(project: CodexProject, options: ValidationOptions = {}): ValidationReport {
  const diagnostics: Diagnostic[] = [];
  const ids = new Set<string>();
  const registry = options.registry ?? defaultRegistry;

  if (!project.codexVersion?.trim()) {
    push(diagnostics, {
      code: "ERR-1001",
      severity: "error",
      message: "Project is missing codexVersion.",
      path: "codexVersion"
    });
  } else if (!semanticVersionPattern.test(project.codexVersion)) {
    push(diagnostics, {
      code: "ERR-1004",
      severity: "error",
      message: `codexVersion is not valid semantic versioning: ${project.codexVersion}`,
      path: "codexVersion"
    });
  }

  if (!identifierPattern.test(project.id)) {
    push(diagnostics, {
      code: "ERR-1002",
      severity: "error",
      message: `Invalid project identifier: ${project.id}`,
      objectId: project.id,
      path: "id"
    });
  }

  if (!Array.isArray(project.objects)) {
    push(diagnostics, {
      code: "ERR-1003",
      severity: "error",
      message: "Project objects must be an array.",
      path: "objects"
    });
    return report(diagnostics);
  }

  const objectsById = new Map(project.objects.map((object) => [object.id, object]));

  for (const [index, object] of project.objects.entries()) {
    const basePath = `objects[${index}]`;

    if (!identifierPattern.test(object.id)) {
      push(diagnostics, {
        code: "ERR-1101",
        severity: "error",
        message: `Invalid object identifier: ${object.id}`,
        objectId: object.id,
        path: `${basePath}.id`
      });
    }

    if (ids.has(object.id)) {
      push(diagnostics, {
        code: "ERR-1102",
        severity: "error",
        message: `Duplicate object identifier: ${object.id}`,
        objectId: object.id,
        path: `${basePath}.id`
      });
    }
    ids.add(object.id);

    if (!isRegisteredObjectType(object.type, registry)) {
      push(diagnostics, {
        code: "ERR-1103",
        severity: "error",
        message: `Unregistered object type: ${object.type}`,
        objectId: object.id,
        path: `${basePath}.type`
      });
    }

    if (!isRegisteredLifecycleStatus(object.status, registry)) {
      push(diagnostics, {
        code: "ERR-1104",
        severity: "error",
        message: `Invalid lifecycle status: ${object.status}`,
        objectId: object.id,
        path: `${basePath}.status`
      });
    }

    if (!object.title?.trim()) {
      push(diagnostics, {
        code: "ERR-1105",
        severity: "error",
        message: "Object title must not be empty.",
        objectId: object.id,
        path: `${basePath}.title`
      });
    }

    if (!semanticVersionPattern.test(object.version)) {
      push(diagnostics, {
        code: "ERR-1106",
        severity: "error",
        message: `Object version is not valid semantic versioning: ${object.version}`,
        objectId: object.id,
        path: `${basePath}.version`
      });
    }

    for (const [relationIndex, relation] of (object.relations ?? []).entries()) {
      const relationPath = `${basePath}.relations[${relationIndex}]`;
      if (!isRegisteredRelationType(relation.type, registry)) {
        push(diagnostics, {
          code: "ERR-1201",
          severity: "error",
          message: `Unregistered relation type: ${relation.type}`,
          objectId: object.id,
          path: `${relationPath}.type`
        });
        continue;
      }

      const constraint = registry.relationConstraints[relation.type];
      if (constraint && !constraint.sources.includes(object.type)) {
        push(diagnostics, {
          code: "ERR-1203",
          severity: "error",
          message: `Object type ${object.type} cannot use relation ${relation.type}.`,
          objectId: object.id,
          path: `${relationPath}.type`
        });
      }

      const target = objectsById.get(relation.target);
      if (target && constraint && !constraint.targets.includes(target.type)) {
        push(diagnostics, {
          code: "ERR-1204",
          severity: "error",
          message: `Relation ${relation.type} cannot target object type ${target.type}.`,
          objectId: object.id,
          path: `${relationPath}.target`
        });
      }

      if (relation.target === object.id && relation.type !== "relatedTo") {
        push(diagnostics, {
          code: "ERR-1205",
          severity: "error",
          message: `Self-reference is not allowed for relation ${relation.type}.`,
          objectId: object.id,
          path: `${relationPath}.target`
        });
      }
    }
  }

  for (const [index, object] of project.objects.entries()) {
    for (const [relationIndex, relation] of (object.relations ?? []).entries()) {
      if (!ids.has(relation.target)) {
        push(diagnostics, {
          code: "ERR-1202",
          severity: "error",
          message: `Relation target does not exist: ${relation.target}`,
          objectId: object.id,
          path: `objects[${index}].relations[${relationIndex}].target`
        });
      }
    }
  }

  detectCycles(project, "contains", diagnostics);
  detectCycles(project, "dependsOn", diagnostics);

  return report(diagnostics);
}
