# Weekly 7D Notification Bangkok Date Normalization v1

## Incident

The successfully delivered Full-channel Weekly 7D Notification rendered `2026-07-24` through `2026-07-30`, while the approved Shared Report / AI authority and read-only preview were `2026-07-25` through `2026-07-31`. Business metrics and AI content were otherwise the same.

## Root cause

`packages/connectors/src/lark/lark-notification-delivery-source.js` normalized numeric Lark Date values with `new Date(epoch).toISOString().slice(0, 10)`. Lark Date epoch values represent the Integration Workspace business date at Asia/Bangkok midnight. Converting those epochs to UTC date-only moves the calendar date backward by one day.

Example:

```text
Lark business date     2026-07-25 00:00 Asia/Bangkok
Epoch                   1784912400000
UTC instant             2026-07-24 17:00Z
Old UTC date-only       2026-07-24   WRONG
Expected business date  2026-07-25
```

## Correction

Normalize numeric Lark Date values to `YYYY-MM-DD` in `Asia/Bangkok` using `Intl.DateTimeFormat(...).formatToParts()`. Existing explicit `YYYY-MM-DD` strings remain unchanged.

This correction is at the Lark notification delivery source boundary only. It does not modify Shared Report materialization, AI synthesis, Notification identities, D1 delivery history, or the already-sent message.

## Regression

Add a connector regression using Bangkok-midnight epochs and require the loaded Notification request to preserve the business dates exactly instead of the previous UTC day.

## Safety

- Resend of the completed Notification identity: forbidden.
- AI synthesis rerun: forbidden.
- Report rematerialization: none.
- Remote Lark/D1/Queue mutation: none during implementation.
- Worker deployment: none during implementation.
- Automatic Notification producer: unchanged / false.
- Schedule activation: 0.
- Production: BLOCKED.
