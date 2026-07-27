# YouTube Organic End-to-End Integration Review

## Decision

```text
REVIEW_SCOPE                 = DRAFT_PR_72
REPOSITORY                   = kasinpod-40/social-marketing-integration
BRANCH                       = agent/youtube-organic-end-to-end
REVIEWED_MAIN_SHA            = 8b7f9a879ba0c1b0b5d89dcfa2373ad3bb3c2ce8
ALIGNED_CODE_HEAD_SHA        = 6d729dd97984f8b8758901560241ec44e48eac62
DECISION                     = PASS_FOR_INTEGRATION
PR_STATE                     = DRAFT / DO_NOT_MERGE_YET
REMOTE_OR_LIVE_ACTION        = NONE
```

The Integration Review found correctness and scalability defects in the original Draft head. The defects were corrected on the same Workstream branch, regression tests were added, current `main` was merged into the feature branch through alignment PR #81, and Branch Verification passed on the aligned code head.

## Findings corrected during review

1. **D1 Content reads above the shared 1,000-key limit**
   - The original implementation passed all Content keys to the shared Organic history gateway in one operation.
   - Content history planning/writes and unavailable-state reads now use deterministic 500-row batches.
   - Lock-active checks run between long D1 batches.

2. **Completed Account Coverage could be downgraded during a retry**
   - Account Coverage now reads and validates a completed durable Coverage record before any partial write.
   - A retry that fails after a prior completed generation cannot overwrite that completed evidence with `partial`.

3. **Completed Content Coverage could be downgraded during a retry**
   - Content Coverage failure persistence is skipped when `beginCoverage` identifies a completed replay.
   - Stable Coverage identity and source watermark are still validated fail-closed.

4. **Report status could be falsely complete for missing-only entities**
   - Every non-`observed` Coverage entity now contributes to uncovered Content evidence.
   - Expected Coverage entity cardinality must match the stored entity evidence before `complete` is returned.

5. **Report status ignored Account Coverage**
   - Overall YouTube report status now requires both Content Coverage and Account Coverage to be complete and reconciled.

6. **Report facts could be selected from incomplete Coverage generations**
   - Content observations and Account daily facts now join `data_coverage_runs`.
   - Queries admit only the correct dataset with `status='complete'` and `failed_rows=0`.

7. **Dry-run and D1-first gates conflicted**
   - Business-write gates apply only to non-dry execution.
   - Dry-run remains read-only while non-dry Lark delivery still requires D1-first storage.

8. **Cumulative metric date could differ from the durable observation generation**
   - `metricDate` must equal the durable `requestedAt` date in the configured source timezone.
   - Mismatched jobs fail permanently with `YOUTUBE_METRIC_DATE_GENERATION_MISMATCH` before Source or Business writes.

9. **Hidden subscriber evidence**
   - `subscriber_count_hidden=true` always persists `followers=null`, including large-batch and retry paths.

## Regression coverage added

- 1,001 Content records complete D1-first storage without exceeding the shared gateway key limit.
- Content state reads are bounded to 500 keys per batch.
- Completed Content Coverage is not downgraded after a failed retry.
- Completed Account Coverage is not downgraded after a failed retry.
- Hidden subscriber count remains `null`.
- A durable generation/metric-date mismatch fails before orchestration.
- Missing-only Coverage entities force report status to `partial`.
- Partial Account Coverage prevents an overall `complete` result.
- Historical report queries require completed Coverage evidence.
- Existing observed-zero, correction, baseline, null, and more-than-800-Content behavior remains covered.

## Main alignment

The feature branch was initially three commits behind `main`. Integration Review created alignment PR #81 with:

```text
head = main
base = agent/youtube-organic-end-to-end
```

PR #81 was merged into the feature branch only. It did not merge Draft PR #72 into `main`.

After alignment:

```text
merge_base = 8b7f9a879ba0c1b0b5d89dcfa2373ad3bb3c2ce8
ahead_by  = 27
behind_by = 0
```

The Draft PR remained add-only relative to current `main`, with no reserved Integration file modified by the YouTube Workstream.

## Verification evidence

Aligned code head verification:

```text
Branch Verification run       = #572
Workflow run ID               = 30233164495
Head SHA                      = 6d729dd97984f8b8758901560241ec44e48eac62
Conclusion                    = SUCCESS
Syntax/architecture/hygiene   = PASS
Focused staged TikTok         = 4/4 PASS
Unit tests                    = 912/912 PASS
Workers runtime tests         = 9/9 PASS
Report reliability            = 91/91 PASS
Dependency audit              = 0 vulnerabilities
Wrangler dry-run              = PASS
```

A prior review run correctly failed because the legacy greater-than-800-Content test fixture did not include Account Coverage after the report contract was hardened. The fixture was corrected to represent valid complete evidence; the aligned verification then passed all gates.

## Contract review result

Confirmed:

- Existing YouTube API client, raw adapters, normalizers, sync use case, Shared Google OAuth Core, TableSyncEngine, Organic history writer, D1 gateways/stores, reliability runner, lock, warning outbox, retry and DLQ contracts are reused.
- No duplicate Connector, Reliability engine, Queue framework, D1 writer or Lark synchronization engine was introduced.
- Channel and OAuth owner identity validation remain exact.
- Upload playlist, video and Analytics pagination remain bounded with repeated-token protection.
- `videos.list(id=...)` does not send `maxResults`.
- `quotaExceeded` remains permanent and nonretryable.
- Content, Observation, Account daily and Coverage identities remain stable across retries.
- Missing/private/deleted evidence is non-destructive and never zero-fills prior facts.
- YouTube Analytics period facts remain in `RAW_YouTube_Analytics_Daily`; no unapproved D1 period-fact migration was introduced.
- D1 completes before the first Existing TableSyncEngine Lark plan.
- Dedicated YouTube End-to-End routing remains unwired from the shared Worker entrypoint.
- Dedicated and shared execution gates remain default-false rollout requirements.

## Actions explicitly not performed

```text
Draft PR #72 merge into main        NOT RUN
Worker deployment                   NOT RUN
Remote D1 migration                 NOT RUN
Remote D1 Business write            NOT RUN
Remote Lark mutation                NONE
Queue message                       NOT SENT
DLQ redrive/delete                  NOT RUN
Cron/Schedule enablement            NONE
Cloudflare configuration change     NONE
Google Cloud configuration change   NONE
OAuth secret/token change           NONE
Production credential use           NONE
Customer/Production LIVE UAT        NOT RUN
```

## Integration handoff

`PASS_FOR_INTEGRATION` authorizes only the next repository integration step. It does not authorize deployment or LIVE activity.

The next Integration-owned task must separately review and implement:

1. shared Worker router wiring for `processYouTubeOrganicEndToEndJob`;
2. shared configuration/examples/Wrangler entries with all new flags default `false`;
3. Remote Storage Foundation `0009` readiness verification;
4. flags-false safe deployment;
5. DEV dry-run and blocked-write validation;
6. separately approved controlled DEV UAT;
7. D1 report shadow parity before primary cutover;
8. continued Schedule and Production UAT blocking until explicit approval.
