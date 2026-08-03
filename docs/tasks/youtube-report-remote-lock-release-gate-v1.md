# YouTube Report Remote Lock-Release Gate v1

## Status

```text
MODE                              = REPOSITORY_ONLY_HARDENING
YOUTUBE_REMOTE_READ               = NOT_EXECUTED
META_REMOTE_LOCK                  = NOT_RELEASED
RETAINED_LOCK_EVIDENCE_REQUIRED   = true
CALLER_BOOLEAN_ACCEPTED           = false
REMOTE_WRITE_COUNT                = 0
QUEUE_ACTION_COUNT                = 0
WORKER_DEPLOYMENT_COUNT           = 0
SCHEDULE_ENABLED                  = false
PRODUCTION                        = BLOCKED
```

`docs/current-task.md` remains unchanged because the active Chatwoot workstream owns it.

## Purpose

The reviewed YouTube Report readiness terminal already required a clean exact `main` Head before invoking the internal read-only collector. The final Multichannel Live handoff also required `metaRemoteLock.released=true`.

The remaining gap was that the public read-only readiness terminal itself did not require retained Meta lock-release evidence before spawning the internal Remote collector. Operator discipline prevented execution while PR #421 owned Remote mutation, but the executable contract did not enforce that coordination boundary.

## Contract

Remote readiness now requires a private retained file through:

```text
MKT_YOUTUBE_REPORT_REMOTE_LOCK_RELEASE_EVIDENCE
```

The file must prove:

- contract `meta_remote_lock_release_audit_v1`;
- `released=true`;
- exact 40-character `auditHead`;
- clean retained repository state with `head=reviewedHead=auditHead`;
- all execution flags false;
- Preview URLs disabled;
- Schedule disabled;
- Production blocked;
- active Work, active Lock and uncertain Queue counts all zero;
- exact retained evidence SHA-256 and capture timestamp;
- recursive sanitized equality with no credentials or infrastructure identifiers.

A caller Boolean such as `MKT_META_REMOTE_LOCK_RELEASED=true` is ignored and cannot authorize Remote read.

## Execution order

```text
explicit collector confirmation
→ clean exact-main repository preflight
→ retained Meta Remote lock-release evidence preflight
→ internal SELECT-only YouTube collector
→ reviewed readiness assessment
→ private mode-0600 readiness evidence
```

Missing, unreadable, unsanitized, stale or unsafe lock evidence stops before the internal collector process is spawned.

## Files

```text
scripts/lib/youtube-report-remote-lock-release.js
scripts/youtube-report-remote-readiness-reviewed-terminal.mjs
tests/scripts/youtube-report-remote-lock-release.test.js
docs/tasks/youtube-report-remote-lock-release-gate-v1.md
```

## Safety

This repository hardening performs no Provider request, Remote D1 read/write, Remote Lark action, Queue action, Worker upload/deployment, Schedule change or Production action. The YouTube Remote readiness audit remains blocked until PR #421 produces exact retained release evidence.
