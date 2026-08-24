# triage-events

Pure deterministic identity and lifecycle observation for MailScribe events.

The package derives indexed exact, thread, typed, and participant-qualified
subject keys. Subject text is never an identity on its own. Messages keep their
own identity; persistent event membership is handled by the Cloud service.
