# Current Task — Google Ads External Signed PREVIEW Closeout

## Authoritative status

```text
TASK_STATUS                  = PR_56_READY_FOR_MERGE
SOURCE_BASELINE              = PR_55_MERGED_4008B991
CLOSEOUT_PR                  = PR_56_OPEN
BRANCH_VERIFICATION          = PASS_RUN_457
PROVISIONING                 = PASS_CONFIRMED
EXTERNAL_MANAGER_SCRIPT      = PASS
TRANSPORT_RUN                = PREVIEW_VALIDATED
DATASETS                     = 6_OF_6
CHUNKS                       = 7_OF_7
ROWS                         = 1375_OF_1375
PAYLOAD_REDACTION            = PASS
BUSINESS_QUEUE_LARK_DRIFT    = ZERO
SIGNED_INGRESS               = DISABLED_404
PROVISIONING_ROUTE           = DISABLED_404
BUSINESS_WRITES              = DISABLED
SCRIPT_RUNTIME               = DRY_RUN_DELIVERY_FALSE
GOOGLE_ADS_SCRIPT            = CLEAN_ARTIFACT_RESTORED
SCHEDULE_LIVE_PRODUCTION     = DISABLED
NEXT_GATE                    = LOCAL_REFERENCE_ONLY_QUEUE_ADMISSION
```

The full prior task record is preserved verbatim at:

```text
docs/archive/current-task-before-google-ads-external-preview-closeout.md
```

## Objective

Close the separately approved provisioning and actual Manager Script Signed
PREVIEW runtime gates with sanitized documentation only. Confirm the final
safe-closed state and prepare PR `#56` for merge without changing executable
code, dependencies, migrations, runtime configuration or deployment state.

## Verified runtime result

```text
Provisioning confirmation   PASS
Manager Script execution    PASS
Transport status            preview_validated
Datasets                    6 / 6
Chunks                      7 / 7
Rows                        1375 / 1375
Payload redaction           PASS
Business/Queue/Lark drift   ZERO
Google Ads mutation         ZERO
Final transport route       disabled / 404
Final provisioning route    disabled / 404
Final Business writer       disabled
Final Script runtime        DRY_RUN / delivery false
Clean Script                restored
```

Sanitized rollout authority:

```text
docs/rollouts/google-ads-manager-script-external-signed-preview-2026-07-26.md
```

Ignored local evidence is referenced by directory name only. No capability,
credential, proof, raw payload or unredacted identity is stored in Git.

## Scope

In scope:

- current task closeout;
- sanitized rollout evidence;
- Project Brain / Current State / Next Actions updates;
- Changelog update;
- exact archival preservation of the previous Current Task and Changelog;
- documentation-only PR, changed-file review and Branch Verification.

Out of scope:

- executable source or dependency changes;
- migrations or deployments;
- runtime flag or credential changes;
- another external run;
- Queue admission or processing;
- Ads business facts, normalization, Shared RAW or Lark writes;
- schedules, LIVE or Production;
- Draft PR `#17` reuse or merge.

## Acceptance criteria

- [x] Runtime provisioning confirmation recorded without sensitive material.
- [x] Actual Manager Script Signed PREVIEW recorded as `preview_validated`.
- [x] Dataset, chunk and row reconciliation recorded exactly.
- [x] Payload redaction and zero Business/Queue/Lark drift recorded.
- [x] Final disabled routes and safe Script runtime recorded.
- [x] Previous Current Task and Changelog preserved verbatim under `docs/archive/`.
- [x] PR `#56` opened against `main`.
- [x] Changed-file allowlist contains exactly eight Markdown files.
- [x] Branch is ahead of the approved baseline and behind by zero commits.
- [x] Branch Verification run `#457` passed every step.
- [ ] Squash-merge PR `#56` after final review.

## PR changed-file allowlist

```text
CHANGELOG.md
PROJECT_BRAIN.md
docs/archive/CHANGELOG-before-google-ads-external-preview-closeout.md
docs/archive/current-task-before-google-ads-external-preview-closeout.md
docs/current-task.md
docs/project-brain/00-current-state.md
docs/project-brain/10-next-actions.md
docs/rollouts/google-ads-manager-script-external-signed-preview-2026-07-26.md
```

No executable, test, package, lockfile, migration or runtime configuration file
is present in the PR diff.

## Verification

GitHub Branch Verification run `#457` passed:

```text
Locked dependency install           PASS
Syntax / architecture / hygiene     PASS
Focused staged TikTok regression    PASS
Unit and Workers runtime tests      PASS
Report reliability regression       PASS
Dependency audit                    PASS
Wrangler dry run                    PASS
```

## Next approval gate

After this Closeout merges, open a new task for **Local reference-only Queue
admission**. The new task must start with a fresh full-codebase review and define
exact reference grain, idempotency, retry/DLQ, checkpoint, retention,
observability and reconciliation rules.

The following remain disabled until separately approved:

```text
Google Ads Connector activation
Business writer
D1 Ads business facts
Shared RAW writes
Lark writes
Schedules
LIVE delivery
Production
```

Draft PR `#17` remains Draft/HOLD and evidence-only.
