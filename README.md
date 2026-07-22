# Social Marketing Data Integration

ระบบรวมข้อมูล Social Organic, Paid Ads, Commerce และ Conversation เข้าสู่ Lark Base สำหรับ Daily Snapshot, Dashboard, Reporting, AI Summary, Insight และ Alert โดยใช้ JavaScript ES Modules, Cloudflare Workers, D1, Queues และ Lark Open API.

## Current baseline

- Implementation baseline: `d4a531fbb4e05dad7ce2296859c97f571e23acf3` / PR `#13`
- Documentation closeout: PR `#14`
- Application package line: `0.11.0`
- Lark contract versions: View `v0.13.5`, Formula `v0.13.6`, repository correction `v0.13.7`
- Current task: `docs/current-task.md` — closed
- Current project state: `PROJECT_BRAIN.md`

Contract version numbers do not automatically bump the application package version.

## Current progress

Milestone estimates, not code coverage:

```text
MKT Integration Workspace          ~59%
Lark data model/schema foundation   100%
Google Ads end-to-end                45%
Customer-source replacement readiness 40%
Chemistry K Production readiness     25%
```

Detailed weighting: `docs/project-brain/mkt-progress-v0.13.0.md`.

## Current Integration Workspace Lark state

Fresh configuration-only audit of `Social MKT Data Hub(11).base`:

```text
Physical tables             42
Fields                     737
Views                      133
Filtered Views              42
Sorted Views                 6
Views with hidden fields     7
Duplicate table names        0
Table emoji/folders       42/42
View emoji names         133/133
```

Managed contracts:

```text
Google Ads Formula fields    4/4 PASS
Google Ads managed filters  19/19 PASS
Shared-table filters        17/17 PASS
Report Views                 6/6 PASS
Google Ads Daily 30D         platform=google_ads + TheLastMonth
```

Do not rerun the Google Ads View Apply or Formula UI closeout.

## View contract rule

133 Views are classified as:

- 17 Shared-table managed Views
- 6 Report managed Views
- 19 Google Ads managed Views
- 36 All/default Views intentionally preserved without Filter
- 55 legacy specialized Views preserved without inferred business logic

The 42 filtered Views are exactly `17 + 6 + 19`.

A complete Full View contract means every View is managed or explicitly preserved. It does not mean all specialized names such as Active, Failed, Latest, Connection Issues or High Spend Low ROAS already have business filters. Those 55 Views require a separate business-owner contract before mutation.

See `docs/lark-full-view-contract-v0.13.5.md`.

## Shared workflow between ChatGPT Work and Codex

Read in this order before analysis or implementation:

```text
AGENTS.md
→ docs/current-task.md
→ PROJECT_BRAIN.md
→ docs/project-brain/* relevant files
→ README.md and CHANGELOG.md
→ Source and Tests
```

- `AGENTS.md` defines repository-wide operating rules.
- `docs/current-task.md` is the current source of truth for Scope, Contract, Acceptance criteria and Implementation result.
- Historical documents cannot override a newer verified current task.
- Connector coding cannot start until the current task records technical approval.
- Credential, Live resource, Schedule and Production changes require separate gates.

## Integration Workspace and ownership

Before Production there is one operational Workspace:

```env
MKT_ENV=development
MKT_CUSTOMER_PROFILE=integration_workspace
```

`development` is only the current Cloudflare isolation label. It does not create separate DEV/UAT workflows.

The same Worker, D1, Queue, DLQ, secret store, Lark Base and table IDs are used while the full system is assembled. Source ownership is defined per Connector:

- TikTok and Google Ads use Chemistry K customer sources; Facebook, Instagram and YouTube may still use temporary developer-owned sources;
- Google Ads, WooCommerce and Chatwoot use customer-owned sources when access exists;
- the profile does not change when a source is replaced;
- temporary rows are removed by exact platform/account/source scope before customer data is backfilled.

Production uses:

```env
MKT_ENV=production
MKT_CUSTOMER_PROFILE=chemistry_k
```

Production must use customer-owned Lark, Cloudflare, D1, Queues, credentials and platform assets.

Full contract: `docs/project-brain/integration-workspace.md`.

## Connector status

| Connector | Status | Current direction |
|---|---|---|
| TikTok Organic | Active in Integration Workspace | Lark Native protected RAW → Canonical Content/Daily |
| YouTube Organic | Active in Integration Workspace | YouTube Data API + Owner Analytics |
| Facebook Organic | Planned | Meta Graph business adapter + shared reliability |
| Instagram Organic | Planned | Instagram Login/Graph business adapter + shared reliability |
| Meta Ads | Planned | Controlled API/Worker connector |
| Google Ads | Signed-delivery source implementation complete; Integration Workspace validation pending | Manager Script signed delivery MVP; direct API optional Phase 2 |
| TikTok Ads | Planned | Controlled API/Worker connector; Lark native Ads is not Production source of truth |
| WooCommerce | Planned | Sanitized source contract, connector pending |
| Chatwoot | Planned | Sanitized conversation contract, connector pending |

Connector Catalog activates only implementations with a real tested Runtime path. Planned connectors fail closed even if a flag is set to true.

## Google Ads current status

Completed:

- customer-authorized account link/selectability
- exact allowlisted Manager Script read-only Preview
- six non-empty bounded datasets
- dataset errors/truncation `0/0`
- Google Ads `No changes`
- Frequency `—`
- Lark schema, Relations, managed Views and formulas
- update-only Google View maintenance safety guard

Direct API access:

```text
Basic Access application  submitted 2026-07-21
Case ID                   1-686800040839
Review                    pending
Current level             Test Account Access
```

Direct API approval does not block the Manager Script MVP.

Not implemented:

- signed external delivery
- Worker ingress
- HMAC/timestamp/nonce/replay checks
- Google Ads Queue job and router
- D1 nonce/checkpoint/idempotency state
- normalization and Lark Business Record writes
- schedule
- deployment

Sanitized evidence: `docs/google-ads-manager-script-read-only-uat-evidence.md`.

## Google Ads View Filter command

Read-only Preview:

```bash
npm run setup:google-ads-view-filters
```

Guarded Apply is reserved for a verified Integration Workspace mismatch and requires explicit confirmation:

```bash
CONFIRM_WRITE=YES npm run setup:google-ads-view-filters:apply
```

The Google Ads command is update-only:

- missing managed View is a blocker;
- `createViews` must be zero;
- every Action must be `update_view`;
- a wrapped client permanently blocks `createView`;
- no Table, Field, View-name, Sort, Hidden-field or Record mutation is permitted by this command.

Current Live state is already zero drift. Do not rerun Apply.

## Google Ads Formula contract

Live tenant uses `[field]`, `ISBLANK(...)` and `""` for blank numeric results:

```text
MKT_Ads_Campaigns.budget
IF(ISBLANK([budget_micros]),"",[budget_micros]/1000000)

MKT_Ads_Daily.all_conversion_value
IF(ISBLANK([all_conversion_value_micros]),"",[all_conversion_value_micros]/1000000)

MKT_Ads_Daily.cost_per_conversion
IF(OR(ISBLANK([conversions]),[conversions]=0,ISBLANK([spend])),"",[spend]/[conversions])

MKT_Ads_Daily.conversion_rate
IF(OR(ISBLANK([clicks]),[clicks]=0,ISBLANK([conversions])),"",[conversions]/[clicks])
```

All four are Live verified. Do not reapply.

## RAW error View coverage

The 13 Google RAW error Views use a stable-key-only minimum contract:

```text
primary raw stable key isEmpty
```

They detect missing raw identity only. Customer ID, entity ID, status, report-level, segment-key and policy-state validation requires a separate Data Quality contract.

## Repository correction verification

PR #13 passed:

```text
npm ci                         PASS
npm run check                  PASS
Focused staged TikTok           4/4 PASS
Node Unit/Integration         540/540 PASS
Workers runtime                 9/9 PASS
Report reliability             70/70 PASS
npm audit --audit-level=high    0 vulnerabilities
npm run deploy:dry-run          PASS
```

The transitive `sharp` vulnerability chain was remediated by `overrides.sharp=0.35.3` and a refreshed lockfile. No Live resource was mutated.

## Local setup

```bash
cp .dev.vars.example .dev.vars
chmod 600 .dev.vars
npm ci
```

Do not commit `.dev.vars` or `wrangler.sync.jsonc`.

Current Integration Workspace identity:

```env
MKT_ENV=development
MKT_CUSTOMER_PROFILE=integration_workspace
```

Secrets must remain in `.dev.vars`, Wrangler Secret or the environment-specific Secret Manager:

```text
LARK_APP_ID
LARK_APP_SECRET
LARK_APP_TOKEN
API keys
OAuth tokens
Webhook/signing secrets
Passwords
```

## Verification commands

```bash
npm ci
npm run check
npm test
npm run test:report-reliability
npm audit --audit-level=high
npm run deploy:dry-run
```

Focused commands:

```bash
npm run validate:tiktok
npm run preflight:youtube
npm run analyze:lark-base-export -- --base-export /path/to/export.base
npm run setup:google-ads-view-filters
```

## TikTok Organic commands

Read-only validation:

```bash
npm run validate:tiktok
```

Confirmed local write only after validation:

```bash
CONFIRM_WRITE=YES npm run sync:tiktok
```

Report schema and managed Views:

```bash
npm run setup:report-schema
CONFIRM_WRITE=YES npm run setup:report-schema:apply

npm run setup:report-views
CONFIRM_WRITE=YES npm run setup:report-views:apply
```

Do not rerun a Live Apply when Preview is already zero drift.

## YouTube Organic commands

```bash
npm run preflight:youtube
npm run setup:youtube-schema
CONFIRM_WRITE=YES npm run setup:youtube-schema:apply
npm run job:youtube-sync
```

Workspace schedules and Owner Analytics remain channel-gated. Customer-scale 837-video validation is still required before Production.

## Cloudflare configuration

Copy the example into an ignored local file:

```bash
cp -n wrangler.sync.example.jsonc wrangler.sync.jsonc
```

Replace environment-specific D1, Queue and Table IDs locally. Release examples keep all new connectors and schedules disabled.

Never deploy using placeholder IDs.

## Architecture

```text
apps/
  api-worker/       HTTP/admin/health boundaries
  sync-worker/      scheduled and Queue jobs

packages/
  domain/           entities and value objects
  application/      use cases, connector and job contracts
  sync-engine/      storage-neutral plan/diff/execute
  connectors/       Lark, TikTok, YouTube, Meta transport and source clients
  config/           profiles, catalogs, feature flags and table mappings
  reliability/      D1 stores, lock, retry, DLQ, outbox and redrive
  shared/           date, error, HTTP and serialization utilities

scripts/            guarded setup/preflight/release tools
tests/              unit, integration, worker-runtime and reliability tests
docs/               contracts, runbooks, audits and Project Brain
```

Dependency direction must remain inward toward Domain/Application contracts. New connectors reuse the central Job Catalog, Connector Catalog and reliability architecture.

## Next approval gate

Proposed workstream:

`Google Ads Manager Script signed delivery connector`

Before coding, approve:

1. six-dataset payload schema/version
2. stable key and idempotency key
3. HMAC signature, timestamp, nonce and replay window
4. bounded batch and payload size
5. null semantics
6. partial-write/retry classification
7. Queue/DLQ/checkpoint/lock/reconciliation
8. retention/redaction/audit
9. single-Workspace profile safety and Production isolation
10. schedule disabled by default

Then run manual signed-delivery validation in the same Integration Workspace and an idempotent rerun before any schedule is enabled.

## Release safety

Release archives must exclude:

```text
.dev.vars
wrangler.sync.jsonc
.git
.wrangler
node_modules
.DS_Store
__MACOSX
AppleDouble files
local SQLite files and sidecars
.mkt-locks
outputs and generated local artifacts
```

Use:

```bash
npm run release:package
npm run release:verify -- outputs/releases/<archive>.zip
```

## Permanent rules

- Data model before Connector
- One mixed-source Integration Workspace is used before Production; source ownership is tracked per Connector and the profile is not switched between channels
- Production is customer-owned
- connectors and schedules disabled by default until their gates pass
- no fake Production success
- no Business write without stable key/idempotency/retry semantics
- missing metrics remain `null` unless zero is a real source value
- secrets never enter Source, Log, Health or release artifacts
- do not infer View business logic from a View name
- do not claim a Live root cause without a minimal Live reproduction or successful Apply
