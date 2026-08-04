# Lark Notification Queue List REST Hotfix v1

Date: 2026-08-04

## Incident

The first controlled notification exact terminal stopped before Remote mutation at:

```text
stage = resolve-cloudflare-target
command = npx wrangler queues list --json
status = 1
```

The outer exact terminal independently read back and restored the exact source Report Settings false.
No Worker active deployment, Queue submission, notification send, Automation activation, Schedule activation,
or Production action started.

## Root cause

The operator depended on `wrangler queues list --json`. Current Wrangler Queue list exposes no JSON flag,
so the command exits before the existing exact Queue-name resolver receives an inventory.

## Correction

Use the documented read-only Cloudflare endpoint directly:

```text
GET /client/v4/accounts/{account_id}/queues
```

The existing authenticated Wrangler session still supplies the short-lived bearer token. The response is then
passed to the existing exact Queue-name resolver. No Queue ID is committed or emitted in public evidence.

## Verification

- exact REST URL and GET method;
- bearer authorization supplied only in request headers;
- exact existing Queue-name resolver remains authoritative;
- provider failure diagnostics expose status only;
- invalid account identity stops before request;
- operator focused gates include the new regression;
- full Repository gates and exact-head CI must pass before merge.

## Safety

```text
Implementation Remote action       0
Worker deployment                  0
Queue submission                   0
Lark Business write                0
Notification send                  0
Automation activation              0
Schedule activation                0
Production                         BLOCKED
```
