# Runbook — Chemistry K Meta Read-Only Validation

## Purpose

This runbook executes the first customer-source validation gate for Facebook Organic, Instagram
Organic and the two Chemistry K Meta Ads accounts. It is intentionally limited to GET-only
Provider reads and sanitized local evidence.

Merge of the implementation does not authorize execution. Run only from an authorized local
Integration Workspace after explicit operator approval.

## Preconditions

- clean repository checkout containing the approved Meta runtime and this operator;
- Node.js and locked dependencies installed;
- local `.dev.vars` or `DEV_VARS_FILE` containing the real Meta credentials;
- exact non-secret mappings already configured;
- all Connector, Meta, D1/report, DLQ redrive and schedule flags explicitly `false`;
- no Queue message, Worker deployment, D1/Lark mutation or schedule action in progress.

Required target:

```text
MKT_ENV=development
MKT_CUSTOMER_PROFILE=integration_workspace
MKT_CONNECTION_CUSTOMER_KEY=chemistry_k
META_GRAPH_API_VERSION=v25.0
META_AD_ACCOUNT_MAPPINGS=chemistry_k2=505898710119851,chemistry_k3=851206695716861
```

Credentials remain local secrets:

```text
META_ACCESS_TOKEN=<secret>
META_INSTAGRAM_ACCESS_TOKEN=<secret>
```

Never paste tokens into Git, Lark, issue comments, PR comments or evidence files.

## 1. Plan

```bash
npm run rollout:meta-read-only
```

Expected:

```text
executed=false
transport=GET_only
queueSend=false
d1Mutation=false
larkMutation=false
workerDeployment=false
scheduleActivation=false
```

## 2. Configuration preflight

This phase runs repository checks and constructs the three Meta adapters without any Provider
request.

```bash
CONFIRM_META_READ_ONLY_PREFLIGHT=READ_ONLY_META_CONFIGURATION_PREFLIGHT \
  npm run rollout:meta-read-only:preflight
```

Required result:

```text
providerRequests=0
repositoryCheck=passed
focusedTests=passed
deployDryRun=passed
```

Stop if this phase fails.

## 3. Facebook Organic

```bash
CONFIRM_META_READ_ONLY_FACEBOOK=READ_ONLY_META_FACEBOOK_ONCE \
  npm run rollout:meta-read-only:facebook
```

Required result:

```text
connectorKey=facebook
status=identity_validated
transportMethod=GET
businessWrites=0
queueMessages=0
```

Stop if identity or permission validation fails.

## 4. Instagram Organic

```bash
CONFIRM_META_READ_ONLY_INSTAGRAM=READ_ONLY_META_INSTAGRAM_ONCE \
  npm run rollout:meta-read-only:instagram
```

Required result:

```text
connectorKey=instagram
status=identity_validated
transportMethod=GET
businessWrites=0
queueMessages=0
```

The phase cannot run without passed Facebook evidence.

## 5. Meta Ads — ChemistryK2

```bash
CONFIRM_META_READ_ONLY_CHEMISTRY_K2=READ_ONLY_META_ADS_CHEMISTRY_K2_ONCE \
  npm run rollout:meta-read-only:chemistry-k2
```

Required result:

```text
connectorKey=meta_ads
sourceAccountKey=chemistry_k2
status=identity_validated
transportMethod=GET
businessWrites=0
queueMessages=0
```

The operator resolves the configured alias before calling Meta. Unknown aliases fail with zero
Provider requests.

## 6. Meta Ads — ChemistryK3

```bash
CONFIRM_META_READ_ONLY_CHEMISTRY_K3=READ_ONLY_META_ADS_CHEMISTRY_K3_ONCE \
  npm run rollout:meta-read-only:chemistry-k3
```

Required result:

```text
connectorKey=meta_ads
sourceAccountKey=chemistry_k3
status=identity_validated
transportMethod=GET
businessWrites=0
queueMessages=0
```

This phase requires passed evidence for preflight, Facebook, Instagram and ChemistryK2.

## 7. Sanitized summary

```bash
CONFIRM_META_READ_ONLY_SUMMARY=REVIEW_META_READ_ONLY_EVIDENCE \
  npm run rollout:meta-read-only:summary
```

Required result:

```text
accepted=true
validationCount=4
nextGate=separate_d1_only_approval
```

Evidence is stored locally under:

```text
outputs/meta-read-only-validation/
```

The directory is ignored by Git. Review the evidence for statuses, counts, missing permissions,
retry information and Provider error classifications. It must not contain tokens or raw customer
IDs.

## Failure handling

- Do not skip a failed phase.
- Do not change mappings merely to make identity validation pass.
- Do not retry token-invalid or permission failures until credentials/permissions are corrected.
- Provider-unavailable errors may be retried later using the same phase after reviewing bounded
  retry evidence.
- Do not enable Worker source-read, D1 write, Lark write, report-read or any schedule to work
  around an operator failure.

## Out of scope

This runbook does not:

- send Queue messages;
- write D1 or Lark;
- deploy a Worker;
- rotate tokens;
- change a Meta App or Business Manager;
- enable schedules;
- run D1-only processing, Coverage reconciliation or Lark parity;
- perform Production cutover.

Those actions require separate tasks and approvals.
