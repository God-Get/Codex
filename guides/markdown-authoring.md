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
id: TRANSLATION-0001
type: translation
title: Poimandres English Translation
version: 1.0.0
status: draft
language: en
derivedFrom: ["SOURCE-0001"]
relations: [{"type":"translation-of","target":"SOURCE-0001"}]
translationMode: human
translator: CODEX HERMETICA
---

# Poimandres

Edition content follows here.
```

Canonical object fields are compiled directly. Additional front-matter fields are preserved in `metadata`; the Markdown body becomes `metadata.content`, and the root-relative filename becomes `metadata.sourcePath`.

## Compile and validate

Use the integrated CODEX CLI when the compiled graph should also be validated:

```bash
npm run build
node apps/cli/dist/index.js authoring compile path/to/authoring-root \
  --output=project.json
```

The project profile is selected from `--profile`, then `project.md`, and finally defaults to `core`.

Useful options:

```bash
node apps/cli/dist/index.js authoring compile . \
  --project-file=edition.md \
  --objects-directory=documents \
  --output=project.json \
  --json
```

Use `--no-validate` to compile without schema and semantic validation.

The package-level compiler remains available for low-level workflows:

```bash
node packages/authoring/dist/cli.js path/to/authoring-root \
  --output=project.json
```

Its path overrides use the shorter option names:

```bash
node packages/authoring/dist/cli.js . \
  --project=edition.md \
  --objects=documents \
  --output=project.json
```

## Diagnostics

Parser and compiler failures expose a stable `AuthoringError` with an `AuthoringDiagnostic` payload:

```json
{
  "code": "AUTH-1005",
  "message": "duplicate key id",
  "source": "objects/translation.md",
  "line": 4,
  "column": 1
}
```

The standalone compiler emits a machine-readable failure envelope to standard error when `--json` is present:

```json
{
  "ok": false,
  "diagnostic": {
    "code": "AUTH-1003",
    "message": "expected key: value",
    "source": "objects/broken.md",
    "line": 2,
    "column": 1
  }
}
```

Current codes:

| Code | Meaning |
| --- | --- |
| `AUTH-1001` | Missing front matter |
| `AUTH-1002` | Unterminated front matter |
| `AUTH-1003` | Malformed front-matter entry |
| `AUTH-1004` | Invalid front-matter key |
| `AUTH-1005` | Duplicate front-matter key |
| `AUTH-1006` | Missing or invalid required string |
| `AUTH-1007` | Invalid string array |
| `AUTH-1008` | Invalid relation array |
| `AUTH-1009` | Project, path, filesystem, or duplicate-object failure |

The compiler rejects missing or unterminated front matter, malformed keys, duplicate keys, invalid relation arrays, invalid string arrays, duplicate object identifiers, and paths escaping the authoring root. Semantic and profile conformance remain the responsibility of the normal CODEX validator after compilation.

See [Translation model and workflow](translations.md) for provenance, validation, scaffolding, and status commands.
