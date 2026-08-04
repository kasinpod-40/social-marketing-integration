# Report Metric Primary Identity Hotfix v1

## Incident

After PR #486 merged, the Report Finalizer resolved the existing Report Metric Values table correctly and reached the Dashboard Compatibility Freeze inspection. It stopped safely with:

```text
stage            report-metric-value-field-migration-preview
identityKey      metricKey
expectedPrimary  true
actualPrimary    false
fieldName        metric_key
fieldType        Text
```

No Report materialization, Lark/D1 write, Queue send, Worker active window, Schedule or Production action started.

## Root cause

The Compatibility Freeze introduced in PR #484 incorrectly declared `metric_key` as the Primary field.

The canonical Report schema has always defined:

```text
report_metric_key  Text / Primary
metric_key         Text / non-primary
```

Live Lark state matches the canonical schema. The blocker was therefore a Repository contract defect, not Lark drift and not missing TikTok or multichannel data.

## Correction

- keep the reviewed physical `metric_key` Field ID, name and type unchanged;
- correct only its expected Primary flag from `true` to `false`;
- continue to fail closed if `metric_key` is promoted to Primary;
- leave `report_metric_key` Primary ownership under the shared Report schema planner;
- do not rename, delete, recreate or mutate any Lark Field;
- do not touch D1, Queue, Worker, Schedule or Production.

## Verification

```text
exact Live-compatible metric_key non-primary state  admitted
metric_key promoted to Primary                      blocked
wrong Field ID/name/type                            blocked
Number/Select parity mismatch                       blocked
missing canonical display                           blocked
zero Field/Record mutation                          required
full Repository gates                               required
```

## Safety

```text
Implementation Remote action  0
Lark/D1/Queue/Worker           0/0/0/0
Field rename/delete           0
Schedule                      disabled
Production                    blocked
```
