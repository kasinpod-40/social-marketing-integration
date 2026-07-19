# Multi-channel Large-account Activation Gate

ทุก Connector ต้องรองรับบัญชีที่มีข้อมูลจำนวนมากตั้งแต่ก่อนเปิด Production ไม่ใช่ผ่านเพียง fixture ขนาดเล็กหรือ happy path.

## Required gates

1. Initial full backfill
2. Incremental sync
3. Periodic full reconciliation
4. Bounded pagination
5. Durable resume หลัง Queue/API failure
6. Bounded chunking และ memory usage
7. Stable-key idempotency
8. Completeness accounting (`expected/fetched/processed/written/failed`)
9. Rate-limit-aware retry/backoff
10. Large-account fixture ตามเป้าขั้นต่ำ
11. Live account UAT ด้วยทรัพยากรเจ้าของบัญชีจริง

Production runtime ต้องปฏิเสธ Connector ที่ `largeAccount.productionReady !== true` ด้วย `MKT_CONNECTOR_LARGE_ACCOUNT_UAT_PENDING`.

## Current targets

| Connector | Target | Current status | Missing before Production |
|---|---:|---|---|
| YouTube | 1,000 videos | `dev_ready` | Customer-owned Live UAT |
| TikTok | 1,000 videos | `foundation_ready` | Durable resume, large fixture, Live UAT |
| Instagram | 2,000 posts | `planned` | Implementation และทุก gate |
| Facebook | 5,000 posts | `planned` | Implementation และทุก gate |
| WooCommerce | 5,000 orders | `planned` | Implementation และทุก gate |
| Chatwoot | 5,000 conversations | `planned` | Implementation และทุก gate |

DEV สามารถเปิด Connector ที่เป็น `foundation_ready` หรือ `dev_ready` เพื่อทดสอบได้ แต่ห้ามตีความเป็น Production ready. Connector ใหม่ต้องใช้ Shared pagination/resume/completeness contracts และห้ามสร้าง state machine ซ้ำโดยไม่จำเป็น.
