# CODEX Governance

## Principles

Governance must be transparent, proportionate, documented, and reversible where possible. Repository history is part of the scholarly record.

## Roles

### Maintainer

Manages repository access, releases, and operational decisions.

### Core editor

Reviews normative consistency across CODEX Core.

### Domain editor

Reviews specialist editorial, linguistic, historical, or technical material.

### Contributor

Proposes improvements through issues, RFCs, ADRs, or pull requests.

### Reviewer

Performs documented review without being the author of the reviewed change when feasible.

One person may hold several roles during Genesis, but each approved document must record authorship and review status.

## Change types

- editorial correction;
- clarification without normative change;
- backward-compatible feature;
- breaking normative change;
- deprecation;
- security or preservation emergency.

## Decision process

1. Open an issue describing the problem.
2. Use an RFC for substantial policy or specification changes.
3. Use an ADR for architectural choices that affect implementation.
4. Record alternatives and consequences.
5. Review the proposal.
6. Merge the approved change.
7. Update the changelog and affected cross-references.

## Version policy

CODEX uses semantic versioning after 1.0. During Genesis, versions use `0.x.y`:

- patch: corrections and non-normative clarifications;
- minor: new draft standards or compatible structural changes;
- major: incompatible architectural revision.

## Normative language

The terms **MUST**, **MUST NOT**, **SHOULD**, **SHOULD NOT**, and **MAY** indicate requirement strength in normative documents.

## Conflict of interest

Reviewers disclose material conflicts. Claims involving a contributor's own publication, product, or proprietary method require independent review where possible.

## Appeals

Disputed decisions remain documented. A contributor may request reconsideration by opening a new issue citing the prior decision and new evidence.
