# Report Platform Option Contract Alignment Hotfix v1

## Incident

The Report Runtime Finalizer passed Repository gates, the value-preserving Report Metric migration,
and Report schema preview/apply. It then stopped safely at `dashboard-settings-preview` while
preflighting the canonical Chatwoot 1D setting:

```text
report_setting_key  integration_workspace:chatwoot:rolling:1d
field               platforms
value               chatwoot
failure             value is not configured in destination select options
```

No Report materialization, D1 Report write, Queue send, Worker active window, Schedule or
Production action occurred.

## Root cause

The canonical Report platform adapter registry and Report Settings seed both contained `chatwoot`,
but the shared Lark Report materialization platform options stopped at `woocommerce`.

A direct append alone was unsafe because `lark-report-schema-v2.js` previously inferred Organic
Top Content options as every platform that was neither Ads nor WooCommerce. That inference would
have incorrectly admitted Chatwoot into `MKT_Report_Top_Content`.

## Correction

- add `chatwoot` to the shared Report platform options used by Report Settings, Snapshots and
  Metric Values;
- declare Organic and Paid Ads platform groups explicitly inside the materialization schema;
- derive executable Top Content options from the materialization Top Content contract instead of
  negative filtering;
- keep Top Content limited to Facebook, Instagram, TikTok and YouTube;
- keep Top Ads limited to Meta Ads, Google Ads and TikTok Ads;
- add one cross-contract regression requiring the adapter registry, Settings seed, materialization
  options and executable Lark schema to remain aligned.

## Expected Finalizer behavior after merge

```text
report-schema-preview  plans additive chatwoot Select-option updates
report-schema-apply    preserves existing option IDs and appends chatwoot
settings-preview       accepts canonical Chatwoot settings
settings-apply         continues through the existing guarded reconciliation
```

## Safety

```text
Repository implementation Remote action  0
Lark/D1/Queue/Worker                    0/0/0/0
Field/Table delete or rename            0
Schedule                                disabled
Production                              blocked
```
