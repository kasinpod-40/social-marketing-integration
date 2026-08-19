# Customer Base Dashboard / Workflow Manual Parity — 2026-08-19

## Scope and authority

This procedure closes the manual-only parity boundary for the exact approved Source export:

```text
Source export SHA-256   c230354d7eb06f7ab598511c1be4d798ba420e50255ce29a6b810db505e8e643
Dashboards              6
Dashboard charts        75
Workflows               2
Target                   ✨Marketing Content Calendar
Execution timing         post automatic controlled Apply only
```

The v1 resource manifest is forensic-only because it exposed internal identifiers before the v2 redaction repair. No raw identifier from that file is retained here. This document uses only safe structural and semantic evidence already extracted from the exact Source authority.

Dashboard/Workflow definitions must **not** be replayed through guessed OpenAPI payloads. If no documented definition-write contract exists, parity is performed through supported Lark UI using the Source reference copy as the visual/semantic authority.

## Automatic/manual ownership boundary

Automatic controlled Apply owns only:

- the 32 clone-scope Tables, Fields, Records, Relations, Formulas and supported View properties;
- documented View hierarchy parity;
- Advanced Permission roles/table permissions;
- canonical GET-only clone verification.

Manual post-Apply work owns:

- View field order / sort / group / explicit widths / row height / frozen columns;
- Dashboard reconstruction and visual verification;
- Workflow reconstruction and semantic verification;
- internal Base folder placement.

Do not start any manual resource work until automatic controlled Apply has returned `automaticApplyComplete=true` and the canonical verifier has passed.

## Dashboard source facts

Six Dashboard identities are represented by Source order only. Exact internal snapshots are opaque and are not treated as request bodies.

```text
Dashboard ordinal   Chart count   Chart subtype distribution
1                   13            subtype 0 × 8, subtype 7 × 3, subtype 14 × 2
2                   10            subtype 0 × 6, subtype 7 × 3, subtype 14 × 1
3                   11            subtype 0 × 7, subtype 7 × 3, subtype 14 × 1
4                    8            subtype 0 × 3, subtype 7 × 3, subtype 11 × 2
5                   11            subtype 0 × 7, subtype 7 × 3, subtype 14 × 1
6                   22            subtype 0 × 17, subtype 7 × 3, subtype 14 × 2
```

All six Source Dashboards have advanced-permission disabled.

## Dashboard execution procedure

For Dashboard ordinals 1 through 6, in Source order:

1. Open the exact Source reference copy and Target side by side.
2. Create/recreate exactly one Target Dashboard for that Source ordinal.
3. Recreate every chart through the supported Lark UI only.
4. Preserve chart order, chart type/subtype, title, metric/dimension selection, aggregation, filters, legend/display settings, axis/range choices and layout exactly as shown in Source UI.
5. Map Table/Field references by semantic Table and Field names to the newly cloned Target resources; never type/paste Source internal IDs.
6. Confirm the Dashboard chart count matches the table above before moving to the next ordinal.
7. Confirm advanced-permission remains disabled for the Dashboard.
8. Capture one safe Target screenshot for the whole Dashboard plus any additional screenshots required to show charts that are not visible in the first viewport. Screenshots must not expose credentials/tokens or hidden internal IDs.

A Dashboard is not complete merely because the chart count matches. Visual configuration must be compared against the Source reference UI.

## Dashboard verification criteria

Dashboard parity passes only when all of these are true:

- Target Dashboard count = 6;
- per-ordinal chart counts = `13 / 10 / 11 / 8 / 11 / 22`;
- per-ordinal subtype distributions match the Source facts above;
- advanced-permission is disabled on all six;
- each chart's semantic data source points at Target clone resources by Table/Field meaning;
- Source and Target screenshots show the same chart set, order, layout and visible configuration;
- no Source internal ID, token, opaque snapshot or undocumented payload was replayed.

Any visual or semantic uncertainty keeps Dashboard parity blocked; do not guess.

## Workflow 1 — AI Materialization → MKT_AI_Report_Runs

Safe Source semantics:

```text
Name           AI Materialization → MKT_AI_Report_Runs
Trigger        setRecord
Export status  1
Flow           SetRecordTrigger
               → GenerateAiTextWithSkyLarkAction
               → GenerateAiTextWithSkyLarkAction
               → GenerateAiTextWithSkyLarkAction
               → GenerateAiTextWithSkyLarkAction
               → SetRecordAction
```

Manual procedure:

1. Create/recreate the Workflow using the exact name above.
2. Configure the trigger as the Source UI shows for `setRecord`, mapping referenced Table/Field semantics to Target clone resources by name.
3. Recreate the four AI text-generation actions in the exact Source order.
4. For each AI action, copy only user-visible supported UI configuration/prompts from the Source reference UI. Never copy internal generated step IDs or raw `FlowSchema`/Draft JSON.
5. Recreate the final Set Record action and map every destination Field by semantic name.
6. Preserve the Source enabled state represented by export status `1`.
7. Capture safe screenshots showing trigger, all four AI actions, final Set Record action and enabled state.

Verification requires exact step count/order, semantic Table/Field mapping, supported UI-visible prompt/config parity and enabled state.

## Workflow 2 — Eligible AI Run → Lark Group Notification

Safe Source semantics:

```text
Name           Eligible AI Run → Lark Group Notification
Trigger        addRecordV2
Export status  0
Exported Draft AddRecordTrigger → Delay (1 minute)
```

Manual procedure:

1. Create/recreate the Workflow using the exact name above.
2. Configure the Add Record trigger exactly as shown in Source UI, mapping Table/Field semantics to Target clone resources by name.
3. Recreate the Delay step with an exact duration of 1 minute.
4. Do not infer or invent downstream steps that are not proven by the safe retained evidence; use Source UI as the authority if additional supported UI-visible steps exist.
5. Preserve the Source disabled state represented by export status `0` unless the user separately authorizes an enablement change after parity is proven.
6. Capture safe screenshots showing trigger, delay, any additional Source-visible supported steps and disabled state.

Verification requires exact Source-visible step order/configuration, semantic Target references, the one-minute delay and disabled state.

## Workflow verification rules

For both Workflows:

- no internal generated step/state ID may be copied;
- no tenant/user/base identity may be copied from forensic output;
- no raw auth key, webhook token, credential, Draft JSON or FlowSchema payload may be replayed;
- Table/Field/Select-option references are mapped by semantic names only;
- Source UI is authoritative when safe structural evidence does not expose enough detail;
- a screenshot/evidence record must prove the final Target UI configuration and enabled/disabled state.

## Post-configuration closeout

After manual View, Dashboard and Workflow work:

1. rerun the canonical GET-only clone verifier for automatic-owned dimensions;
2. export the Target Base once for local manual-View verification against the retained safe View manifest;
3. retain safe Dashboard/Workflow screenshot evidence and the exact Target export SHA-256;
4. confirm protected TikTok and all unrelated customer resources are unchanged;
5. move the 32 cloned Tables under `Setup Phase | Social MKT Data Hub` if supported folder placement still requires UI work;
6. only then mark full parity complete and move PR #661 from Draft toward merge.

No Dashboard/Workflow OpenAPI write is authorized by this procedure.