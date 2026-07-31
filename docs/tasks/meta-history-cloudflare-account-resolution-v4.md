# Meta History Cloudflare Account Resolution Recovery v4

## Incident

The fourth one-time Meta history Terminal attempt stopped at:

```text
stage  cloudflare-readiness
code   META_HISTORY_2026_COMMAND_FAILED
cause  npx wrangler whoami --json exited 1
```

Local repository gates and private safe-config generation had completed. The command had not started
Remote Worker/D1 inspection, fresh Meta identity validation, Queue admission, Provider reads, D1/Lark
Business writes or any of the six history operations. The restore child repeated the same unnecessary
`whoami` call. No Remote mutation path had started.

## Existing authority

```text
Account name              Social MKT Data Hub DEV
CLOUDFLARE_ACCOUNT_ID     stored locally in .dev.vars
Wrangler account_id       retained by source/generated config when present
CLOUDFLARE_API_TOKEN      stored locally in .dev.vars
```

The Account ID is non-secret routing identity. The API token is secret authentication. Neither requires a
successful Wrangler user-membership `whoami` command when both are already available.

## Shared Main authority

PR #343 merged the shared Queue bootstrap authentication-order correction before this Meta hotfix:

```text
explicit API token
→ no Wrangler authentication command
→ explicit Environment Account ID
→ otherwise config account_id
→ whoami only when Account ID is absent
→ exact Queue REST inventory
```

Meta v4 is rebased onto that Main and uses the same shared `resolveCloudflareAccountId()` and
`resolveCloudflareBearerAuth()` contracts. It does not introduce another Queue or authentication engine.

## Root cause

`resolveCloudflareContext()` executed `wrangler whoami --json` before calling the existing shared
`resolveCloudflareAccountId()` helper. The helper already gives precedence to:

1. explicit `CLOUDFLARE_ACCOUNT_ID`;
2. top-level Wrangler `account_id`;
3. parsed `whoami` memberships.

The Meta finalizer therefore defeated the shared precedence contract by eagerly running step 3 first.

## Correction

```text
read generated private config
→ attempt shared Account-ID resolution with whoamiOutput=null
→ explicit CLOUDFLARE_ACCOUNT_ID wins
→ otherwise config account_id wins
→ only unresolved membership falls back to wrangler whoami --json
→ use explicit CLOUDFLARE_API_TOKEN directly
→ only missing token falls back to wrangler auth token --json
→ discover exact Queue ID
→ continue existing Worker/D1 safe-state checks
```

Invalid explicit/config Account IDs remain fail-closed and must not silently fall back to another account.

## Regression contract

The focused public-launcher regression must prove:

- `whoamiOutput: null` static resolution appears before the only `wrangler whoami` invocation;
- the fallback is restricted to `WOOCOMMERCE_FINAL_WHOAMI_JSON_INVALID`;
- `CLOUDFLARE_ACCOUNT_ID` and generated config text are passed to the shared resolver;
- exactly one `whoami` invocation remains;
- no unconditional `const whoami = runText(...)` pattern exists.

Current Main also retains the shared functional Queue-bootstrap tests proving:

- explicit Account ID + API token execute zero Wrangler auth commands;
- config Account ID uses only bearer retrieval when needed;
- `whoami` remains only for genuine account discovery.

## Unchanged safety contracts

- no new Connector, Queue, Reliability, D1 writer or Lark engine;
- no Provider mutation path;
- no blind Queue resend;
- no historical Meta operation replay or replacement;
- no Business-fact deletion;
- D1 before same-operation Lark continuation;
- all-false restore after every activated window;
- zero active Work/Lock/Queue at final completion;
- Schedule disabled and Production blocked.

## Required verification

```text
npm ci
npm run check
focused Meta workstream tests
shared Queue bootstrap authentication-order tests
npm test
npm run test:report-reliability
npm audit --audit-level=high
npm run deploy:dry-run
Meta End-to-End Verification on exact Head
Branch Verification on exact Head
```

Repository implementation and CI perform zero Remote actions.

## Live boundary

Do not rerun the public Terminal command until this Hotfix is exact-head verified, reviewed, Squash Merged
and followed by an execution-ready documentation handoff.
