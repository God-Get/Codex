# CODEX

**Open Architecture for Digital Scholarly Editions**

CODEX is an open, reproducible framework for preparing, maintaining, publishing, and preserving scholarly editions.

**Current release:** `0.1.0 Engineering MVP`  
**Status:** active development

## Engineering MVP

The repository contains:

- `@codex/core` — canonical interfaces;
- `@codex/registry` — machine-readable controlled vocabularies;
- `@codex/schema` — structural project validation aligned with the project JSON Schema;
- `@codex/validator` — semantic, provenance, relationship, cycle, reachability, inspection, and graph logic;
- `@codex/cli` — `validate`, `inspect`, `graph`, `diagnostics`, and `doctor`;
- conformance fixtures, regression tests, CI, and a draft `0.1.0` release manifest.

## Run locally

```bash
npm install
npm run check
npm test
npm run doctor
npm run validate
npm run validate:strict
npm run inspect
npm run graph
npm run diagnostics
```

## Validation

```bash
node apps/cli/dist/index.js validate path/to/project.json
node apps/cli/dist/index.js validate path/to/project.json --profile=strict
node apps/cli/dist/index.js validate path/to/project.json --json
node apps/cli/dist/index.js validate path/to/project.json --sarif
node apps/cli/dist/index.js validate path/to/project.json --sarif --output=results.sarif
```

Validation runs in two layers:

1. structural schema checks;
2. CODEX semantic and graph checks.

The `core` profile performs required checks. The `strict` profile additionally reports objects outside every containment root.

## Inspection and graph export

```bash
node apps/cli/dist/index.js inspect path/to/project.json --json
node apps/cli/dist/index.js graph path/to/project.json --format=json
node apps/cli/dist/index.js graph path/to/project.json --format=dot
node apps/cli/dist/index.js graph path/to/project.json --relations=contains,derivedFrom
node apps/cli/dist/index.js graph path/to/project.json --format=dot --output=project.dot
```

## Diagnostic registry

```bash
node apps/cli/dist/index.js diagnostics
node apps/cli/dist/index.js diagnostics --json
node apps/cli/dist/index.js diagnostics --severity=warning
```

Every emitted diagnostic must be registered in `registry/diagnostic-codes.json`. Schema diagnostics use the `ERR-2001…ERR-2004` range.

## Current validation coverage

- JSON structure, required fields, property types, and unexpected properties;
- identifiers and semantic versions;
- controlled object, relationship, lifecycle, profile, language, and diagnostic values;
- relationship constraints, missing targets, self-references, and graph cycles;
- provenance integrity and mandatory scholarly source links;
- strict containment reachability;
- JSON, DOT, and SARIF output.

## Repository structure

```text
apps/          executable applications
packages/      core, registry, schema, and validator packages
core/          normative CODEX Core drafts
registry/      machine-readable controlled vocabularies
schemas/       machine-readable validation schemas
examples/      valid and invalid conformance fixtures
tests/         executable conformance and regression tests
releases/      immutable release manifests and notes
rfc/           proposals and extensions
adr/           architectural decisions
specs/         implementation specifications
profiles/      domain-specific profiles
guides/        implementation guidance
templates/     reusable project artifacts
```

## Planned first profile

**HERMETICA** will be the first reference project and will apply CODEX to multilingual, annotated editions of classical Hermetic texts.

## License

A project license has not yet been selected. Until a license is adopted, repository contents remain protected by applicable copyright law and should not be treated as openly licensed.
