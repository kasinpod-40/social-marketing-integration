# Facebook Daily Scope Resume v2

## Incident

Controlled operation `facebook-dashboard-repair-20260809-v1` started after PR #604 and proved that removing publication-date filters entirely from a one-day Facebook observation is too broad.

Read-only live evidence while the exact operation was still active:

```text
source_stage             = content
source_complete          = 0
source_units             = 22
source_rows              = 2101
content_index            = 0
operation_observations   = 0
target_day_observations  = 0
active_locks             = 1
alerts                   = 0
```

The operation has not reached D1/Lark business phases. It must not be resent, replaced, replayed or lifecycle-mutated while active.

## Root cause

PR #604 correctly stopped treating a one-day observation as a one-day publication inventory, but implemented that correction as an unbounded Page `/posts` inventory. The durable source pipeline stages every returned Content ID before Content Insights. A Page with more than two thousand historical posts therefore consumes many Queue continuations and can fan out Content Insights far beyond the bounded Dashboard history requirement.

## Contract

- Reuse `META_BUSINESS_INGESTION_CONTRACT.history.dashboardLookbackDays` as the Facebook daily inventory discovery horizon.
- One-day Facebook observations discover Content only inside that bounded lookback and keep metric reads on the requested one-day metric boundary.
- Multi-day Facebook history keeps its explicit caller range.
- Existing in-progress one-day Facebook source work created by PR #604 is resumed under the same operation identity.
- Staged units from the superseded unbounded Content inventory remain immutable evidence but are excluded from the active Content/Insight source snapshot.
- No D1/Lark Business rows are deleted or fabricated.
- No Queue replacement or historical Facebook R2 replay.
- Instagram and Meta Ads behavior is unchanged.

## Durable resume design

The Organic source state gains additive fields:

```text
contentInventoryScope
contentInventoryStartSequence
```

For a fresh one-day Facebook operation, the marker is established when the Account stage enters Content inventory.

For an already-running pre-v2 one-day Facebook source operation still before D1, the next invocation migrates in memory to Content stage, clears only active Content cursor/ID progress, resets the scoped source watermark, and sets `contentInventoryStartSequence` to the current durable unit count. Existing source units are not deleted.

At Content-ID extraction and final source assembly, Facebook daily Content/Account-Insight/Content-Insight units before that marker are ignored. The original Account node remains valid and is retained.

## Acceptance

- Existing pre-v2 partial Content staging resumes the same operation from a bounded Facebook Content range.
- Old staged Content rows do not enter `contentIds`, `contentResources`, account insights or content insights.
- New one-day Facebook source uses the reviewed Dashboard lookback instead of unbounded inventory.
- Multi-day Facebook and all Instagram/Meta Ads paths are unchanged.
- Focused tests, full default gates and deploy dry-run pass before merge.
- Live deployment is followed by read-only exact-operation inspection before any report refresh.
- Production remains BLOCKED.
