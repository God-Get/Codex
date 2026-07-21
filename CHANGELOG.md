# Changelog

All notable changes to CODEX are documented here.

## [0.2.0] — 2026-07-21

CODEX 0.2 establishes the first complete implementation baseline for portable digital scholarly editions.

### Added

- canonical Core interfaces, controlled registries, JSON Schemas, and stable diagnostics;
- Core, scholarly-edition, and HERMETICA profiles with inheritance and registry merging;
- structural and semantic validation, provenance checks, relation constraints, cycle detection, reachability, inspection, JSON graphs, DOT, diagnostics, and SARIF;
- deterministic release manifests, SHA-256 verification, portable packages, CycloneDX SBOM, safe unpacking, and Ed25519 signatures;
- Markdown authoring compiler with structured diagnostics and standalone/integrated CLIs;
- canonical runtime graph with object/type indexes, incoming/outgoing edges, roots, traversal, reachability, and statistics;
- deterministic Markdown/YAML importer and `codex-import` CLI;
- query parser/executor and `codex-query` CLI;
- versioned CLI JSON envelope with `apiVersion: 0.2`;
- HERMETICA reference corpus with work, fragment, Russian translation, multilingual metadata, and provenance;
- end-to-end CI covering build, tests, authoring, importer, query, validation, release signing, packaging, SBOM, verification, and safe unpacking.

### Compatibility baseline

- Node.js 22 or newer;
- ECMAScript modules;
- JSON Schema Draft 2020-12;
- CODEX project version 0.2.0;
- CLI machine API version 0.2.

### Stability

Schemas, public package exports, CLI command names, JSON envelopes, profile identifiers, and release formats listed in the 0.2 manifest are frozen for the 0.2 line. Backward-incompatible changes require a later CODEX version.

## [0.0.1] — Genesis — 2026-07-14

### Added

- initial repository description;
- manifesto;
- vision;
- project charter;
- reference architecture;
- governance model;
- roadmap;
- contribution guide;
- code of conduct.

### Status

Genesis is a pre-standard foundation. Documents are drafts until explicitly marked Accepted.
