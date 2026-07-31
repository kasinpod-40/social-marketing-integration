# Meta History Pinned Continuity Recovery v3

## Incident

The third one-time Meta history Terminal attempt stopped at
`resume-pinned-meta-finalizer` with `META_HISTORY_2026_PINNED_FILES_MISSING`.

The command had already passed local gates, safe-config generation and Cloudflare read-only readiness. It
had not started fresh Meta identity validation or any of the six current history operations. The Worker
remained all-false and the outer wrapper verified that state.

```text
Meta Queue messages              0
Meta Provider requests           0
Remote D1 Business writes        0
Remote Lark Business writes      0
Worker deployments               0
Schedule mutations               0
Production                       blocked
```

## Root cause

The finalizer required a historical local clone, session, overlay and finalizer. Those files belonged to a
previous execution Head and were never durable Business-data authority. The requirement conflated two
different duties:

1. preserving the completed historical operation from replay or replacement;
2. running a new deterministic Facebook July history operation.

Duty 1 does not require the old local files. It requires an explicit current no-replay contract and current
source identity proof. Duty 2 already has independent D1/Lark parity and idempotency evidence.

## Decision

Replace local-file pinning with Head-bound continuity evidence:

```text
fresh Facebook identity validation
→ exact six-operation plan validation
→ prove old operation is absent from the current plan
→ prove one deterministic Facebook July operation
→ write private pinned-facebook-continuity.json
→ run current D1/Lark history chain
```

The old local clone/session bundle is not recreated, searched or executed.

## Continuity evidence

`pinned-facebook-continuity.json` must contain and validate:

```text
contractVersion                 meta_history_2026_pinned_continuity_v1
repositoryHead                  exact current merged main
pinnedVerified                  true
verificationMode                fresh_facebook_identity_and_exact_no_replay_plan
freshFacebookIdentityValidated  true
existingOperationReplay         false
replacementOperation            false
legacyLocalArtifactsRequired    false
legacyRepositoryHead            retained historical Head
legacyOperationIdFingerprint    SHA-256 only
supplementalOperationId         deterministic Facebook July operation
periodStart / periodEnd         2026-07-01 / 2026-07-31
readOnlyEvidenceFingerprint     SHA-256 of accepted no-mutation identity evidence
```

The legacy operation identity itself must not appear in the current operation plan.

## Fresh identity gate

The current read-only Meta Summary must prove:

```text
phase                  summary
status                 passed
contractVersion        meta_read_only_validation_v1
mutationPerformed      false
businessWrites         0
queueMessages          0
validationCount        4
```

The four validations must match exactly and in order:

- Facebook Organic;
- Instagram Organic;
- Meta Ads `chemistry_k2`;
- Meta Ads `chemistry_k3`.

Every entry must have `status=identity_validated` and at least one request attempt. These are GET-only
Provider validations and perform no Queue, D1 or Lark write.

## Current history operations

The current plan must exactly match all six target/range/mode/deterministic-operation-ID tuples:

```text
1. Facebook      2026-07-01..2026-07-31 required
2. Instagram     2026-07-01..2026-07-31 required
3. chemistry_k2  2026-05-01..2026-07-31 required
4. chemistry_k3  2026-05-01..2026-07-31 required
5. chemistry_k2  2026-01-01..2026-04-30 conditional
6. chemistry_k3  2026-01-01..2026-04-30 conditional
```

Operation IDs remain deterministic from Repository Head, target and date range. Stable Business keys
preserve pre-existing Facebook/Lark facts through idempotent upsert/skip behavior.

## Lark summary correction

The shared Meta Lark operator emits:

```text
larkParityVerified
idempotentRerunVerified
restoredAllFalse
```

The history finalizer must read `larkParityVerified`. The stale alias `larkVerified` must not be treated as
completion evidence. This prevents a false final-summary failure after a successful Lark operation.

## Main alignment

The Hotfix is based directly on `main@9d79e45676600831e1cc2fd7ca358a3176c55295`, retaining unchanged the
concurrent Lark Dashboard scope/full-block recovery and Chatwoot Queue topology normalization
implementations. A previous Meta workflow failed at `git diff` because Main advanced during a shallow
fetch and no merge base was available; it was not a source or test failure.

## Safety

- Reuse the existing Meta read-only, D1-only and Lark parity operators.
- Never replay or reconstruct the historical local finalizer.
- Never delete or replace existing Business facts.
- Block blind Queue resend when an attempt file exists without accepted evidence.
- Restore all Worker execution flags false after every activated D1 or Lark window.
- Require zero active Work, Lock and Queue-linked active operation at completion.
- Keep Schedule disabled and Production blocked.
- Repository implementation and CI perform no Remote action.

## Required tests

```text
plan contains legacyLocalArtifactsRequired=false
fresh Facebook identity creates valid continuity evidence
invalid read-only envelope fails closed
missing Facebook identity fails closed
any six-operation plan drift fails closed
legacy operation ID in current plan fails closed
canonical larkParityVerified is accepted
stale larkVerified alias is rejected
public finalizer contains no MKT_META_FINALIZE_* dependency
public finalizer contains no resolve/resume legacy function
focused Meta finalizer tests
Meta End-to-End Verification
Branch Verification
npm run check
npm test
npm run test:report-reliability
npm audit --audit-level=high
npm run deploy:dry-run
```

## Live boundary

Do not rerun the public Terminal command until this Hotfix passes exact-head Meta and Branch verification,
is reviewed and Squash Merged, and the docs-only handoff records the final merged main SHA.
