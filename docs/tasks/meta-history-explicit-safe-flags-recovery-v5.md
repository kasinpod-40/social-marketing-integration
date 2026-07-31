# Meta History Explicit Safe Flags Recovery v5

## Incident

The fifth one-time Meta history Terminal attempt stopped during `fresh-read-only-validation` with:

```text
META_READ_ONLY_VALIDATION_UNSAFE_FLAGS
MKT_CONNECTOR_META_ADS_ENABLED
```

The read-only phase had performed zero Business writes and zero Queue sends. It stopped before Provider
validation and before any of the six current history operations. The outer closeout verified Remote Worker
flags all false.

## Root cause

The public Terminal forwarded raw `process.env` to the guarded child. The finalizer merged `.dev.vars` and
process environment, then changed only existing `MKT_*_ENABLED` keys to `false`.

When a reviewed Safe flag was absent from both sources, it remained `undefined`. The read-only operator
correctly rejected that value because its contract requires every reviewed execution flag to be explicit
`false`.

This was an environment materialization defect. It was not evidence that Meta Ads was enabled.

## Decision

The public Terminal must create the exact Safe child environment before spawning any implementation child.
It reuses `META_D1_ONLY_REQUIRED_FALSE_FLAGS`, the Shared superset already used by Meta D1 config safety.

```text
caller environment
→ copy
→ every existing MKT_*_ENABLED=false
→ every Shared required-false flag=false
→ freeze
→ guarded child
```

## Safety properties

- The caller environment object is not mutated.
- Non-flag environment values, credentials and exact confirmations are preserved.
- Every existing `MKT_*_ENABLED` key is closed, including future keys not yet in the Shared list.
- Every Shared required-false key exists explicitly as string `false`, including keys absent from
  `.dev.vars`.
- Raw `process.env` is never supplied directly to the guarded child.
- No connector, write, Schedule or Production path is enabled by this change.
- Active D1/Lark flag windows remain controlled by the existing private config operators.

## Regression contract

Tests must prove:

1. missing `MKT_CONNECTOR_META_ADS_ENABLED` becomes `false`;
2. every `META_D1_ONLY_REQUIRED_FALSE_FLAGS` entry becomes `false`;
3. existing true flags become `false`;
4. unknown future `MKT_*_ENABLED` keys become `false`;
5. non-flag values are preserved;
6. the input object is unchanged;
7. the output is frozen;
8. the Terminal child uses the materialized environment and not raw `process.env`.

## Required verification

```text
npm ci
npm run check
node --test tests/application/meta-history-2026-terminal.test.js
node --test tests/application/meta-history-2026-public-launcher.test.js
focused Meta workstream tests
npm test
npm run test:report-reliability
npm audit --audit-level=high
npm run deploy:dry-run
Meta End-to-End Verification
Branch Verification
```

Repository implementation and CI perform no Remote action.

## Live boundary

Do not rerun the Terminal until the Hotfix passes exact-head verification, is reviewed and Squash Merged,
and a docs-only handoff records the final merged Main SHA.
