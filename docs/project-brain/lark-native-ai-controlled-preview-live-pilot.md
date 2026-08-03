# Project Brain — Lark Native AI Controlled Preview Live Pilot

## Current authority

The merged all-channel AI stack now contains:

```text
Offline Preview                 main@db7a09e6d5b2a78f4e7e25bd0a7822cbef85bdeb
Controlled Preview Readiness    main@b22ffd4c54075fc8e434b85a4c1d43be200094d9
Controlled Preview Executor     main@48cb63c70b95f306a5a101a68a4706d010762e68
```

The current workstream adds the first bounded Remote Record pilot for `🧠 MKT_AI_Report_Runs`. It does not invoke Lark Native AI.

## Live sequence

```text
release the single Integration Workspace Remote lock
→ generate four readiness plans from real validated Report evidence
→ bind approval to exact reviewed main
→ read existing Lark Preview identities
→ create/update at most 40 Records
→ fresh read-back
→ require 40 no-op / zero-write convergence
→ close the Preview write window
```

## Hard boundary

- one Remote mutation owner at a time;
- no Fixture or dummy Business data;
- no Record delete;
- no Schema/View mutation;
- no AI call;
- no Automation or Group notification;
- no D1, Queue, Worker deployment or Provider action;
- Schedule disabled;
- Production blocked.

The user may see unavailable, pending, partial and no-data statuses in Lark. Those states are intentionally truthful and must not be converted to measured zero.

## Current dependency

The active Chatwoot/Meta recovery authority must release the Remote lock before execution. PR #445 must separately establish real Report closure/readiness evidence; this workstream does not duplicate its Report materializer or Remote collectors.
