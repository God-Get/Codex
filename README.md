# CODEX

**Open Architecture for Digital Scholarly Editions**

CODEX is an open, reproducible framework for preparing, maintaining, publishing, and preserving scholarly editions of classical, philosophical, religious, historical, and literary texts.

**Current release:** `0.1.0 Engineering MVP`  
**Status:** active development

## Engineering MVP

The repository contains a minimal TypeScript implementation:

- `@codex/core` — canonical project, object, inspection, diagnostic, and validation interfaces;
- `@codex/registry` — controlled vocabularies loaded from `registry/*.json`;
- `@codex/validator` — structural, language, provenance, relationship, cycle, reachability, inspection, and graph logic;
- `@codex/cli` — `codex validate`, `codex inspect`, `codex graph`, and `codex doctor` commands;
- `registry/*.json` — machine-readable controlled vocabularies and relation constraints;
- `schemas/*.json` — initial JSON Schemas;
- `examples/` — valid and intentionally invalid conformance fixtures;
- `tests/validator.test.mjs` — executable conformance and regression tests;
- GitHub Actions CI for type checking, tests, diagnostics, inspection, graph export, and validation.

### Run locally

```bash
npm install
npm run check
npm test
npm run doctor
npm run validate
npm run validate:strict
npm run validate:json
npm run inspect
npm run inspect:json
npm run graph
npm run graph:dot
```

Validate another JSON project:

```bash
node apps/cli/dist/index.js validate path/to/project.json
node apps/cli/dist/index.js validate path/to/project.json --profile=strict
node apps/cli/dist/index.js validate path/to/project.json --json
```

Inspect project structure:

```bash
node apps/cli/dist/index.js inspect path/to/project.json
node apps/cli/dist/index.js inspect path/to/project.json --json
```

Export the project graph:

```bash
node apps/cli/dist/index.js graph path/to/project.json --format=json
node apps/cli/dist/index.js graph path/to/project.json --format=dot
```

The inspection report includes object and relation counts, provenance-link counts, containment roots, unreachable objects, object-type distribution, lifecycle-status distribution, and languages.

## Validation profiles

- `core` — required structural and semantic checks;
- `strict` — core checks plus reachability warnings for objects outside every containment root.

## Current validation coverage

- project and object identifier syntax;
- unique object identifiers;
- semantic versions for CODEX and project objects;
- registered object, relationship, lifecycle, validation-profile, and language values;
- relationship source and target constraints;
- forbidden self-references;
- missing relationship targets;
- cycles in `contains` and `dependsOn` graphs;
- `derivedFrom` identifier syntax, existence, and self-reference;
- required provenance for translations and commentaries;
- strict-profile containment reachability;
- JSON and Graphviz DOT graph export;
- runtime loading of controlled vocabularies from JSON registry files.

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
registry/      machine-readable controlled vocabularies
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
