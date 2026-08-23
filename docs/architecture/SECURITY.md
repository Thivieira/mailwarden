# Security architecture

Mailwarden's governing rule is: **AI determines meaning; code determines permission.**

## Current controls

### Tenant and user boundaries

- Stored mail, accounts, policies, drafts, approvals, credentials, and most intelligence records carry `tenant_id` and `user_id`.
- Provider factory and services constrain resource lookup to the authenticated principal.
- Tenant isolation, mailbox-ID guessing, MCP scopes, OAuth replay, prompt injection, approval binding, concurrency, and no-permanent-delete behavior have automated coverage.
- Tokens are verified for issuer/audience and backed by session or OAuth-token state.

The current principal contains exactly one active workspace. Its signed workspace ID is revalidated against live membership on token, OAuth refresh, provider callback, stream-ticket, and human-session use.

### Encryption and secrets

- Provider credentials use envelope AES-256-GCM.
- The encrypted data key is protected by a key derived from the configured master secret.
- Tenant/user identifiers are additional authenticated data, preventing ciphertext reuse under another context.
- Key version is stored with encrypted payloads.
- OAuth provider credentials, login secrets, and production secrets are not committed.

Do not change tenant/user identifiers used by encrypted rows without a tested re-encryption plan.

### Human confirmation and mailbox safety

- Send approval is bound to a hash of the exact reviewed payload.
- Approval is bound to a human session and provider sending is idempotent.
- Mailbox mutations are gated by `MAILBOX_MUTATIONS_ENABLED`; production currently reports `false`.
- Provider interfaces expose no permanent-delete operation.

### Audit

Authentication, authorization denial, policy actions, provider changes, approvals, sends, privacy actions, and connector registration write audit events. Audit data must contain identifiers and outcomes, never raw credentials, tokens, message bodies, or tunnel secrets.

## Current gaps

- The Proton gateway authenticates with one long-lived bearer key and trusts context headers after that check.
- Legacy Proton connector tokens remain per account alongside the new RelayDevice model.
- Per-device provisioning, heartbeat, rotation, and revocation are implemented on Cloud, but the gateway does not consume the per-device gateway secret yet.
- A signed/replay-resistant Cloud-to-gateway request assertion is still planned.
- Some Team intelligence/policy services remain creator-user scoped.

## Organization authorization

Authorization must resolve:

```text
authenticated user → selected workspace → membership → role → resource ownership
```

Reusable Cloud primitives should include user authentication, membership enforcement, and owner/admin checks. UI state never grants access. A tenant ID, mailbox ID, organization ID, or relay ID supplied by a client is only a lookup hint and must be checked against the resolved context.

Security tests should cover tenant spoofing, member/admin/owner boundaries, invite replay, mailbox guessing, cross-workspace MCP, seat/quota bypass, relay credential leakage, cross-tenant Proton relay use, and revoked devices.

## Planned Bridge/device controls

- short-lived browser/device provisioning authorization;
- renewable device credentials scoped to one organization/device;
- independent registration, rotation, revocation, and audit;
- signed or mutually authenticated Cloud-to-relay requests;
- native OS secret stores and a verified headless Linux alternative;
- redacted diagnostics bundles;
- tunnel credentials scoped to one tunnel, never Cloudflare account API tokens;
- heartbeat timestamps and replay/freshness validation.

## Logging rules

Never log:

- OAuth refresh/access tokens;
- Proton login or Bridge-generated passwords;
- gateway/device/tunnel bearer credentials;
- encryption keys or decrypted credential envelopes;
- authorization codes, session tokens, invite tokens, or provisioning tokens;
- raw message bodies unless a deliberate local diagnostic mode redacts them.

Error responses at trust boundaries should be actionable without exposing stack traces or secret-bearing upstream payloads.

## Incident invariants

- Lost relay device: revoke only that device and rotate its tunnel/device credentials.
- Leaked provider credentials: disconnect/rotate the mailbox without changing tenant identity.
- Leaked master encryption key: execute a versioned re-encryption plan; changing `KEY_VERSION` alone is not rotation.
- Suspected cross-tenant access: preserve audit evidence, disable affected credentials, and test exact resource/principal pairs before restoration.
