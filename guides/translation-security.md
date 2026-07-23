# Translation security

Treat every source document, provider response, glossary, memory import, and configuration file as untrusted.

- All config-managed files and outputs are confined to the project root.
- Remote endpoints require HTTPS.
- Source and response byte limits prevent unbounded payloads.
- Common private-key and API-token patterns are blocked before transmission.
- Document text is placed in an explicitly untrusted JSON payload; embedded instructions cannot change the system contract.
- Generated front matter is constructed locally. Provider text cannot inject lifecycle or provenance metadata.
- Structural QA detects removed links, identifiers, code, tables, lists, HTML, Unicode, and placeholders.
- Atomic output/checkpoint writes prevent partial JSON or Markdown.
- Audit errors are length-bounded and redact bearer/API-token patterns. Audit never records document content or credentials.
- Provider errors do not include response bodies.

Do not enable `allowSensitiveContent` for general corpora. If it is required, use a dedicated provider account, data-processing agreement, egress controls, encrypted storage, and a documented retention policy.

The local state file is a single-writer design. Multiple hosts must use an external durable queue and distributed lock. Validate imported memory before use and protect it as potentially sensitive intellectual property.
