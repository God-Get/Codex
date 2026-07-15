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
- `@codex/cli` — `validate`, `inspect`, `graph`, `diagnostics`, and `doctor` commands;
- machine-readable registries and JSON Schemas;
- valid and intentionally invalid conformance fixtures;
- executable regression tests and GitHub Actions CI.

### Run locally

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

Validate another project:

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

Export and filter the project graph:

```bash
node apps/cli/dist/index.js graph path/to/project.json --format=json
node apps/cli/dist/index.js graph path/to/project.json --format=dot
node apps/cli/dist/index.js graph path/to/project.json --relations=contains,derivedFrom
node apps/cli/dist/index.js graph path/to/project.json --format=dot --output=project.dot
```

List registered diagnostics:

```bash
node apps/cli/dist/index.js diagnostics
node apps/cli/dist/index.js diagnostics --json
node apps/cli/dist/index.js diagnostics --severity=warning
```

## Validation profiles

- `core` — required structural and semantic checks;
- `strict` — core checks plus reachability warnings for objects outside every containment root.

## Current validation coverage

- identifier syntax and uniqueness;
- semantic versions;
- registered object, relationship, lifecycle, profile, language, and diagnostic values;
- relationship source and target constraints;
- missing targets, self-references, and graph cycles;
- `derivedFrom` provenance integrity;
- required provenance for translations and commentaries;
- strict-profile containment reachability;
- JSON and Graphviz DOT graph export, filtering, and file output;
- consistency between emitted diagnostics and the diagnostic registry.

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
apps/          executable applications
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
