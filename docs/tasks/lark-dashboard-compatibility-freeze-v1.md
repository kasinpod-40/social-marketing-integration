# Lark Dashboard Compatibility Freeze v1

## Incident

Live Dashboard field-identity recovery v3.2 and the bounded v3.3 probe were both rejected on the first
`Baseline Coverage Rate` Statistics PATCH with generic Lark `code=1`. Immediate readback was unchanged.
Every confirmed mutation counter remained zero:

```text
Statistics Block mutations   0
Window-chart mutations       0
Record updates               0
Field mutations              0
```

The v3.3 request serializer removed response-only metadata and declared the reviewed Dashboard/Block scope
union, but the same PATCH remained rejected. Repeating Live Dashboard mutation attempts is prohibited.

## Confirmed operating boundary

The Repository has no supported public Lark OpenAPI write contract for Dashboard Block/filter mutation.
Dashboard GET/read behavior is not authority to infer a supported PATCH contract.

The following paths are retired:

```text
Dashboard Statistics PATCH
Dashboard Column PATCH
Dashboard Slicer PATCH
Field rename for Dashboard identity promotion
Legacy field deletion
```

No manual Dashboard UI repair is part of this contract.

## Compatibility Freeze

The existing Dashboard physical identities and Report Business facts are preserved:

```text
metric_key                       fldGvd3tw8 / Text
display_name                     fldE4Nezjd / Text
Number window_days               fldbPCldTL / Number
preserved window Select          fldMlTUP3Z / SingleSelect
window Select v2                 fldraj0QP8 / SingleSelect
display Select v1                fldZB452Z2 / SingleSelect
display Select v2                fldHNUhCfl / SingleSelect
```

Preserved live boundaries:

```text
Report records                    86
Baseline-incomplete null rows     24
Dashboards                         6
Organic Statistics               17
Slicers                            5
Window charts                      7
Record deletions                   0
```

The Number and Legacy Select/Text compatibility fields remain present. They are not renamed or deleted.

## Record-only compatibility backfill

The reviewed v3.2/v3.3 evidence found exactly 28 Report records where authoritative Number `window_days`
was one of `1/3/7/30` while the preserved slicer-bound Select `fldMlTUP3Z` was empty. Public Bitable Record
batch-update is supported independently from Dashboard Block mutation.

The bounded operator:

```text
scripts/lark-dashboard-compatibility-record-backfill.mjs
```

is limited to the preserved Select field on those missing rows. It:

- resolves all seven audited Field IDs and exact types before planning;
- requires exactly 86 Report records and 24 `current_value=null` rows;
- treats Number `window_days` as authoritative;
- rejects disagreement, unsupported presets and Legacy-only values;
- allows at most 28 pending updates;
- writes a private backup before mutation;
- uses only `batchUpdateRecords()` with `{recordId, fields}`;
- creates no records and deletes no records;
- performs no Dashboard, View, Field or schema mutation;
- reads back all records and requires pending updates/conflicts to reach zero;
- preserves confirmed partial-write progress from `error.writeProgress.confirmedRows`;
- is resumable because already-populated rows produce no update.

## Live closeout — 2026-08-01

The guarded Record-only operation completed successfully at `2026-07-31T19:33:19Z`
(`2026-08-01 02:33 ICT`). Final read-only convergence confirmed:

```text
Decision                            LARK_DASHBOARD_COMPATIBILITY_RECORD_BACKFILL_FINAL_CONVERGENCE_PASS
Report records                      86
Baseline-incomplete null rows       24
Confirmed Record updates            28
Pending Record updates               0
Window conflicts                     0
Dashboard PATCH operations           0
Field/schema mutations               0
Record create/delete operations      0
Remote D1 mutations                  0
Worker deployments                   0
Queue sends                          0
Production                          BLOCKED
```

The write populated only `fldMlTUP3Z` on existing rows where Number `window_days` was authoritative and the
preserved Select was empty. All Dashboard IDs, Block IDs, layouts and physical Field identities remain intact.
The 24 `current_value=null` rows remain valid N/A Business facts.

No further `--execute` run is required or authorized for this closed scope. Future use of the operator is
preview-only unless a new reviewed drift incident opens a separate task.

Detailed closeout evidence:

```text
docs/tasks/lark-dashboard-compatibility-record-backfill-closeout-2026-08-01.md
```

## Repository correction

- Replace both public v3 entrypoints with fail-closed compatibility tombstones.
- Reject `--execute` and `--statistics-probe-only` before reading `.dev.vars` or importing a Lark client.
- Emit `LARK_DASHBOARD_WRITE_CONTRACT_UNSUPPORTED` with `remoteMutationCount=0`.
- Add a local-only Compatibility Freeze audit that requires no credentials and performs no network access.
- Add the guarded Record-only compatibility backfill described above.
- Keep historical v3 planners/helpers for retained evidence and deterministic regression only; they are no
  longer connected to a Dashboard/Field mutation entrypoint.
- Keep the historical window-chart planner regression while asserting that the public operator contains no
  window-chart PATCH wiring.
- Leave `docs/current-task.md` untouched because the Meta workstream owns it.

## Public commands after closeout

Local-only Freeze audit:

```bash
node scripts/lark-dashboard-compatibility-freeze-audit.mjs
```

Read-only live convergence check:

```bash
node scripts/lark-dashboard-compatibility-record-backfill.mjs
```

Expected decisions after closeout:

```text
LARK_DASHBOARD_COMPATIBILITY_FREEZE_ACTIVE
LARK_DASHBOARD_COMPATIBILITY_RECORD_BACKFILL_PREVIEW_READY
pendingRecordUpdateCount = 0
windowConflictCount = 0
```

The retired v3 commands containing `--execute` or `--statistics-probe-only` must fail before External access.

## Acceptance criteria — closed

```text
Public Dashboard mutation entrypoints       fail closed before env/Lark access
Dashboard PATCH path reachable              no
Field rename/delete path reachable          no
Record delete/create path reachable         no
Record-only missing Select updates          28 confirmed
Pending Record compatibility updates        0
Window conflicts                            0
86 Report records preserved                 yes
24 current_value=null rows preserved        yes
Legacy physical Field identities preserved  yes
Partial/unknown write progress truthful      yes
Manual Dashboard UI work required           no
Remote D1/Worker/Queue action                0
Production                                  blocked
```

Repository implementation verification completed on exact Head `7fc6e9f8dec2cf5fb89d40f6673831c5ee1badff`:

```text
Focused regressions          pass
Repository check             pass
Unit/Workers tests           pass
Report reliability           pass
Dependency audit             pass
Wrangler dry-run             pass
Remote mutation during test  0
```

Implementation and guards were Squash Merged through PR #369 at:

```text
f93dcca29c5770b74a3dc6e41f2aac3489ebc8d1
```
