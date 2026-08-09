# Weekly 7D Full-channel AI Signal Selection v1

## Incident

The business-language synthesis passed its existing quality gate, but the generated strengths treated increased Meta Ads spend as a strength and the AI evidence omitted Meta Ads clicks (-11.02%) because only the first two metrics per channel were retained.

## Correction

Reuse the existing full-channel evidence builder and validator. Do not create a new runtime or notification path.

- select a bounded, signal-aware metric set per channel: retain neutral context plus the strongest positive and strongest negative comparison signals before filling remaining slots;
- keep the evidence bounded while allowing up to three selected metrics per channel;
- expose positive, negative and neutral comparison metric names in the quality evidence;
- reject strengths that promote neutral metrics such as Spend/Budget as strengths;
- require strengths to name an observed positive metric when positive comparison evidence exists;
- require weaknesses to name an observed negative metric when negative comparison evidence exists;
- reject non-executive comparison wording such as `ค่าเปรียบเทียบ`, `พร้อมการเปรียบเทียบ` and `ข้อมูลการเปรียบเทียบที่มี`;
- preserve the existing full-channel factual report, CTR consistency, follower/action, internal-field and Data Ops gates.

The evidence checksum changes, so the next controlled synthesis receives a fresh deterministic identity. Existing generated identities remain immutable and must not be retriggered.

## Safety

Repository-only implementation. No Lark record mutation, Native AI trigger, Queue send, Worker deployment, Schedule activation or Production action is performed by this change.
