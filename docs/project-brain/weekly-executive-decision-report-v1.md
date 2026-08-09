# Project Brain — Weekly Executive Decision Report v1

## Current decision

Weekly Executive reporting is not considered ready for Automatic Notification merely because the one-shot delivery path succeeded. Executive output must support a concrete business decision from retained facts.

## Locked architecture

```text
Source / Connector
→ Normalized + Daily
→ Shared Report materialization
→ ranked Content / Paid candidates
→ Executive decision evidence
→ Lark Native AI
→ decision Quality Gate
→ Lark Group Notification
```

The existing Shared Report, Native AI and Notification runtimes remain the only allowed path.

## Executive output contract

A Weekly report must answer:

- what materially changed;
- whether upper and lower Funnel moved together or diverged;
- which real Content candidates should be repeated or taken into a controlled Paid test;
- which real Paid candidates should be Scale/Test/Keep/Reduce/Stop;
- which actions are unsafe because lower-funnel evidence is missing;
- what the business should do next week.

Generic recommendations that only say to analyze, review, compare, or monitor are not sufficient.

## Evidence policy

The source collector already exposes ranked Top Content and Top Ads. Decision evidence is bounded rather than collapsed to rank 1. Existing Organic metrics and Paid conversion/economics fields are retained when present.

A Scale recommendation cannot be justified by Impressions, Reach, Views, Clicks or CTR alone. Lower-funnel Conversion evidence plus ROAS or Conversion Value/Spend evidence must exist before Scale language is permitted.

## Funnel policy

When awareness increases while Clicks/Conversions/Sales/Revenue decline, the report must state the divergence. The default executive action is not to broadly increase spend until lower-funnel performance supports it.

## Organic ↔ Paid policy

No exact Organic-to-Paid creative identity exists in the current report source. The system must never infer that two similarly named or high-performing rows are the same creative. Organic winners can be proposed as `[TEST]` candidates only. Exact correlation becomes available only after a separately reviewed mapping contract exists.

## Safety state

```text
Historical Weekly delivery rerun     forbidden
Historical AI retrigger              forbidden
Automatic Notification producer      false
Base Notification Automation         inactive
Schedule activation                  0
Production                           BLOCKED
```

Automatic Weekly admission remains a later gate after a fresh future-period Executive Decision preview passes.
