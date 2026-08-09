# Weekly Executive Decision Report v1 — Implementation Evidence

## Repository implementation

Branch starts from `main@af5ab29aed7d355aee788cc1a5a556f6afb731c7` after the corrected Weekly one-shot closeout.

Implemented changes are repository-only:

- factual report v4 retains bounded ranked Content and Ads candidates instead of collapsing each collection to rank 1;
- Organic decision facts retain Views, Likes, Comments, Shares, Engagement, Engagement Rate and performance status;
- Paid decision facts retain Spend, Impressions, Reach, Clicks, derived CTR, Conversions, Conversion Value, CPC, CPA and ROAS;
- Executive AI evidence retains up to three Content and three Ads candidates per business channel;
- deterministic Funnel divergence detects awareness-up / outcome-down evidence;
- recommendation Quality Gate requires named decision actions and rejects generic follow-up language;
- unsupported Scale and fabricated Organic↔Paid identity claims fail closed;
- historical Weekly delivery identity remains terminal and untouched.

## Remote action counters

```text
Lark record write              0
Native AI trigger              0
Queue send                     0
Group notification             0
Worker deployment              0
Automation activation          0
Schedule activation            0
Production                     BLOCKED
```

## Verification

Exact PR-head validation is pending GitHub Branch Verification. Results must be copied into `docs/current-task.md` before merge.
