# triage-features

Pure, replayable L2 extraction for MailScribe inbox intelligence.

```ts
extractFeatures(message, now)
```

The package describes locally evidenced mailbox facts. It has no database,
network, model, user-context, classification, policy, priority, or global-clock
dependency. Every parsed semantic fact includes its source evidence; deterministic
parsers report ambiguity directly rather than inventing confidence scores.

If two users can reasonably disagree about a field because their circumstances
differ, that field does not belong here.
