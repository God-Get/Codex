export type LifecycleStatus =
  | "draft"
  | "review"
  | "approved"
  | "published"
  | "deprecated"
  | "archived";

export type ValidationProfile = "core" | "strict";

export interface CodexRelation {
  type: string;
  target: string;
}

export interface CodexObject {
  id: string;
  type: string;
  title: string;
  version: string;
  status: LifecycleStatus;
  language?: string;
  derivedFrom?: string[];
  relations?: CodexRelation[];
  metadata?: Record<string, unknown>;
}

export interface CodexTranslationObject extends CodexObject {
  type: "translation";
  language: string;
  derivedFrom: [string];
}

export function isTranslationObject(object: CodexObject): object is CodexTranslationObject {
  return object.type === "translation"
    && typeof object.language === "string"
    && Array.isArray(object.derivedFrom)
    && object.derivedFrom.length === 1;
}

export interface CodexProject {
  codexVersion: string;
  id: string;
  title: string;
  profile?: string;
  objects: CodexObject[];
}

export type DiagnosticSeverity = "error" | "warning" | "info";

export interface Diagnostic {
  code: string;
  severity: DiagnosticSeverity;
  message: string;
  objectId?: string;
  path?: string;
}

export interface ValidationSummary {
  errors: number;
  warnings: number;
  info: number;
  total: number;
}

export interface ValidationReport {
  valid: boolean;
  diagnostics: Diagnostic[];
  summary: ValidationSummary;
}

export interface ProjectInspection {
  projectId: string;
  title: string;
  codexVersion: string;
  objectCount: number;
  relationCount: number;
  derivedFromCount: number;
  rootObjectIds: string[];
  unreachableObjectIds: string[];
  objectTypes: Record<string, number>;
  lifecycleStatuses: Record<string, number>;
  languages: Record<string, number>;
}
