# Production translation workflow

CODEX translations remain ordinary CODEX 0.2 objects. Automation adds providers, durable checkpoints, translation memory, terminology policy, structural QA, audit records, and human review without changing the canonical object shape or the `apiVersion: "0.2"` CLI envelope.

## Object model and provenance

```yaml
id: TRANSLATION-0001
type: translation
title: Corpus Hermeticum I.1 — Russian translation
version: 0.1.0
status: draft
language: ru
derivedFrom: [FRAGMENT-0001]
relations: [translation-of->FRAGMENT-0001]
translationMode: machine
sourceLanguage: el
```

`derivedFrom` contains exactly one source. `translation-of` points from the translation to that same source. Sources must exist, languages must differ, and provenance cannot self-reference or cycle. Translation chains are valid when every link preserves this provenance. Published translations cannot derive from draft sources.

## Provider configuration

```json
{
  "$schema": "../../schemas/translation-automation.schema.json",
  "provider": {
    "kind": "openai-compatible",
    "endpoint": "https://provider.example/v1/chat/completions",
    "model": "translation-model",
    "apiKeyEnv": "CODEX_TRANSLATION_API_KEY",
    "timeoutMs": 60000,
    "maxResponseBytes": 8388608,
    "inputCostPerMillion": 1.5,
    "outputCostPerMillion": 6
  },
  "glossaryFile": "fixtures/glossary.json",
  "memoryFile": ".codex/translation-memory.json",
  "stateFile": ".codex/translation-state.json",
  "auditFile": ".codex/translation-audit.jsonl",
  "outputDirectory": "translations",
  "concurrency": 4,
  "requestsPerMinute": 60,
  "maxRetries": 4,
  "fuzzyThreshold": 0.92,
  "itemTimeoutMs": 300000,
  "maxSourceBytes": 8388608,
  "allowSensitiveContent": false
}
```

`static` reads a deterministic `{ "translations": { "SOURCE:language": "text" } }` map and is intended for CI and air-gapped use. `openai-compatible` implements the chat-completions wire format over HTTPS. It treats 429, 408, 409, 5xx, timeouts, and network failures as transient; permanent 4xx and malformed or empty responses are not retried. Retry uses exponential backoff with jitter and honors `Retry-After`.

The public `TranslationProvider`, `TranslationProviderFactory`, and `TranslationProviderRegistry` contracts allow a package to register another provider kind without changing the CLI or batch runner. Provider implementations must observe the supplied `AbortSignal`.

API keys are read only from `apiKeyEnv`. They are never written to generated objects, checkpoints, memory, audit logs, or error messages.

## Running and resuming

```bash
codex translation run reference/hermetica \
  --config reference/hermetica/translation.config.json \
  --dry-run --json

codex translation run reference/hermetica \
  --config reference/hermetica/translation.config.json \
  --source FRAG-0001 --language en --json
```

Each successful item is validated and atomically written before the next checkpoint. The state file records completion and the SHA-256 of the output. A repeated command verifies that checksum and skips completed work. Interrupted `running` or `failed` items are eligible for retry; a completed checkpoint whose output was modified is rejected instead of silently overwriting data. `--force` explicitly replaces a managed translation. `--allow-partial` returns completed outputs even when another item fails.

The runner accepts an `AsyncIterable`, keeps only the configured number of requests active, and supports `collectResults: false`. This permits queues larger than 10,000 objects without retaining the corpus of results in memory. Rate limiting is shared across workers.

## Translation memory

Memory version 1 remains backward compatible. New entries include normalized source text so CODEX can perform exact lookup first and a configurable fuzzy lookup second. Entries are keyed by source/target language, source content, and applicable glossary. Updating the source or glossary produces a new key. Import merges by key and reports duplicates.

```bash
codex translation memory --file .codex/translation-memory.json --json
codex translation memory export --file .codex/translation-memory.json \
  --output translation-memory.backup.json --json
codex translation memory import --file .codex/translation-memory.json \
  --input team-memory.json --json
```

Fuzzy reuse still passes the complete QA gate before output is accepted.

## Glossary

```json
[
  {
    "source": "λόγος",
    "target": "Логос",
    "sourceLanguage": "el",
    "targetLanguage": "ru",
    "required": true,
    "caseSensitive": true,
    "forbidden": ["слово", "логос"]
  }
]
```

`required` defaults to `true`. `caseSensitive` defaults to `false`. Every forbidden variant is checked independently. Conflicting entries are rejected before a provider is called.

## Quality assurance

`translation run`, `translation qa`, and approval verify:

- non-empty and changed natural-language output;
- Markdown heading levels;
- link and image destinations;
- CODEX identifiers;
- fenced code blocks and inline code;
- table column structure and list nesting/type;
- HTML tag structure;
- well-formed Unicode without replacement/control characters;
- `{{...}}`, `${...}`, and printf placeholders;
- required and forbidden glossary terminology.

Generated front matter is produced by CODEX rather than by the provider, parsed by the authoring layer, and validated with the active profile before the output is accepted.

## Human review

```bash
codex translation review --file translations/ru/source.md \
  --status review --reviewer "A. Reviewer" --json
codex translation review --file translations/ru/source.md \
  --status approved --reviewer "B. Approver" --config translation.config.json --json
codex translation review --file translations/ru/source.md \
  --status published --reviewer "C. Publisher" --config translation.config.json --json
```

The enforced path is `draft → review → approved → published`. Review records `reviewedBy/reviewedAt`, approval records `approvedBy/approvedAt`, and publication records `publishedBy/publishedAt`. Approval and publication rerun QA. A published item is terminal in this workflow; revision begins as a new draft/version.

## Audit and operations

The JSONL audit contains provider and model identifiers, duration, attempts, retries, memory match type, token counts and configured cost estimates when available, plus sanitized failure information. It never stores source/translated text or credentials.

Before remote transmission CODEX rejects path traversal, oversized inputs, likely private keys/API tokens, and unsafe configuration paths. The provider prompt labels the document as untrusted data and explicitly ignores instructions embedded in it. Set `allowSensitiveContent` only after a project-specific review.

Deployment, threat controls, and incident handling are described in [translation-deployment.md](translation-deployment.md) and [translation-security.md](translation-security.md). Upgrade details are in [translation-migration.md](translation-migration.md).

## Current boundary

Structural and terminology QA cannot establish semantic or scholarly correctness; publication always requires recorded human review. The built-in remote adapter uses chat completions rather than provider-specific batch endpoints. Distributed multi-host coordination requires an external queue/lock service; the included checkpoint is durable for one writer per project.
