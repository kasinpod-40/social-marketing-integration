# YouTube Live Remote Contract Parser Hotfix

## Status

```text
PROGRAM                      = YOUTUBE_LIVE_REMOTE_CONTRACT_PARSER_HOTFIX
BASE_MAIN_SHA                = 7f06ae8729dd24c3bd6f548332bfe17ba374c8ab
BRANCH                       = hotfix/youtube-live-remote-contract-parser
REMOTE_EXECUTION_AUTHORIZED  = false
REMOTE_ACTIONS               = NONE
```

## Problem statement

A read-only live Cloudflare preflight exposed two response-shape differences from the reviewed test
fixtures:

1. `wrangler queues consumer list <queue> --json` omitted Queue name inside the returned consumer,
   even though the command itself was scoped to the exact Queue.
2. Worker version metadata retained the immutable D1 database UUID but omitted the human-readable
   database name.

The existing validator stopped fail-closed with `remoteQueueName is required`. No Remote mutation,
Provider call or Queue action occurred.

## Design

The Hotfix adds a compatibility adapter in front of the existing reviewed validator.

### Queue identity

The adapter requires an explicit `expectedQueueName` for every response. When the response omits its
name, the adapter supplies the command-context name. When the response includes a name, it must match
the context exactly. Main Queue and DLQ are normalized in distinct contexts and are never inferred
from order, retry values or DLQ settings.

### D1 identity

The adapter requires exactly one reviewed D1 binding and an immutable database UUID. The UUID must
match the reviewed local config. A missing display name is restored only after that check. An explicit
name mismatch, missing UUID or UUID mismatch fails closed.

### Existing validator remains authoritative

After compatibility normalization, the adapter delegates to
`validateRemoteYouTubeDeploymentContract`, which remains responsible for:

- Worker version and deployment traffic;
- bindings and plain feature flags;
- Secret names without values;
- Queue consumer settings;
- Cron, routes and workers.dev;
- deterministic Remote fingerprint comparison.

## Local validator CLI

```bash
npm run validate:youtube-live-remote-contract
```

This command is plan-only and prints the required input contract. Execution requires both:

```bash
export CONFIRM_YOUTUBE_LIVE_REMOTE_CONTRACT=VALIDATE_YOUTUBE_LIVE_REMOTE_CONTRACT
npm run validate:youtube-live-remote-contract:run -- \
  --input=outputs/youtube-dry-run-rollout/sanitized-live-contract.json
unset CONFIRM_YOUTUBE_LIVE_REMOTE_CONTRACT
```

The input must contain reviewed safe/active config paths and sanitized raw JSON from the read-only
Cloudflare/Wrangler commands. The CLI performs no Remote command and reports only version, traffic,
fingerprints and counts.

## Acceptance criteria

- Missing Queue name passes only with an exact explicit command context.
- Explicit Queue mismatch fails with a stable sanitized code.
- Missing D1 display name passes only after immutable UUID match.
- Missing/mismatched D1 UUID and explicit D1-name drift fail.
- Main Queue and DLQ remain distinct.
- Resulting Remote fingerprint equals the existing reviewed local fingerprint.
- No raw Secret value is accepted or emitted.
- Existing YouTube and cross-Connector regressions remain unchanged.
- No Remote action occurs during implementation or CI.

## Remote boundary

This Repository implementation does not authorize or perform Worker deployment, Remote D1 access,
Queue/DLQ action, Provider/Lark/OAuth/Analytics request, trigger mutation or Production action. A new
Remote read-only preflight requires separate authorization after merge.
