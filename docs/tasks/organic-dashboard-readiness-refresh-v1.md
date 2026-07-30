# Organic Dashboard Readiness Refresh v1

## Objective

นำ Contract 17 Organic metrics และ 3 Lark readiness fields ที่ Merge แล้วไปใช้กับ Stable Report
1D/3D/7D/30D เดิม โดยไม่สร้าง Report ID ใหม่ ไม่แก้ Records ด้วยมือ และไม่สร้าง Synthetic history.

## Exact sequence

```text
Report Finalizer
→ Additive schema apply/readback for metric_scope, availability_status, availability_message
→ 1D stabilized refresh + same-job replay + all-false restore
→ fresh D1/Lark readiness verification
→ 3D stabilized refresh + verification
→ 7D stabilized refresh + verification
→ 30D stabilized refresh + verification
→ aggregate four verified windows
```

ทุก Window ใช้ `scripts/report-runtime-stabilized-closeout.mjs` และ Shared Report
Queue/D1/Lark writer เดิม. Wrapper ไม่มี Direct deploy, Queue API, D1 write หรือ Lark write.

## Refresh authorization

Generic Report refresh ยังคงอนุญาต 3D/7D เหมือนเดิม. 1D/30D เปิดได้เฉพาะ exact environment value:

```text
MKT_REPORT_RUNTIME_REFRESH_AUTHORIZATION=
AUTHORIZE_ORGANIC_DASHBOARD_READINESS_REFRESH_1D_3D_7D_30D
```

Value นี้ถูกส่งภายใน one-command operator หลังผู้ใช้ตั้ง confirmation หลักเท่านั้น.

## Per-window acceptance

```text
operation                         refresh
Stable report ID                  unchanged
D1 materialization rows           1
Metric rows                        17
Value mismatch                     0
Readiness metadata mismatch        0
Scope counts                       period=6 / current=6 / quality=5
Current totals                     finite + available
Data readiness                     finite + available
Incomplete Period deltas           null + baseline_incomplete + N/A message
Replay                             same report/checksum/Lark rows
Worker                             all flags false after closeout
Provider calls                     0
```

## Resume contract

- Closeout summary + readiness verification ครบทั้งคู่: reuse ได้โดยไม่ Deploy/Queue.
- มีเพียงไฟล์ใดไฟล์หนึ่ง: Fail closed.
- มี attempt files แต่ Summary ยังไม่ครบ: Fail closed และต้องวิเคราะห์ก่อน Recovery.
- ห้ามลบ Evidence หรือรัน Generic closeout ซ้ำเอง.

## Safety

```text
Business-fact delete       forbidden
Manual D1/Lark editing     forbidden
Synthetic history          forbidden
Schedules/AI               disabled
Production                 blocked
Automatic safe restore     required after every Window
```
