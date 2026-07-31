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
union, but the same PATCH remained rejected. Repeating Live mutation attempts is therefore prohibited.

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

The Number and Legacy Select/Text compatibility fields remain present. They are not renamed or deleted by
this Hotfix. Any future Record compatibility write requires a separate reviewed Record-API contract and exact
read-only parity evidence; it is not authorized here.

## Repository correction

- Replace both public v3 entrypoints with fail-closed compatibility tombstones.
- Reject `--execute` and `--statistics-probe-only` before reading `.dev.vars` or importing a Lark client.
- Emit `LARK_DASHBOARD_WRITE_CONTRACT_UNSUPPORTED` with `remoteMutationCount=0`.
- Add a local-only Compatibility Freeze audit that requires no credentials and performs no network access.
- Keep historical v3 planners/helpers for retained evidence and deterministic regression only; they are no
  longer connected to a public mutation entrypoint.
- Leave `docs/current-task.md` untouched because the Meta workstream owns it.

## Public command

```bash
node scripts/lark-dashboard-compatibility-freeze-audit.mjs
```

Expected decision:

```text
LARK_DASHBOARD_COMPATIBILITY_FREEZE_ACTIVE
```

Any command containing `--execute` or `--statistics-probe-only` must fail before External access.

## Acceptance criteria

```text
Public Dashboard mutation entrypoints       fail closed before env/Lark access
Dashboard PATCH path reachable              no
Field rename/delete path reachable          no
Record delete path reachable                no
86 Report records preserved                 yes
24 current_value=null rows preserved        yes
Legacy physical Field identities preserved  yes
Manual Dashboard UI work required           no
Remote action during Implementation         0
Production                                  blocked
```

Required verification:

```text
node --test tests/scripts/lark-dashboard-field-identity-recovery-v3.test.js
npm run check
npm test
npm run test:report-reliability
npm audit
npm run deploy:dry-run
```
