# Project Brain — Chatwoot Final Preflight Initialization Hotfix

## Decision

The Chatwoot Final UAT public command and operational sequence remain unchanged. The inner operator now stores the read-only preflight response in a result binding that does not shadow the `preflight()` function.

## Incident boundary

The execution passed local gates, Lark mapping and Queue REST identity discovery, then stopped at JavaScript initialization before the first inner Remote preflight call:

```text
Cannot access 'preflight' before initialization
safeRestore = NOT_REQUIRED
```

No temporary Active Worker deployment, Queue message, D1/Lark Business write or Chatwoot Provider request occurred. Production remained blocked.

## Root cause

The inner operator contained:

```js
const preflight = await preflight(target);
```

The local `const preflight` shadows the outer function declaration and remains uninitialized while its initializer is evaluated. JavaScript therefore throws a temporal-dead-zone `ReferenceError` before invoking the function.

## Correction

```text
preflight(target)
→ preflightResult
→ read-only-preflight evidence
→ D1 backup
→ temporary Active deployment
→ Safe-restore baseline from preflightResult.activeVersion
```

Only the result identifier changed. Preflight contents, Remote ordering, backup, deployment, Queue submission, D1/Lark parity and Safe restore contracts remain unchanged.

## Regression authority

A focused source regression requires:

- the `preflight(target)` function declaration;
- `const preflightResult = await preflight(target)`;
- no `const preflight = await preflight(target)` pattern;
- preflight evidence and Safe-restore baseline to use `preflightResult`;
- preflight → evidence → backup → deployment → Safe-restore ownership ordering.

## Final user action after merge

```bash
CONFIRM_CHATWOOT_FINAL_UAT=EXECUTE_CHATWOOT_30D_DAILY_UAT \
node scripts/chatwoot-final-30d-daily-uat-launcher.mjs --execute
```

## Safety state during implementation

```text
Remote Provider request       0
Remote D1 query/write         0
Remote Lark request/mutation  0
Queue/DLQ message             0
Worker deployment             0
Schedule/Webhook              disabled
Production                    blocked
```
