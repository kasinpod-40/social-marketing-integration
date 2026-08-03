# Lark Native AI Target Group Name v1

## Decision

ผู้ใช้ยืนยันให้ใช้กลุ่ม Lark จริงชื่อ:

```text
Social MKT Executive Reports
```

แทนชื่อที่เคยกำหนดไว้ก่อนหน้า:

```text
📊 Social MKT Executive Reports — Integration Workspace
```

## Scope

- เปลี่ยน exact destination-name contract ให้ตรงกับกลุ่มจริงที่มี `Social MKT Sync` เป็น Group Bot แล้ว
- รักษาการ resolve แบบ exact name และ hash-only destination verification เดิม
- ไม่เปลี่ยน raw `group_id`, ไม่ใช้ Incoming Webhook และไม่เปิด notification
- ไม่สร้างหรือเปิด Workflow ในงานนี้
- ไม่แก้ Records, D1, Queue, Worker, Provider, Schedule หรือ Production

## Required result

Readiness รอบถัดไปต้องพบ:

```text
exactNameMatchCount = 1
resolved            = true
```

จากนั้นอาจเหลือ blocker เดียวคือ `SETTINGS_GROUP_ID_MISSING` ซึ่งต้องแก้ด้วย destination binding แบบควบคุมในขั้นแยกต่างหาก

## Safety

```text
REMOTE_LARK_WRITE       = 0
WORKFLOW_CREATE         = 0
WORKFLOW_UPDATE         = 0
WORKFLOW_STATUS_CHANGE  = 0
NOTIFICATION            = 0
WEBHOOK                 = 0
SCHEDULE                = DISABLED
PRODUCTION              = BLOCKED
```
