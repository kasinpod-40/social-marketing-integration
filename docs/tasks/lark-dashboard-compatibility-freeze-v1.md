# Lark Dashboard Compatibility Freeze v1

## Incident

Live Dashboard field-identity recovery v3.2 and the bounded v3.3 probe were rejected on the first
`Baseline Coverage Rate` Statistics PATCH with generic Lark `code=1`. Immediate readback was unchanged and
every confirmed mutation counter remained zero.

The Repository has no supported public Lark OpenAPI write contract for Dashboard Block/filter mutation.
Dashboard GET/read behavior is not authority to infer a supported PATCH contract.

## Permanent freeze boundary

The following mutation paths are retired:

```text
Dashboard Statistics PATCH
Dashboard Column PATCH
Dashboard Slicer PATCH
Field rename for Dashboard identity promotion
Legacy field deletion
```

No manual Dashboard UI repair is part of this contract.

The existing physical identities and Report Business facts remain preserved:

```text
metric_key                       fldGvd3tw8 / Text
display_name                     fldE4Nezjd / Text
current_value                    fldCoOy2IP / Number
Number window_days               fldbPCldTL / Number
preserved window Select          fldMlTUP3Z / SingleSelect
window Select v2                 fldraj0QP8 / SingleSelect
display Select v1                fldZB452Z2 / SingleSelect
display Select v2                fldHNUhCfl / SingleSelect
```

```text
Report records                    86
Baseline-incomplete null rows     24
Dashboards                         6
Organic Statistics               17
Slicers                            5
Window charts                      7
Record deletions                   0
```

## Window compatibility — completed

The guarded Window Record-only operation completed at `2026-07-31T19:33:19Z`
(`2026-08-01 02:33 ICT`). It populated only `fldMlTUP3Z` where Number `window_days` was authoritative and the
preserved Window Select was empty.

```text
Confirmed Window Record updates   28
Pending Window updates              0
Window conflicts                    0
Dashboard PATCH operations          0
Field/schema mutations              0
Record create/delete operations     0
```

This result closed only the Window Slicer dimension. It did not populate Display V2 and did not prove that
Organic KPI values rendered.

Corrected historical closeout:

```text
docs/tasks/lark-dashboard-compatibility-record-backfill-closeout-2026-08-01.md
```

## Display V2 compatibility — open recovery

All 17 Organic Statistics filters use `fldHNUhCfl`. The audited 68-row Dashboard matrix currently contains:

```text
Display V2 correct                  18
Display V2 blank                    48
Reviewed alias corrections           2
Required Display V2 updates         50
Unexpected conflicts                 0
```

The separate Record-only recovery may update only `fldHNUhCfl`. It must preserve every other field through a
before/after fingerprint and must not change `current_value`, including the 24 valid N/A rows.

Current contract:

```text
docs/tasks/lark-dashboard-display-v2-compatibility-v1.md
```

## Public commands

Static freeze audit:

```bash
node scripts/lark-dashboard-compatibility-freeze-audit.mjs
```

Window convergence check:

```bash
node scripts/lark-dashboard-compatibility-record-backfill.mjs
```

Display V2 read-only preview after merge:

```bash
node scripts/lark-dashboard-display-v2-compatibility-backfill.mjs
```

No Display V2 Live execution is authorized until an exact-main preview is reviewed. The retired v3 commands
containing `--execute` or `--statistics-probe-only` must fail before External access.

## Safety

```text
Dashboard PATCH path reachable              no
Field rename/delete path reachable          no
Record create/delete path reachable         no
current_value mutation allowed              no
86 Report records preserved                 yes
24 current_value=null rows preserved        yes
Legacy physical Field identities preserved  yes
Manual Dashboard UI work required           no
Remote D1/Worker/Queue action                0
Production                                  blocked
```

`docs/current-task.md` remains unchanged because the Meta workstream owns it.

The Compatibility Freeze implementation and Window guard were merged through PR #369 at:

```text
f93dcca29c5770b74a3dc6e41f2aac3489ebc8d1
```
