# Changelog

## Unreleased — Google Ads Secret provisioning and External Signed PREVIEW Closeout — 2026-07-26

### Runtime validation

- Completed one-time Google Ads Manager Script Signing Secret provisioning from
  the actual Manager account with a five-minute capability Ticket, exact runtime
  identity binding and HMAC confirmation.
- Confirmed the Ticket reached `confirmed`; the provisioning route was restored
  to disabled / `404` and temporary Ticket-bearing Helper/clipboard material was
  cleared.
- Ran the actual Google Ads Manager Script External Signed PREVIEW using
  `AdsApp`, `AdsManagerApp`, Google Ads API `v24`, canonical JSON, HMAC and
  `UrlFetchApp`.
- Reconciled all six datasets, seven chunks and 1,375 rows; the D1 transport Run
  reached `preview_validated` and every staged payload was redacted.
- Verified zero Ads Business fact, Queue, DLQ, alert and Lark drift and zero
  Google Ads mutation.

### Final safety state

- Restored Signed ingress and Secret provisioning routes to disabled / `404`.
- Kept Google Ads Connector and Business-write gates disabled.
- Restored Script Properties to `DRY_RUN` and delivery `false`, removed the
  temporary delivery endpoint property and restored the clean Repository Script.
- Kept Queue admission, Sync Worker Business processing, D1 Ads facts, Shared
  RAW/Lark writes, schedules, LIVE and Production outside this Closeout.
- Recorded sanitized evidence in
  `docs/rollouts/google-ads-manager-script-external-signed-preview-2026-07-26.md`.

### Documentation

- Updated Current Task, Project Brain, Current State and Next Actions for the
  completed safe-closed runtime gates.
- Preserved the full prior Current Task and Changelog records verbatim under
  `docs/archive/` before replacing the active files with current concise
  authorities.
- The next separately approved implementation boundary is Local reference-only
  Queue admission from completed authenticated transport references only.

## Historical changelog

The complete Changelog through `2026-07-25` is preserved verbatim at:

```text
docs/archive/CHANGELOG-before-google-ads-external-preview-closeout.md
```

That archive remains immutable historical evidence. New entries continue in
this active `CHANGELOG.md`.
