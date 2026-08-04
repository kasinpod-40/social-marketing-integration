# Report Readiness Runtime Environment Bridge v1

Date: 2026-08-05

## Incident

The Report Runtime Finalizer converged successfully on exact `main` with all six Repository gates,
zero Schema actions, 74 active canonical Settings and every execution flag false. The subsequent
SELECT-only readiness collection stopped before Remote state reads for every reviewed channel.

```text
facebook / instagram / youtube
meta_ads / google_ads / tiktok_ads / chatwoot
  LARK_TABLE_MKT_REPORT_TOP_ADS is required

woocommerce
  Report closeout config lacks MKT_WOOCOMMERCE_REPORT_READ_ENABLED
```

The failed collection performed zero Provider requests, Queue actions, Remote mutation or Worker
deployment. No channel Source readiness was actually evaluated.

## Root cause

The Finalizer's shared Schema planner resolved all physical Report Table IDs and passed them between
its own subprocess stages, but retained only mapping names in the public summary. Readiness and the
reviewed multiwindow executor later rebuilt their generated Worker window from the private local
Wrangler source, so a Table mapping resolved by the Finalizer but absent from that source was lost.

WooCommerce has an approved report-only execution flag from the existing Commerce closeout contract.
The private Wrangler baseline predates that additive flag, while the closeout builder previously
required every reviewed flag to be physically present before generating its temporary Safe/Active
configs.

## Correction

- retain one `0600` private Finalizer environment file beside the sanitized Finalizer summary;
- bind it to the exact clean `main` Head and the successful Finalizer summary;
- retain exactly the six non-secret Report Table mappings returned by the shared Schema planner;
- require the private environment contract in subsequent Finalizer evidence admission;
- let the existing shared closeout config builder overlay exact Finalizer mappings only into its
  generated in-memory Worker config;
- synthesize only the already-approved `MKT_WOOCOMMERCE_REPORT_READ_ENABLED=false` baseline when
  WooCommerce is the reviewed target, then enable it only in the bounded Active window;
- continue to reject missing generic Report flags, unknown flags, placeholder mappings, Head drift
  and incomplete private evidence;
- reuse the same builder for SELECT-only readiness and reviewed Run All execution.

No `.dev.vars` or private Wrangler file is edited. No new Report engine, writer, Queue framework,
Reliability layer or channel-specific readiness path is introduced.

## Acceptance

```text
Finalizer private environment contract     report_runtime_finalizer_environment_v1
Finalizer summary contains raw Table IDs   false
Private file mode                          0600
Exact repository Head match                required
Readiness mappings                         shared Finalizer authority
Woo report flag in Safe config             false
Woo report flag in Active config           true
Generic missing Report flags               fail closed
Provider / Queue / Worker / Remote action   0 during implementation and readiness preview
Schedule / AI                              false / false
Production                                 BLOCKED
```

After merge, rerun the Finalizer once on exact current `main`, then rerun SELECT-only readiness with
`MKT_REPORT_RUNTIME_FINALIZER_EVIDENCE` pointing to that new summary. Do not construct a retained
Run All handoff until readiness has produced real per-channel Source/Runtime/Lark/window evidence.
