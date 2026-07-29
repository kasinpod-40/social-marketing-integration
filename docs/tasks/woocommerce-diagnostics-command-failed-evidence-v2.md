# WooCommerce Wrangler Command-Failed Evidence Hotfix v2

## Status

```text
TASK_STATUS                  = READY_FOR_CI
BASE_MAIN                    = 00e128f6256ebb35108980376cfda1ee22934a06
BRANCH                       = hotfix/woocommerce-diagnostics-command-failed-evidence-v2
LATEST_LIVE_RESULT           = PREVIEW_UPLOAD_FAILED_BEFORE_VERSION_CREATE
PREVIEW_URLS_RESTORED        = TRUE
WORKERS_DEV_RESTORED_FALSE   = TRUE
PROVIDER_REQUEST             = 0
PREVIEW_VERSION_UPLOAD       = 0
PRODUCTION_DEPLOYMENT        = UNCHANGED
REMOTE_ACTION_DURING_IMPL    = NONE
```

## Problem

The reviewed Preview diagnostics operator captures Wrangler output in a temporary ND-JSON file, but `runText()` throws immediately when `wrangler versions upload` exits non-zero. The temporary output file is then removed before the operator can read the structured `command-failed` record. Only a stderr SHA-256 remains, which is insufficient to identify the Cloudflare API error.

Cloudflare documents `command-failed` as the structured output record for failed Wrangler commands.

## Correction

Add a separately confirmation-gated evidence launcher that:

1. delegates all Live behavior to the existing reviewed Preview URL window wrapper;
2. observes only the existing ephemeral Wrangler output files while the child process runs;
3. keeps captured bytes in memory only and never persists raw output;
4. parses only bounded `command-failed` evidence;
5. redacts ANSI, bearer tokens, WooCommerce keys, account IDs, UUIDs, URLs, email addresses, absolute paths and anomalously long values;
6. returns record count, code, redacted message and SHA-256 fingerprints;
7. adds no Cloudflare, Provider, Queue, D1, Lark, Schedule, Secret or Production action.

## Safety

```text
Raw output persisted             false
Credential values printed        false
New remote actions               0
Production deployment path       none
Queue / D1 / Lark / Schedule     none
Secret mutation                  none
```

The existing Preview URL wrapper remains responsible for exact `false/false → false/true → false/false` setting transitions and restoration in `finally`.

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

This hotfix intentionally does not modify `docs/current-task.md`, `PROJECT_BRAIN.md`, `CHANGELOG.md`, Dashboard runtime files or PR #237 because those files are active in the stacked Lark Dashboard workstream.
