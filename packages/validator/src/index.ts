import type { CodexObject, CodexProject, Diagnostic, ValidationReport } from "@codex/core";
import {
  getRelationConstraint,
  identifierPattern,
  isRegisteredLifecycleStatus,
  isRegisteredObjectType,
  isRegisteredRelationType
} from "@codex/registry";

function push(diagnostics: Diagnostic[], diagnostic: Diagnostic): void {
  diagnostics.push(diagnostic);
}

function validateRelationSemantics(
  source: CodexObject,
  target: CodexObject,
  relationType: string,
  path: string,
  diagnostics: Diagnostic[]
): void {
  const constraint = getRelationConstraint(relationType);
  if (!constraint) return;

  if (constraint.disallowSelfReference && source.id === target.id) {
    push(diagnostics, {
      code: "ERR-1203",
      severity: "error",
      message: `Relation ${relationType} must not reference the same object.`,
      objectId: source.id,
      path
    });
  }

  if (constraint.sourceTypes && !constraint.sourceTypes.includes(source.type)) {
    push(diagnostics, {
      code: "ERR-1204",
      severity: "error",
      message: `Object type ${source.type} cannot use relation ${relationType}.`,
      objectId: source.id,
      path
    });
  }

  if (constraint.targetTypes && !constraint.targetTypes.includes(target.type)) {
    push(diagnostics, {
      code: "ERR-1205",
      severity: "error",
      message: `Relation ${relationType} cannot target object type ${target.type}.`,
      objectId: source.id,
      path
    });
  }
}

export function validateProject(project: CodexProject): ValidationReport {
  const diagnostics: Diagnostic[] = [];
  const ids = new Set<string>();
  const objectById = new Map<string, CodexObject>();

  if (!project.codexVersion?.trim()) {
    push(diagnostics, {
      code: "ERR-1001",
      severity: "error",
      message: "Project is missing codexVersion.",
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
    return { valid: false, diagnostics };
  }

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
    objectById.set(object.id, object);

    if (!isRegisteredObjectType(object.type)) {
      push(diagnostics, {
        code: "ERR-1103",
        severity: "error",
        message: `Unregistered object type: ${object.type}`,
        objectId: object.id,
        path: `${basePath}.type`
      });
    }

    if (!isRegisteredLifecycleStatus(object.status)) {
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

    for (const [relationIndex, relation] of (object.relations ?? []).entries()) {
      if (!isRegisteredRelationType(relation.type)) {
        push(diagnostics, {
          code: "ERR-1201",
          severity: "error",
          message: `Unregistered relation type: ${relation.type}`,
          objectId: object.id,
          path: `${basePath}.relations[${relationIndex}].type`
        });
      }
    }
  }

  for (const [index, object] of project.objects.entries()) {
    for (const [relationIndex, relation] of (object.relations ?? []).entries()) {
      const path = `objects[${index}].relations[${relationIndex}]`;
      const target = objectById.get(relation.target);
      if (!target) {
        push(diagnostics, {
          code: "ERR-1202",
          severity: "error",
          message: `Relation target does not exist: ${relation.target}`,
          objectId: object.id,
          path: `${path}.target`
        });
        continue;
      }

      if (isRegisteredRelationType(relation.type)) {
        validateRelationSemantics(object, target, relation.type, path, diagnostics);
      }
    }
  }

  return {
    valid: diagnostics.every((diagnostic) => diagnostic.severity !== "error"),
    diagnostics
  };
}
