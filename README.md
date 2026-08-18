# Social Marketing Integration

Repository สำหรับ Social MKT Data Hub และ integration workers ของหลายช่องทาง โดยงาน Customer Base Full Parity ปัจจุบันใช้ local Lark `.base` export เป็น migration authority และรักษา customer resources เดิมแบบ fail-closed.

## Customer Base Full Parity — current safety rules

- Source authority: latest pinned local `.base` export; Live Source Base ไม่ใช่ migration gate.
- Target: existing customer Base `✨Marketing Content Calendar`.
- Existing unrelated customer tables ห้าม overwrite/delete.
- `🎵 RAW_TikTok_Creator_Videos` เป็น Protected Existing Table: ห้าม create ทับ, rename, delete, create/update Field, create/update Record, create/update View/Filter/Sort หรือเปลี่ยน Sync configuration. Preview ต้องพิสูจน์ `reuse_exact`; ถ้าไม่ exact ให้ block Apply.
- Apply ยัง BLOCKED จน clone/remap/verifier coverage ครบทุก dimension ใน export.
- Secrets อยู่เฉพาะ local ignored env files/process environment และห้าม commit.

Authority/status ล่าสุดดูที่ `docs/current-task.md` และ `docs/project-brain/customer-base-consolidation-v1.md`.
