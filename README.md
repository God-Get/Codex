# CODEX

**Open Architecture for Digital Scholarly Editions**

CODEX is an open, reproducible framework for preparing, maintaining, publishing, and preserving scholarly editions.

**Current release:** `0.1.0 Engineering MVP`  
**Status:** active development

## Engineering MVP

The repository contains:

- `@codex/core` — canonical interfaces;
- `@codex/registry` — machine-readable controlled vocabularies;
- `@codex/schema` — structural project validation aligned with JSON Schema;
- `@codex/validator` — semantic, provenance, relationship, cycle, reachability, inspection, and graph logic;
- `@codex/release` — SHA-256 manifests, package verification, safe unpacking, CycloneDX SBOM, and Ed25519 signatures;
- `@codex/cli` — `validate`, `inspect`, `graph`, `diagnostics`, `release`, `package`, and `doctor`;
- conformance fixtures, regression tests, CI, SARIF publication, and a draft `0.1.0` release manifest.

## Run locally

```bash
npm install
npm run check
npm test
npm run doctor
npm run validate
npm run release:prepare
npm run release:verify
npm run release:keygen
npm run release:sign
npm run release:signature-verify
npm run package:build
npm run package:verify
npm run package:unpack
```

## Validation

```bash
node apps/cli/dist/index.js validate path/to/project.json
node apps/cli/dist/index.js validate path/to/project.json --profile=strict
node apps/cli/dist/index.js validate path/to/project.json --json
node apps/cli/dist/index.js validate path/to/project.json --sarif --output=results.sarif
```

Validation runs in two layers: structural schema checks, followed by CODEX semantic and graph checks. The `strict` profile additionally reports objects outside every containment root.

## Inspection, graphs, and diagnostics

```bash
node apps/cli/dist/index.js inspect path/to/project.json --json
node apps/cli/dist/index.js graph path/to/project.json --format=dot --output=project.dot
node apps/cli/dist/index.js graph path/to/project.json --relations=contains,derivedFrom
node apps/cli/dist/index.js diagnostics --severity=warning
```

Every emitted diagnostic must be registered in `registry/diagnostic-codes.json`. Schema diagnostics use the `ERR-2001…ERR-2004` range.

## Release integrity

Prepare a sealed manifest containing SHA-256 checksums, then verify it:

```bash
node apps/cli/dist/index.js release prepare releases/0.1.0/manifest.json \
  --output=releases/0.1.0/manifest.prepared.json
node apps/cli/dist/index.js release verify releases/0.1.0/manifest.prepared.json
```

Create an Ed25519 key pair, sign the prepared manifest, and verify the detached signature:

```bash
node apps/cli/dist/index.js release keygen \
  --private-key=private.pem --public-key=public.pem
node apps/cli/dist/index.js release sign releases/0.1.0/manifest.prepared.json \
  --private-key=private.pem --output=manifest.sig.json
node apps/cli/dist/index.js release signature-verify releases/0.1.0/manifest.prepared.json \
  --signature=manifest.sig.json --public-key=public.pem
```

Private keys are never committed. CI generates an ephemeral Ed25519 pair only to test the signing path.

## Portable packages and SBOM

Build, verify, and safely unpack a package directory:

```bash
node apps/cli/dist/index.js package build releases/0.1.0/manifest.prepared.json \
  --output=codex-package-0.1.0
node apps/cli/dist/index.js package verify codex-package-0.1.0
node apps/cli/dist/index.js package unpack codex-package-0.1.0 \
  --output=codex-unpacked-0.1.0
```

The package contains:

- `manifest.json` — sealed release manifest;
- `CHECKSUMS.sha256` — deterministic checksum list;
- `codex-package.json` — package descriptor;
- `bom.cdx.json` — CycloneDX 1.7 SBOM;
- all declared schemas, registries, and conformance fixtures.

Verification rejects missing or modified files, symbolic links, unsafe entries, descriptor/manifest mismatches, and undeclared extra files. Unpacking starts only after successful verification and copies only regular files through root-confined paths.

GitHub Actions creates a deterministic `codex-package-0.1.0.tgz` and publishes it together with the detached manifest signature and public key. SARIF publication depends on repository Code Scanning settings.

## Current coverage

- JSON structure and schema diagnostics;
- identifiers, semantic versions, registries, relation constraints, cycles, and provenance;
- strict containment reachability;
- JSON, DOT, and SARIF output;
- release SHA-256 verification and tamper detection;
- package allow-list verification and safe unpacking;
- CycloneDX 1.7 SBOM generation;
- Ed25519 detached manifest signatures.

## Repository structure

```text
apps/          executable applications
packages/      core, registry, schema, validator, and release packages
core/          normative CODEX Core drafts
registry/      machine-readable controlled vocabularies
schemas/       machine-readable validation schemas
examples/      valid and invalid conformance fixtures
tests/         executable conformance and regression tests
releases/      source and prepared release manifests
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
