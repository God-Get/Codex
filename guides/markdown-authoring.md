# Markdown authoring

CODEX 0.2 includes an initial deterministic Markdown-to-Object-Graph compiler in `@codex/authoring`.

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

## Compile

```bash
npm run build
npm run authoring:compile
```

Or invoke the package binary directly:

```bash
node packages/authoring/dist/cli.js path/to/authoring-root --output=project.json
```

Optional path overrides:

```bash
node packages/authoring/dist/cli.js . --project=edition.md --objects=documents --output=project.json
```

The compiler rejects missing or unterminated front matter, malformed keys, duplicate keys, invalid relation arrays, invalid string arrays, duplicate object identifiers, and paths escaping the authoring root. Semantic and profile conformance remain the responsibility of the normal CODEX validator after compilation.
