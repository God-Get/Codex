# Translation model and workflow

The first translation stage is deterministic and local. It defines storage, provenance, validation, authoring, and status reporting without calling an AI or machine-translation service.

## Translation object

A translation remains a normal CODEX object and therefore preserves CODEX 0.2 compatibility:

```json
{
  "id": "TRANSLATION-0001",
  "type": "translation",
  "title": "Corpus Hermeticum I.1 — Russian translation",
  "version": "0.1.0",
  "status": "draft",
  "language": "ru",
  "derivedFrom": ["FRAGMENT-0001"],
  "relations": [
    {"type": "translation-of", "target": "FRAGMENT-0001"}
  ],
  "metadata": {
    "translationMode": "human",
    "sourceLanguage": "el",
    "content": "..."
  }
}
```

`derivedFrom[0]` is the canonical provenance source. `translation-of` makes the same direction explicit in the relation graph: translation → source. The relation is optional for legacy CODEX 0.2 objects, but when present it must match `derivedFrom`.

## Validation

A translation requires a registered language, exactly one existing source, non-empty text, and a language different from its source. Self-reference and provenance cycles are forbidden. Translation chains are allowed when every translation in the chain retains one valid source. A published translation cannot derive from a draft source.

Profiles can constrain source object types, expected target languages, and required metadata. HERMETICA accepts fragments, Hermetic fragments, and translations as sources; expects Russian and English coverage; and requires `metadata.translationMode`.

## Create a Markdown scaffold

```bash
node apps/cli/dist/index.js translation create \
  --source FRAG-0001 \
  --language ru \
  --id TRANSLATION-0001 \
  --output reference/hermetica/translations/ru/ch-01.md
```

The command discovers the nearest `project.yml`/`project.yaml`, verifies the source, ID, language, and profile source rules, and writes deterministic front matter. Existing files are protected unless `--force` is supplied. Use `--root DIR` when the output is outside the project tree and `--json` for the CODEX 0.2 envelope.

The generated body contains a comment placeholder. It must be replaced with actual translation text before semantic validation can pass.

## Translation status

```bash
node apps/cli/dist/index.js translation status reference/hermetica
node apps/cli/dist/index.js translation status reference/hermetica --json
```

Status reports source objects, existing languages, missing profile languages, lifecycle counts, orphan translations, and invalid provenance. Missing coverage is computed from the active profile; it does not create files.

## First-stage limits

- no OpenAI, Google Translate, DeepL, or other external API;
- no automatic sentence segmentation or alignment;
- no terminology memory, quality scoring, or reviewer assignment;
- no automatic promotion from `draft`;
- no background jobs or credential management.

Future automation can consume this model, but generated text must still satisfy the same provenance and validation rules.
