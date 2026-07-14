# CODEX

**Open Architecture for Digital Scholarly Editions**

CODEX is an open, reproducible framework for preparing, maintaining, publishing, and preserving scholarly editions of classical, philosophical, religious, historical, and literary texts.

**Current release:** `0.1.0 Engineering MVP`  
**Status:** active development

## Engineering MVP

The repository now contains a minimal TypeScript implementation:

- `@codex/core` — canonical project and object interfaces;
- `@codex/registry` — controlled object, relation, and lifecycle vocabularies;
- `@codex/validator` — identifier, registry, uniqueness, and relationship validation;
- `@codex/cli` — the first `codex validate` command;
- `schemas/project.schema.json` — initial JSON Schema;
- `examples/minimal-project.json` — a valid reference project;
- GitHub Actions CI for compilation and validation.

### Run locally

```bash
npm install
npm run build
npm run validate
```

Validate another JSON project:

```bash
node apps/cli/dist/index.js validate path/to/project.json
```

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
schemas/       machine-readable validation schemas
examples/      reference project data
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
