import type { CodexProject, Diagnostic, ValidationReport } from "@codex/core";
import {
  identifierPattern,
  isRegisteredLifecycleStatus,
  isRegisteredObjectType,
  isRegisteredRelationType
} from "@codex/registry";

function push(diagnostics: Diagnostic[], diagnostic: Diagnostic): void {
  diagnostics.push(diagnostic);
}

export function validateProject(project: CodexProject): ValidationReport {
  const diagnostics: Diagnostic[] = [];
  const ids = new Set<string>();

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

  return {
    valid: diagnostics.every((diagnostic) => diagnostic.severity !== "error"),
    diagnostics
  };
}
