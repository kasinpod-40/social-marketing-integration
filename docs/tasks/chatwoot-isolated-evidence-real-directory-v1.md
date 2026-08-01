# Chatwoot Isolated Evidence Real Directory v1

## Incident

The selected-evidence handoff resolved the two-candidate ambiguity, but the delegated Initial recovery launcher reported:

```text
CHATWOOT_INITIAL_FAILURE_SESSION_MISSING
No retained candidate can be inspected
```

The arbitration wrapper had placed the selected retained evidence in the isolated clone as a directory symlink. The
recovery launcher enumerates `outputs/chatwoot-final-30d-daily-uat` using `readdir(..., { withFileTypes: true })` and
admits only `Dirent.isDirectory()`. A symlink to a directory therefore remained invisible before any session JSON or
Remote D1 boundary was inspected.

The safe-baseline parent restored all execution flags false. Provider, Queue, Remote D1, Remote Lark and incident
closure actions were zero.

## Correction

Materialize the already-selected retained evidence as a private real directory copy inside the temporary isolated
clone. The source retained evidence remains unchanged. The current-head writable evidence path remains linked to the
authoritative workspace, and the existing Initial recovery launcher remains unchanged.

## Safety

- The source evidence directory must be a real directory, not a symlink.
- The destination must not already exist.
- The materialized destination must be visible as `Dirent.isDirectory()`.
- The four required evidence files must be copied as regular non-symlink files.
- No candidate selection, Worker promotion, Queue, D1, Lark or incident-closure authority is added.
- The temporary clone is still removed on exit.
- Schedule and Webhook remain disabled; Production remains blocked.

## Required verification

- real-filesystem regression reproducing the child `Dirent.isDirectory()` admission rule;
- focused Chatwoot arbitration, safe-baseline and Initial recovery tests;
- focused Meta, WooCommerce and TikTok regressions;
- full Unit/Workers tests, report reliability, audit and Wrangler dry-run.
