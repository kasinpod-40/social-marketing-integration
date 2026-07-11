# 09 — Access and Environments

## Ownership model ที่ใช้จริง

### DEV

- Lark Base, Lark App, Cloud/runtime และบัญชี TikTok ทดสอบเป็นทรัพยากรของผู้พัฒนา
- Runtime profile: `dev_ft_pumkin`
- TikTok source: `@ft.pumkin`
- ใช้เพื่อพัฒนา, Dry run, Regression และ UAT ก่อนติดตั้งลูกค้า

### Production — Chemistry K

- ลูกค้าต้องเป็นเจ้าของ Lark Base, Lark App, Cloudflare/runtime, Secrets และ Platform assets ทั้งหมด
- ผู้พัฒนาได้รับเชิญด้วย Role/IAM ที่เหมาะสม ห้ามแชร์ Password
- Runtime profile `chemistry_k` เตรียมไว้ใน Source codeแล้ว
- Table IDs และ Secret จริงต้องตั้งใน Environment ของลูกค้า ไม่แก้ Source codeตอน Deploy

## Runtime selector

```env
# DEV
MKT_ENV=development
MKT_CUSTOMER_PROFILE=dev_ft_pumkin

# Production
MKT_ENV=production
MKT_CUSTOMER_PROFILE=chemistry_k
```

ระบบต้องหยุดทันทีเมื่อ Environment/Profile จับคู่ไม่ถูกต้อง

## Connector feature flags

```env
MKT_CONNECTOR_TIKTOK_ENABLED=true
MKT_CONNECTOR_FACEBOOK_ENABLED=false
MKT_CONNECTOR_INSTAGRAM_ENABLED=false
MKT_CONNECTOR_YOUTUBE_ENABLED=false
MKT_CONNECTOR_WOOCOMMERCE_ENABLED=false
MKT_CONNECTOR_CHATWOOT_ENABLED=false
```

Connector ที่ยังเป็น `planned` ห้ามเปิดเป็น `true` ระบบจะ Fail ตอนโหลด Runtime config

Identity ที่ขึ้นกับบัญชีจริงเปลี่ยนผ่าน Environment ได้ เช่น:

```env
TIKTOK_SOURCE_HANDLE=ft.pumkin
```

`accountKey` สำหรับ Stable key ยังอยู่ใน Customer profile และห้ามเปลี่ยนหลังเริ่มใช้งานจริง

## Source code กับ Secret

เก็บใน Source codeได้:

- Customer/profile key
- Stable account key
- Connector catalog และ Feature mapping
- Display name ของลูกค้า
- Field/table env mapping
- ค่า default ที่ไม่เป็นความลับ
- คอมเมนต์ภาษาไทย

ห้ามเก็บใน Source code/Git/ZIP/Log:

- App secret, Access token, API key
- Password, Webhook secret
- OAuth refresh token
- Database credentials

## Freelancer constraint

ผู้พัฒนาไม่มีบริษัทจดทะเบียน จึงใช้ Client-owned Production resources เป็นค่าเริ่มต้นสำหรับ Business verification, Developer app review และสิทธิ์ Platform ทางการ
