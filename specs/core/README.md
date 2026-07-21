# CODEX Core 0.2

**Status:** Draft normative specification  
**Target:** CODEX 0.2.0

The key words **MUST**, **MUST NOT**, **SHOULD**, **SHOULD NOT**, and **MAY** are to be interpreted as normative requirement levels.

## 1. Conformance

A conforming CODEX implementation MUST:

1. read a CODEX Project as a directed object graph;
2. validate project structure before semantic rules;
3. preserve stable object identifiers;
4. resolve relations only to existing objects;
5. expose machine-readable diagnostics;
6. support the `core` conformance profile;
7. verify release-package integrity before use.

The `strict` profile adds quality requirements but does not change Core data semantics.

## 2. Project model

A Project MUST contain:

- `codexVersion`: semantic version of the governing CODEX specification;
- `id`: stable project identifier;
- `title`: non-empty human-readable title;
- `objects`: ordered collection of CODEX Objects.

Unknown top-level properties MUST be rejected unless enabled by an active extension profile.

## 3. Object model

Every object MUST have a unique stable `id`, registered `type`, non-empty `title`, semantic `version`, and registered lifecycle `status`.

An object MAY declare:

- `language`;
- `relations`;
- `derivedFrom` provenance references;
- profile-defined metadata.

Object identifiers MUST NOT be reassigned to another conceptual object.

## 4. Relations

A relation is a directed edge from its containing object to a target object. Its type MUST be registered. The target MUST exist. Source and target types MUST satisfy the active relation constraint.

Relations marked acyclic MUST NOT introduce cycles. Relations marked non-reflexive MUST NOT target their source object.

Core relation families are:

- structural: `contains`, `belongsTo`;
- scholarly: `references`, `quotes`, `translates`, `defines`, `explains`;
- provenance: `derivedFrom`;
- evolution: `extends`, `dependsOn`, `supersedes`, `relatedTo`.

## 5. Provenance

`derivedFrom` identifies source objects used to create another object. Every referenced source MUST exist and MUST differ from the derived object.

Translations MUST identify a source text. Commentaries MUST identify the object they explain or discuss.

## 6. Lifecycle

Core lifecycle values are `draft`, `review`, `approved`, `published`, `deprecated`, and `archived`.

Published objects SHOULD remain immutable. Corrections SHOULD create a new semantic version and provenance relation.

## 7. Validation and diagnostics

Validation MUST run in this order:

1. JSON parsing;
2. structural schema validation;
3. registry validation;
4. semantic validation;
5. graph validation;
6. active-profile validation.

Every diagnostic MUST include a stable code, severity, message, and optional object path. Every emitted diagnostic code MUST be present in the diagnostic registry.

## 8. Profiles

A profile MAY extend object types, relation types, constraints, languages, diagnostics, and validation rules. A profile MUST declare its identifier, semantic version, CODEX version range, and inherited profiles.

Profiles MUST NOT weaken Core requirements. Conflicting inherited definitions MUST cause profile resolution to fail.

## 9. Packages and releases

A release package MUST contain a descriptor, sealed manifest, SHA-256 checksum file, and all declared artifacts. It SHOULD contain a CycloneDX SBOM and MAY have one or more detached signatures.

Implementations MUST verify paths, file types, checksums, and unexpected entries before unpacking or processing a package.

## 10. Rule catalogue

Machine-readable normative requirements are published in [`rules.json`](rules.json). Validator diagnostics SHOULD reference the corresponding rule identifiers.
