# Changelog

All notable changes to this project are documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] - 2026-08-16

First public release of Mailwarden: an AI-native email operating layer and MCP boundary.

### Added

- Multi-tenant identity, sessions, scopes, and structured audit events
- Envelope encryption (AES-256-GCM) for provider credentials
- Gmail, Microsoft 365, Proton Bridge, and mock provider adapters
- Deterministic attention queue, classification signals, and user-correction overrides
- Drafts, signatures, SHA-256 send-approval hashing, and idempotent sending
- MCP server (stdio and SSE) plus Elysia HTTP API on Cloudflare Workers / D1
- Privacy controls: disconnect, credential wipe, memory deletion, data export
- Dry-run mailbox mutations (`MAILBOX_MUTATIONS_ENABLED=false` by default)

[1.0.0]: https://github.com/Thivieira/mailwarden/releases/tag/v1.0.0
