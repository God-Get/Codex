# CODEX

**Open Architecture for Digital Scholarly Editions**

CODEX is an open, reproducible framework for preparing, maintaining, publishing, and preserving scholarly editions of classical, philosophical, religious, historical, and literary texts.

**Current release:** `0.1.0 Engineering MVP`  
**Status:** active development

## Engineering MVP

The repository contains a minimal TypeScript implementation:

- `@codex/core` — canonical project and object interfaces;
- `@codex/registry` — controlled object, relation, lifecycle, and semantic relation rules;
- `@codex/validator` — identifier, registry, uniqueness, reference, and semantic relationship validation;
- `@codex/cli` — `codex validate` and `codex doctor` commands;
- `registry/*.json` — machine-readable controlled vocabularies and relation constraints;
- `schemas/*.json` — initial JSON Schemas;
- `examples/minimal-project.json` — valid reference fixture;
- `examples/invalid-project.json` — invalid structural diagnostic fixture;
- `examples/invalid-relations.json` — invalid semantic relationship fixture;
- `tests/validator.test.mjs` — executable validator and registry synchronization tests;
- GitHub Actions CI for type checking, tests, diagnostics, build, and validation.

### Run locally

```bash
npm install
npm run check
npm test
npm run doctor
npm run validate
npm run validate:json
```

Validate another JSON project:

```bash
node apps/cli/dist/index.js validate path/to/project.json
```

Produce a structured JSON report for CI or another tool:

```bash
node apps/cli/dist/index.js validate path/to/project.json --json
```

Check the local development environment:

```bash
node apps/cli/dist/index.js doctor
```

## Current validation coverage

The MVP currently checks:

- permanent identifier format;
- duplicate object identifiers;
- registered object and lifecycle types;
- registered relationship types;
- missing relationship targets;
- prohibited self-references;
- permitted source and target object types for selected relationships;
- synchronization between TypeScript registries and machine-readable JSON registries.

## Start here

- [Manifesto](MANIFESTO.md)
- [Vision](VISION.md)
- [Project Charter](CHARTER.md)
- [Reference Architecture](ARCHITECTURE.md)
- [Governance](GOVERNANCE.md)
- [Roadmap](ROADMAP.md)
- [Contributing](CONTRIBUTING.md)
- [Code of Conduct](CODE_OF_CONDUCT.md)
- [Changelog](CHANGELOG.md)

## Repository structure

```text
apps/          executable applications, beginning with the CLI
packages/      reusable core, registry, and validator packages
core/          normative CODEX Core drafts
registry/      machine-readable controlled vocabularies and semantic constraints
schemas/       machine-readable validation schemas
examples/      valid and invalid reference project data
tests/         executable conformance and regression tests
rfc/           proposals and extensions
adr/           architectural decisions
specs/         implementation specifications
profiles/      domain-specific profiles
guides/        implementation guidance
templates/     reusable project artifacts
tools/         future build and publication utilities
releases/      release manifests and notes
```

## Foundational principles

- source before interpretation;
- translation before paraphrase;
- one master source for all publications;
- semantic structure rather than visual formatting;
- documented provenance and editorial decisions;
- accessible and open publication formats;
- long-term preservation independent of any one tool;
- accountable human review of AI-assisted work.

## Planned first profile

**HERMETICA** will be the first reference project and will apply CODEX to multilingual, annotated editions of classical Hermetic texts.

## License

A project license has not yet been selected. Until a license is adopted, repository contents remain protected by applicable copyright law and should not be treated as openly licensed.
