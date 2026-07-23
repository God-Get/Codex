# Translation automation migration

The production workflow is additive and preserves CODEX 0.2 objects and CLI envelopes.

## From the initial translation model

- Existing manual translations remain valid.
- Existing version 1 memory files remain valid; old entries support exact matches, while newly generated entries also carry source text for fuzzy matching.
- Existing configs need no changes. Optional `stateFile`, `auditFile`, `fuzzyThreshold`, timeout, size, and security settings use safe defaults.
- Static provider configuration is unchanged.
- OpenAI-compatible configuration still uses `endpoint`, `model`, and `apiKeyEnv`; optional cost fields only affect audit estimates.
- A repeated `translation run` now skips a verified completed output instead of failing because it exists.
- Review is stricter: use `draft → review → approved → published`. Approval requires prior reviewer metadata, and publication requires prior approval metadata.
- Provider extensions should register a `TranslationProviderFactory`; do not add provider branches to the CLI.

Back up memory and translation outputs before enabling production automation. Run a dry-run, execute the static CI fixture, and inspect state/audit files before enabling remote credentials.
