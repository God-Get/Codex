# CODEX Reference Architecture

## Layer model

1. **Governance** — authority, lifecycle, change control, licensing, conduct.
2. **Editorial** — source selection, translation, commentary, terminology, citation.
3. **Content** — structured master text, identifiers, references, media, apparatus.
4. **Metadata** — project, work, edition, contributor, source, rights, revision data.
5. **Validation** — schema checks, editorial QA, link checks, accessibility checks.
6. **Build** — reproducible transformation of master sources.
7. **Publication** — EPUB, HTML, PDF, DOCX and other derived outputs.
8. **Preservation** — archival packages, checksums, release manifests, migrations.

## Core principles

### Single source of truth

All published formats derive from a controlled master source. Corrections are made in the master source and rebuilt.

### Separation of concerns

Content, metadata, presentation, automation, and publication configuration are stored separately when practical.

### Semantic structure

Elements are identified by meaning—chapter, source passage, translation, note, citation—not only by appearance.

### Stable identity

Works, sections, passages, terms, notes, sources, media, and decisions receive stable identifiers suitable for cross-reference.

### Reversible decisions

Technology choices should be replaceable. Migration must preserve content, identifiers, provenance, and revision history.

### Progressive implementation

A small project may implement CODEX Core with Markdown and YAML. More complex editions may use TEI XML, databases, or knowledge graphs while retaining the same conceptual model.

## Recommended repository areas

```text
/
├── core/          # normative CODEX Core
├── governance/    # policies and decision processes
├── specs/         # detailed specifications
├── guides/        # implementation guidance
├── rfc/           # proposals
├── adr/           # accepted decisions
├── schemas/       # machine-readable validation
├── templates/     # reusable artifacts
├── examples/      # reference projects
├── tools/         # build and validation utilities
└── releases/      # release manifests and notes
```

## Conformance levels

- **Level A — Structured:** semantic source, metadata, version control.
- **Level B — Reproducible:** automated validation and repeatable builds.
- **Level C — Preservable:** archival package, checksums, migration documentation.
- **Level D — Reference:** independent review and published conformance report.
