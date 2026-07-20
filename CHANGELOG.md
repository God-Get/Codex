# Changelog

All notable changes to CODEX are documented here.

## [Unreleased]

### Added

- TypeScript workspace with core, registry, schema, validator, release, and CLI packages;
- machine-readable JSON registries and JSON Schemas;
- structural schema validation with stable `ERR-2001…ERR-2004` diagnostics;
- `codex validate` with human-readable, JSON, and SARIF reports;
- `codex doctor` environment, registry, schema, and release-manifest checks;
- `codex inspect` with human-readable and JSON structural reports;
- `codex graph` with JSON and Graphviz DOT exports, relationship filters, and file output;
- `codex diagnostics` with human-readable, JSON, and severity-filtered output;
- `codex release prepare` and `codex release verify` with SHA-256 integrity checks;
- `codex package build` for portable release directories and checksum files;
- `core` and `strict` validation profiles;
- supported-language and diagnostic-code registries;
- semantic relationship, version, provenance, cycle, and reachability validation;
- required source identification for translations and commentaries;
- draft source release manifest and release-manifest JSON Schema;
- tamper-detection and package-assembly regression tests;
- GitHub Actions SARIF upload and portable package artifacts;
- executable conformance tests and continuous integration.

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
