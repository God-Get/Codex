# Translation deployment and troubleshooting

## Deployment checklist

1. Use Node.js 22 or newer and run `npm.cmd test`, `npm.cmd run check`, and `npm.cmd run doctor`.
2. Store the provider credential in the environment variable named by `apiKeyEnv`; do not put its value in JSON, source control, or command arguments.
3. Place memory, state, audit, and output paths inside the project root on durable storage.
4. Size `concurrency`, `requestsPerMinute`, `itemTimeoutMs`, `maxSourceBytes`, and provider response limits for the service quota.
5. Back up translation memory and audit JSONL. Permit only one writer for a project state file.
6. Run `translation run --dry-run --json`, then a small static/provider canary before a large corpus.
7. Monitor failed audit events, retry counts, rate-limit frequency, latency, token usage, and estimated cost.

For CI, use `StaticTranslationProvider`; builds must not depend on credentials or external networks. Production services should terminate cleanly so the runner's abort signal reaches active provider requests.

## Troubleshooting

- `CODEX_TRANSLATION_PROVIDER_RATE_LIMITED`: reduce concurrency/RPM or increase quota. CODEX honors `Retry-After`.
- `CODEX_TRANSLATION_PROVIDER_TIMEOUT`: verify upstream latency and raise per-request or per-item timeout only within operational limits.
- `CODEX_TRANSLATION_PROVIDER_NETWORK` or `..._SERVER`: check DNS, TLS, proxy, and provider health. These errors are retried automatically.
- `CODEX_TRANSLATION_PROVIDER_AUTH`: rotate/repair the environment credential; it is a permanent error.
- `CODEX_TRANSLATION_PROVIDER_INVALID_RESPONSE` or `..._EMPTY_RESPONSE`: verify endpoint and chat-completions compatibility.
- `CODEX_TRANSLATION_STATE_INVALID`: inspect the checkpoint and output checksum. Use `--force` only after confirming the intended target.
- `CODEX_TRANSLATION_SECRET_DETECTED`: remove/redact the credential-like content or explicitly accept the risk with project configuration.
- `CODEX_TRANSLATION_QA_*`: repair the provider output or glossary; do not bypass publication review.

Recovery is idempotent: rerun the same command. Verified completed items are skipped, failed/running items resume, and exact memory avoids duplicate provider requests.
