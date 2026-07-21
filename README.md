# CODEX

**Open Architecture for Digital Scholarly Editions**

CODEX is a reproducible framework for preparing, validating, querying, packaging, publishing, and preserving digital scholarly editions.

**Current implementation:** `0.2.0`  
**Status:** implementation complete; release publication pending the final green CI and signed artifact gate.

## CODEX 0.2

The repository contains:

- `@codex/core` — canonical project, object, relation, diagnostic, and validation interfaces;
- `@codex/registry` — machine-readable object types, relation types, languages, lifecycle states, profiles, constraints, and diagnostic codes;
- `@codex/schema` — JSON Schema Draft 2020-12 structural validation;
- `@codex/validator` — semantic validation, provenance, relation constraints, cycles, reachability, inspection, graph export, diagnostics, and SARIF;
- `@codex/profiles` — profile discovery, inheritance, merging, and built-in Core, scholarly-edition, and HERMETICA profiles;
- `@codex/authoring` — Markdown authoring compiler with structured diagnostics;
- `@codex/graph` — canonical runtime graph, indexes, traversal, roots, reachability, and statistics;
- `@codex/importer` — deterministic Markdown/YAML importer and `codex-import` CLI;
- `@codex/query` — query parser/executor and `codex-query` CLI;
- `@codex/release` — deterministic manifests, SHA-256 verification, safe packaging/unpacking, CycloneDX SBOM, and Ed25519 signatures;
- `@codex/cli` — integrated validation, inspection, graph, diagnostics, profile, authoring, release, package, and doctor commands;
- `reference/hermetica` — the multilingual HERMETICA reference corpus.

## Requirements

- Node.js 22 or newer;
- npm with workspace support.

## Build and conformance

```bash
npm install
npm run check
npm test
npm run doctor
```

The test suite includes package-level tests, CLI process tests, malformed-input fixtures, HERMETICA runtime conformance, release integrity, signing, SBOM, package verification, and safe unpacking.

## Authoring and importing

Compile the structured authoring example through the integrated CLI:

```bash
npm run authoring:compile
npm run authoring:compile:json
```

Compile the HERMETICA Markdown/YAML corpus through the runtime importer:

```bash
npm run import:hermetica
npm run import:hermetica:json
```

Direct package CLI usage:

```bash
node packages/importer/dist/cli.js reference/hermetica \
  --output=reference/hermetica/project.json --profile=hermetica --json
```

## Query runtime

```bash
npm run query:hermetica
npm run query:hermetica:json
```

Direct usage:

```bash
node packages/query/dist/cli.js reference/hermetica/project.json \
  "type=translation AND language=ru" --json
```

CODEX Query 0.2 supports equality predicates joined by `AND`, including nested `metadata.*` fields.

## Validation

```bash
node apps/cli/dist/index.js validate path/to/project.json
node apps/cli/dist/index.js validate path/to/project.json --profile=strict
node apps/cli/dist/index.js validate path/to/project.json --profile=hermetica
node apps/cli/dist/index.js validate path/to/project.json --json
node apps/cli/dist/index.js validate path/to/project.json --sarif --output=results.sarif
```

Validation runs structural schema checks followed by semantic, provenance, relation, cycle, and reachability checks.

## Inspection, graphs, and diagnostics

```bash
node apps/cli/dist/index.js inspect path/to/project.json --json
node apps/cli/dist/index.js graph path/to/project.json --format=dot --output=project.dot
node apps/cli/dist/index.js graph path/to/project.json --relations=contains,derivedFrom
node apps/cli/dist/index.js diagnostics --severity=warning --json
```

Every diagnostic emitted by CODEX is registered in `registry/diagnostic-codes.json`.

## Machine-readable CLI contract

JSON commands use a stable envelope:

```json
{
  "ok": true,
  "apiVersion": "0.2",
  "command": "command.name",
  "result": {}
}
```

Failures use the same envelope with `ok: false` and a structured `diagnostic`. Successful JSON is written to stdout; failures are written to stderr.

## Release integrity

Prepare and verify a sealed release manifest:

```bash
npm run release:prepare
npm run release:verify
npm run release:verify:json
```

Generate an ephemeral Ed25519 pair, sign the manifest, and verify the detached signature:

```bash
npm run release:keygen
npm run release:sign
npm run release:signature-verify
```

Build, verify, and safely unpack the portable release package:

```bash
npm run package:build
npm run package:verify
npm run package:verify:json
npm run package:unpack
```

The package contains the sealed manifest, `CHECKSUMS.sha256`, a package descriptor, a CycloneDX SBOM, and every declared artifact or conformance fixture. Verification rejects missing, changed, undeclared, symbolic-link, and path-unsafe entries.

## Specifications and release

- Core specification: `specs/core/README.md`;
- runtime specification: `specs/runtime/README.md`;
- release manifest: `releases/0.2.0/manifest.json`;
- final publication checklist: `releases/0.2.0/RELEASE-CHECKLIST.md`;
- changes: `CHANGELOG.md`.

The codebase and conformance assets are complete. The manifest intentionally remains `draft` until a green workflow run produces the prepared checksums, detached signature, public key, and portable release archive.

## Repository structure

```text
apps/          integrated executable applications
packages/      reusable CODEX packages
registry/      controlled vocabularies and constraints
schemas/       machine-readable schemas
profiles/      built-in validation profiles
specs/         normative implementation specifications
reference/     reference scholarly corpora
examples/      valid and invalid fixtures
tests/         conformance and regression tests
releases/      release manifests and publication gates
rfc/           proposals and extensions
adr/           architectural decisions
```

## License

A project license has not yet been selected. Until one is adopted, repository contents remain protected by applicable copyright law and must not be treated as openly licensed.
