# Weekly Executive Decision Report v1

## Business problem

The completed Weekly 7D Full-channel one-shot proved Report → Native AI → Group Notification delivery, but the delivered content was still descriptive rather than decision-supportive. It reported channel totals and broad recommendations without identifying which Content or Paid candidates should be tested, scaled, kept, reduced, or stopped.

## Confirmed repository cause

The Shared Report output already contains ranked `topContent[]` and `topAds[]` rows with richer decision metrics. The downstream factual boundary retained only the first Content and first Ad, and discarded several Organic and Paid fields before the Native AI evidence was built.

The prior Writer contract also accepted generic business follow-up wording, so a recommendation could pass without naming a Content/Ad candidate or making an explicit decision.

## Correction

Reuse the existing Shared Report and Native AI path:

```text
Shared Report materialization
→ bounded ranked Content/Ads candidates
→ Executive factual authority
→ Executive decision evidence
→ Native AI
→ decision quality gate
→ Notification admission
```

No new AI provider, report engine, Queue framework, Lark sync engine, or Notification path is introduced.

### Decision candidate bounds

- factual authority: maximum 5 Content + 5 Ads per channel;
- Native AI evidence: maximum 3 Content + 3 Ads per channel;
- human-readable factual body: maximum 3 Content + 3 Ads per channel;
- nine-channel identity and existing source Report IDs remain authoritative.

### Preserved business facts

Organic candidates retain Views, Likes, Comments, Shares, Engagement, Engagement Rate and performance status.

Paid candidates retain Spend, Impressions, Reach, Clicks, derived CTR, Conversions, Conversion Value, CPC, CPA and ROAS. CTR continues to be derived from Clicks/Impressions when both are available.

### Decision labels

Recommendations must use at least two explicit actions when business evidence exists:

- `[CONTENT]`
- `[TEST]`
- `[SCALE]`
- `[KEEP]`
- `[REDUCE]`
- `[STOP]`
- `[NO-SCALE]`

When a candidate exists, the action must name a real retained Content caption or Ad name.

### Scale guard

`[SCALE]` is not supported by upper-funnel evidence alone. A Paid candidate must have positive Conversion evidence plus ROAS evidence or positive Conversion Value with Spend before the Quality Gate will permit a Scale recommendation.

This rule does not claim that every candidate with those fields should be scaled. It only establishes that lower-funnel evidence exists; Native AI must still make an evidence-backed decision.

### Funnel divergence

A deterministic evidence rule identifies `awareness_up_outcome_down` when positive comparison evidence exists for Impressions/Reach/Views while negative comparison evidence exists for Clicks/Conversions/Sales/Revenue. In that case, the recommendation must explicitly mention both sides of the divergence and broad Scale is not an acceptable default.

### Organic ↔ Paid safety

The current source contract does not expose an exact identity joining an Organic Content row to a Paid Creative/Ad row. Therefore `organicPaidMappingAvailable=false` is explicit evidence. Organic winners may be proposed for controlled Paid `[TEST]`, but the AI must not claim that an Organic post and an Ad are the same creative without future exact mapping evidence.

## Historical delivery rule

The already-delivered Weekly identity remains terminal forensic/business evidence. This repository change must not trigger, repair, resend, replace, or mutate that historical message or its AI identity.

## Activation gate

Automatic Weekly Notification remains blocked after this implementation until:

1. exact PR-head CI passes;
2. a fresh future-period decision preview passes the new Quality Gate;
3. the preview is verified to contain actionable named decisions without fabricated linkage;
4. Schedule/producer activation is separately approved.

Production remains blocked.
