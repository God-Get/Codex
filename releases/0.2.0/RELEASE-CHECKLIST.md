# CODEX 0.2 Release Checklist

## Specification freeze

- [x] Core rules and schemas are versioned.
- [x] Public package exports are defined.
- [x] CLI JSON envelope is versioned as 0.2.
- [x] Built-in profile identifiers are frozen.
- [x] Runtime graph edge direction is documented.
- [x] Query grammar is documented.

## Reference implementation

- [x] Authoring compiler is implemented.
- [x] Importer is implemented.
- [x] Runtime graph is implemented.
- [x] Query engine is implemented.
- [x] Validator and diagnostics are implemented.
- [x] Release signing and portable packaging are implemented.

## Conformance

- [x] Valid and invalid project fixtures exist.
- [x] HERMETICA reference corpus exists.
- [x] Unit and process tests cover public CLIs.
- [x] CI exercises authoring, importing, querying, validation, signing, packaging, verification, and unpacking.
- [x] SARIF and CycloneDX outputs are generated.

## Release-candidate verification

- [x] Windows test suite passes: 52 tests, 52 passed, 0 failed.
- [x] TypeScript project references pass with `npm run check`.
- [x] Development environment passes `npm run doctor` on Node.js 24.
- [x] Prepared release manifest verifies all 37 declared files.
- [x] Portable package builds with 37 files.
- [x] Portable package verification passes.

## Publication gate

- [x] Required GitHub Actions run is green for the release commit.
- [x] Prepared manifest checksums are generated from the release commit.
- [x] Detached Ed25519 signature and public key are attached to the release.
- [x] Portable `codex-package-0.2.0.tgz` artifact is attached.
- [x] Manifest status is changed from `draft` to `released` and `releasedAt` is set.

The implementation is complete when all specification, implementation, conformance, and release-candidate verification boxes are checked. Publication is complete only after the external GitHub release gates are checked.
