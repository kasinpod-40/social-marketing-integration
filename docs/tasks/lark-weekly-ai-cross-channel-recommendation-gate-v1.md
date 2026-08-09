# Weekly 7D AI Cross-channel Recommendation Gate v1

## Incident

The signal-aware full-channel Native AI synthesis generated all four outputs, but the local quality gate stopped at `recommendations_contains_data_ops`.

The retained recommendation was business analysis, not Data Ops:

> ติดตามผลลัพธ์การตลาดที่ส่งผลต่อยอดขายรวมและยอดขายสุทธิของ WooCommerce เพื่อหาความสัมพันธ์กับช่องทางอื่นที่มีข้อมูล

The Notification preview correctly did not run after the quality failure. The generated synthesis identity must remain immutable and must not be retriggered.

## Confirmed root cause

`validateLarkNativeAiExecutiveWriterOutputs()` classified the literal phrase `ช่องทางอื่น` as Data Ops regardless of context. That over-broad token also matched legitimate cross-channel business analysis where other channels already have business evidence.

The existing explicit Data Ops patterns already cover the prohibited operational advice, including `เติมข้อมูล`, `รอข้อมูล`, missing/incomplete-data language, data checks, system fixes, Connection/source readiness and Coverage.

## Correction

Reuse the existing Executive Writer quality validator and remove only the standalone `ช่องทางอื่น` token from the Data Ops recommendation pattern.

Preserve all existing guards for actual Data Ops recommendations and all full-channel signal, internal-language, comparison-language, Strengths and Weaknesses quality gates.

No Prompt, evidence shape, factual report, AI identity, Lark Automation or Notification contract changes are required.

## Regression

- legitimate cross-channel business analysis containing `ช่องทางอื่นที่มีข้อมูล` must pass the base Executive Writer quality gate;
- actual Data Ops advice such as `รอข้อมูลจากช่องทางอื่นให้ครบ` must still fail with `recommendations_contains_data_ops`.

## Safety and post-merge sequence

Repository-only change. No Lark record mutation, Native AI trigger, Queue send, Worker deployment, Schedule activation or Production action.

After merge, recover the already-generated retained synthesis with `--recover` only. Required recovery invariants:

```text
recordWriteCount = 0
triggerWriteCount = 0
aiCallsByOperator = 0
notificationCount = 0
```

If recovery passes, run the existing Notification command in `--preview` mode. Do not execute a fresh synthesis identity and do not send a group message until the preview is reviewed.
