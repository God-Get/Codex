# Translation model and workflow

CODEX combines a stable translation object model with an opt-in automated workflow. Storage, validation, provenance, status, QA, and offline fixtures remain deterministic. External providers are contacted only by `translation run` with a non-static provider configuration.

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

## Automated translation

Create a configuration:

```json
{
  "$schema": "../../schemas/translation-automation.schema.json",
  "provider": {
    "kind": "openai-compatible",
    "endpoint": "https://provider.example/v1/chat/completions",
    "model": "translation-model",
    "apiKeyEnv": "CODEX_TRANSLATION_API_KEY"
  },
  "glossaryFile": "glossary.json",
  "memoryFile": ".codex-ci/translation-memory.json",
  "outputDirectory": "translations",
  "concurrency": 2,
  "requestsPerMinute": 60,
  "maxRetries": 2
}
```

Preview without credentials or network access:

```bash
codex translation run reference/hermetica \
  --config reference/hermetica/translation.config.json \
  --dry-run --json
```

Translate one object or every missing profile target:

```bash
codex translation run reference/hermetica \
  --config reference/hermetica/translation.config.json \
  --source FRAG-0001 --language en --json

codex translation run reference/hermetica \
  --config reference/hermetica/translation.config.json --json
```

Existing files are never replaced without `--force`. Batch output is all-or-nothing unless `--allow-partial` is explicit. Successful provider results are written to translation memory even when another batch item fails, preventing duplicate billable requests on retry.

The built-in `static` provider reads translations from a JSON map and is intended for fixtures, air-gapped workflows, and CI. The `openai-compatible` provider uses HTTPS, a deterministic temperature of zero, bounded timeout/retries, concurrency control, and requests-per-minute throttling. The API key is read from `apiKeyEnv`; its value is not persisted or included in output.

## Glossary, memory, and QA

Glossaries are arrays of `{source,target,sourceLanguage?,targetLanguage?}`. Applicable terms are sent to the provider and enforced after generation.

Translation-memory keys include normalized source text, source and target language, and applicable glossary constraints. A source or glossary change therefore invalidates the cached entry.

QA rejects:

- empty or unchanged output;
- lost `{{placeholder}}`, `${placeholder}`, or printf placeholders;
- required glossary targets that are absent.

An anomalous length ratio produces a warning and lowers the score without blocking the draft. Generated Markdown records provider/model provenance, timestamp, QA score, and `qaPassed`.

```bash
codex translation qa reference/hermetica \
  --config reference/hermetica/translation.config.json --json
codex translation memory \
  --file reference/hermetica/.codex-ci/translation-memory.json --json
```

## Human review

Automated output always starts as `draft`; automation never publishes it. A reviewer can move a file to `review` or `approved`. Approval reruns the local QA gate:

```bash
codex translation review \
  --file reference/hermetica/translations/en/frag-0001.md \
  --status review --reviewer "A. Reviewer" --json
codex translation review \
  --file reference/hermetica/translations/en/frag-0001.md \
  --status approved --reviewer "A. Reviewer" \
  --config reference/hermetica/translation.config.json --json
```

The command enforces `draft → review → approved`, records `reviewedBy` and `reviewedAt`, and allows an approved translation to return to draft for revision. Publication remains governed by the normal CODEX lifecycle and validator.

## Operational limits

- Provider quality and pricing remain properties of the configured service.
- The current adapter targets the common chat-completions wire format; provider-specific batch APIs require an additional adapter.
- QA is structural and terminology-based, not a substitute for expert semantic review.
- Sentence-level alignment and collaborative reviewer assignment are not included.
- The CLI is synchronous; durable background queues belong in a hosting integration.

Generated text must always satisfy the same provenance and validation rules as human-authored translations.
