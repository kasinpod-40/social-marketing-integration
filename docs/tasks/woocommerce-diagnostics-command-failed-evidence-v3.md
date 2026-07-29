# WooCommerce Wrangler Command-Failed Evidence Hotfix v3

## Status

```text
TASK_STATUS                  = READY_FOR_CI
BASE_MAIN                    = 314f5f2e1786eb9b63f470e44e365d170817790d
BRANCH                       = hotfix/woocommerce-diagnostics-command-failed-evidence-v3
LATEST_LIVE_RESULT           = PREVIEW_UPLOAD_FAILED_BEFORE_VERSION_CREATE
PREVIEW_URLS_RESTORED        = TRUE
WORKERS_DEV_RESTORED_FALSE   = TRUE
PROVIDER_REQUEST             = 0
PREVIEW_VERSION_UPLOAD       = 0
PRODUCTION_DEPLOYMENT        = UNCHANGED
REMOTE_ACTION_DURING_IMPL    = NONE
```

## Problem

The reviewed Preview diagnostics operator captures Wrangler output in a temporary ND-JSON file, but throws immediately when `wrangler versions upload` exits non-zero. The file is removed before structured `command-failed` evidence can be surfaced, leaving only a stderr SHA-256.

## Correction

Add a separately confirmation-gated evidence launcher that delegates all Live behavior to the existing Preview URL window wrapper, observes only its ephemeral Wrangler output files while the child runs, keeps captured bytes in memory only, and returns bounded redacted `command-failed` evidence.

Redaction covers ANSI, bearer tokens, WooCommerce keys, Cloudflare account IDs, UUIDs, URLs, email addresses, absolute paths and anomalously long values.

## Safety

```text
Raw output persisted             false
Credential values printed        false
New remote actions               0
Production deployment path       none
Queue / D1 / Lark / Schedule     none
Secret mutation                  none
```

The existing Preview URL wrapper remains responsible for exact setting restoration in `finally`.

## Acceptance criteria

- structured `command-failed` code/message are parsed when exactly one record exists;
- missing structured output falls back to bounded sanitized text;
- raw stdout/stderr/ND-JSON are never returned or written;
- known secret and identity patterns are redacted;
- launcher delegates to the existing reviewed wrapper instead of duplicating Live logic;
- focused tests, full Repository tests, architecture, dependency audit and Wrangler dry-run pass;
- implementation performs zero Remote action;
- merge and a new Live evidence window require separate explicit authorization.

## Parallel-workstream boundary

This hotfix does not modify Dashboard runtime files or the merged work from PR #236/#237.
