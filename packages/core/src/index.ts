export type LifecycleStatus =
  | "draft"
  | "review"
  | "approved"
  | "published"
  | "deprecated"
  | "archived";

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

export interface ValidationReport {
  valid: boolean;
  diagnostics: Diagnostic[];
}
