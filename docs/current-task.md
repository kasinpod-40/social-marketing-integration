# Current Task — Google Ads External Signed PREVIEW Closeout

## Authoritative status

```text
TASK_STATUS                    = DOCUMENTATION_CLOSEOUT_READY_FOR_REVIEW
CURRENT_PROGRAM                = GOOGLE_ADS_MANAGER_SCRIPT_SIGNED_DELIVERY
SOURCE_BASELINE                = PR_55_MERGED_4008B991
SECRET_PROVISIONING            = PASS_CONFIRMED
EXTERNAL_MANAGER_SCRIPT        = PASS
TRANSPORT_RUN                  = PREVIEW_VALIDATED
DATASETS                       = 6_OF_6
CHUNKS                         = 7_OF_7
ROWS                           = 1375_OF_1375
PAYLOAD_REDACTION              = PASS
BUSINESS_QUEUE_LARK_DRIFT      = ZERO
SIGNED_INGRESS                 = DISABLED_404
SECRET_PROVISIONING_ROUTE      = DISABLED_404
BUSINESS_WRITES                = DISABLED
SCRIPT_PROPERTIES              = DRY_RUN_DELIVERY_FALSE
GOOGLE_ADS_SCRIPT              = CLEAN_REPOSITORY_ARTIFACT_RESTORED
SCHEDULE_LIVE_PRODUCTION       = DISABLED
NEXT_IMPLEMENTATION_GATE       = LOCAL_REFERENCE_ONLY_QUEUE_ADMISSION
CUSTOMER_OAUTH                 = AWAITING_CUSTOMER_CALLBACK_IN_PARALLEL
```

The full prior `docs/current-task.md` record is preserved without modification at:

```text
docs/archive/current-task-before-google-ads-external-preview-closeout.md
```

That archive remains historical evidence only. This file is the current task
authority.

## Objective

Record the sanitized closeout for the separately approved one-time Signing
Secret provisioning and actual Google Ads Manager Script External Signed
PREVIEW. Confirm the runtime is safe-closed and prepare a documentation-only PR
without Source, dependency, migration, configuration, Secret or deployment
changes.

## Runtime result being closed out

### One-time Signing Secret provisioning

- Additive Migration `0014_google_ads_signing_secret_provisioning.sql` was applied
  to the Integration Workspace.
- Provisioning was enabled only for a bounded operator window.
- One five-minute capability Ticket was redeemed and HMAC-confirmed from the
  actual Google Ads Manager Script.
- D1 stores fingerprints and non-secret binding only.
- Script Properties received only `MKT_GOOGLE_ADS_SIGNING_KEY_ID` and
  `MKT_GOOGLE_ADS_SIGNING_SECRET`.
- Ticket status reached `confirmed`.
- Provisioning was restored to disabled and the route returned `404`.
- Temporary Helper, Ticket-bearing local files and clipboard content were
  cleared.

Sanitized ignored evidence:

```text
outputs/google-ads-provisioning-only-v3-20260725T174852Z
```

### Actual External Signed PREVIEW

The actual Manager Script used `AdsApp`, `AdsManagerApp`, bounded GAQL,
canonical JSON, HMAC and `UrlFetchApp` against the deployed PREVIEW-only ingress.

```text
Run status                preview_validated
Datasets                  6 / 6
Chunks                    7 / 7
Rows                      1375 / 1375
Payload redaction         PASS / all staged payloads redacted
Business fact drift       ZERO
Queue / DLQ / alert drift ZERO
Lark writes               0
Google Ads mutations      0
```

The reconciled datasets were:

1. `account`
2. `campaigns`
3. `adGroups`
4. `ads`
5. `youtubeAssets`
6. `campaignDailyMetrics`

Sanitized ignored evidence:

```text
outputs/google-ads-external-signed-preview-20260725T182311Z
```

## Final safe state

```text
GET /health                                           200
POST /v1/google-ads/manager-script/deliveries         404
POST /v1/google-ads/manager-script/signing-secret/*   404
MKT_CONNECTOR_GOOGLE_ADS_ENABLED                      false
MKT_GOOGLE_ADS_SIGNED_INGRESS_ENABLED                 false
MKT_GOOGLE_ADS_SECRET_PROVISIONING_ENABLED            false
MKT_GOOGLE_ADS_BUSINESS_WRITE_ENABLED                 false
Google Ads Script mode                               DRY_RUN
Google Ads delivery                                  false
Google Ads temporary endpoint property               removed
Google Ads clean Script                              restored
```

Signing material remains only in the approved Secret boundaries. No Ticket,
Secret, challenge, proof, raw payload or unredacted customer identity is stored
in Git, rollout documentation or operational summaries.

## In scope

- add one sanitized rollout closeout document;
- update Current Task, Project Brain, Current State, Next Actions and CHANGELOG;
- preserve the previous Current Task record in `docs/archive/`;
- verify documentation consistency and exact runtime counts/statuses;
- verify the branch contains documentation changes only;
- open a reviewable documentation-only PR.

## Out of scope

- Source code, package or lockfile changes;
- Migration creation or re-application;
- Worker deployment or Feature flag changes;
- Secret rotation, Ticket creation or Script Properties mutation;
- another Signed PREVIEW or DRY_RUN;
- Queue send/admission or Sync Worker processing;
- D1 Ads Business facts, normalization, Shared RAW or Lark writes;
- Google Ads mutation or Spend;
- schedule, LIVE or Production activation;
- Draft PR `#17` merge/cherry-pick/reuse.

## Acceptance criteria

- [x] Read `AGENTS.md` and the current repository authority before editing.
- [x] Confirm source baseline PR `#55` / `4008b991`.
- [x] Record provisioning status `confirmed` without Secret/Ticket material.
- [x] Record External Signed PREVIEW `preview_validated`.
- [x] Record datasets `6/6`, chunks `7/7`, rows `1375/1375`.
- [x] Record complete payload redaction and zero Business/Queue/Lark drift.
- [x] Record signed ingress and provisioning routes disabled / `404`.
- [x] Record Script Properties restored to `DRY_RUN` / delivery `false`.
- [x] Preserve the previous Current Task record in an archive file.
- [x] Add/update documentation only.
- [ ] Review final branch diff for accidental non-documentation changes.
- [ ] Open PR and confirm changed-file allowlist.
- [ ] Merge only after review.

## Documentation changes

```text
docs/current-task.md
docs/archive/current-task-before-google-ads-external-preview-closeout.md
docs/rollouts/google-ads-manager-script-external-signed-preview-2026-07-26.md
PROJECT_BRAIN.md
docs/project-brain/00-current-state.md
docs/project-brain/10-next-actions.md
CHANGELOG.md
```

## Implementation result

The runtime gates were completed outside this documentation branch through
explicit operator approval. This branch records only sanitized facts and safety
boundaries. It does not execute another remote action.

Authoritative rollout record:

```text
docs/rollouts/google-ads-manager-script-external-signed-preview-2026-07-26.md
```

No Source file, test, dependency, migration, runtime config or deployment asset
is intended to change in this Closeout.

## Next approval gate

Review and merge this documentation-only Closeout. After merge, open a new task
for **Local reference-only Queue admission**. That task must perform a fresh
full-codebase review and define exact Job payload/reference grain, idempotency,
retry/DLQ, checkpoint, retention, observability and reconciliation rules.

The next task must keep all of the following disabled unless separately approved:

```text
Google Ads Connector activation
Business writer
D1 Ads Business facts
Shared RAW writes
Lark writes
Schedules
LIVE delivery
Production
```

Draft PR `#17` remains Draft/HOLD and evidence-only.
