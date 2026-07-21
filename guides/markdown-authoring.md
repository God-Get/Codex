# Markdown authoring

CODEX 0.2 includes a deterministic Markdown-to-Object-Graph compiler in `@codex/authoring`, exposed through the main `codex` CLI.

## Directory layout

```text
project.md
objects/
  source.md
  translation.md
```

`project.md` defines `codexVersion`, `id`, `title`, and optionally `profile`. Every file below `objects/` defines one CODEX object.

## Front matter

Documents begin with flat `key: value` front matter delimited by `---`. Arrays and object collections use JSON syntax.

```markdown
---
id: translation.poimandres.en
type: translation
title: Poimandres English Translation
version: 1.0.0
status: draft
language: en
derivedFrom: ["source.poimandres.grc"]
relations: [{"type":"translates","target":"source.poimandres.grc"}]
translator: CODEX HERMETICA
---

# Poimandres

Edition content follows here.
```

Canonical object fields are compiled directly. Additional front-matter fields are preserved in `metadata`; the Markdown body becomes `metadata.content`, and the root-relative filename becomes `metadata.sourcePath`.

## Compile and validate

```bash
npm run build
node apps/cli/dist/index.js authoring compile path/to/authoring-root \
  --output=project.json
```

The integrated command compiles the Object Graph and immediately performs structural and semantic validation. The profile is selected in this order:

1. `--profile=id` from the command line;
2. `profile` from `project.md`;
3. the `core` profile.

A validation failure leaves the generated JSON available for inspection but returns a failing process exit code.

Machine-readable output:

```bash
node apps/cli/dist/index.js authoring compile path/to/authoring-root \
  --output=project.json --json
```

Compile without semantic validation only when another pipeline performs validation:

```bash
node apps/cli/dist/index.js authoring compile path/to/authoring-root \
  --output=project.json --no-validate
```

Optional path overrides:

```bash
node apps/cli/dist/index.js authoring compile . \
  --project-file=edition.md \
  --objects-directory=documents \
  --output=project.json
```

The low-level package binary remains available:

```bash
node packages/authoring/dist/cli.js path/to/authoring-root --output=project.json
```

The compiler rejects missing or unterminated front matter, malformed keys, duplicate keys, invalid relation arrays, invalid string arrays, duplicate object identifiers, and paths escaping the authoring root. CI compares the low-level package output with the integrated CLI output to enforce deterministic equivalence.
