# Local File-lock Mutation Guard Runbook v0.7.2

Mutation guard ของ Local scripts เป็นแบบ fail-closed เพื่อไม่ให้ Owner เก่าต่ออายุหรือเขียนทับ Lock ของ Owner ใหม่ในช่วง race. หาก Process ถูก kill/crash ระหว่างถือ Guard อาจเหลือไฟล์:

```text
.mkt-locks/<sha256>.lock.guard
```

## ข้อห้าม

- ห้ามรัน Local write พร้อม Cloudflare Cron/Queue write
- ห้ามลบ `.guard` เพียงเพราะเห็นไฟล์อยู่
- ห้ามลบไฟล์ `.lock` ที่ยังมี Lease/Owner ทำงานอยู่

## ขั้นตอนแก้ `LOCAL_SYNC_LOCK_GUARD_BUSY`

1. หยุดคำสั่ง Local sync/write ทุก Terminal.
2. ปิด Scheduled TikTok write ชั่วคราว หรือยืนยันว่าไม่มี Cloud write ที่อาจชนกับการทดสอบ Local.
3. ดูไฟล์ Guard และ Metadata:

```bash
find .mkt-locks -maxdepth 1 -type f -name '*.guard' -print
cat .mkt-locks/<file>.lock.guard
```

4. อ่าน `pid` จาก JSON แล้วตรวจว่า Process ยังอยู่หรือไม่:

```bash
ps -p <pid> -o pid=,ppid=,etime=,command=
```

5. ตรวจซ้ำว่าไม่มี Node/Sync process ที่เกี่ยวข้อง:

```bash
ps aux | grep -E 'sync-tiktok-creator|validate-tiktok-creator|node .*scripts/' | grep -v grep
```

6. เมื่อยืนยันว่า PID ไม่มีอยู่และไม่มี Sync/Write ทำงาน จึงลบเฉพาะ Guard ที่ค้าง:

```bash
rm -- .mkt-locks/<file>.lock.guard
```

7. รัน Validate หรือ Dry-run ก่อนเริ่ม Write ใหม่ และตรวจว่าไม่มี `LOCAL_SYNC_LOCK_GUARD_BUSY`.

## การบันทึกเหตุการณ์

ใน Production/เครื่องทีม ให้บันทึกเวลา, Guard path, PID เดิม, คำสั่งตรวจ Process และผู้อนุมัติก่อนลบ เพื่อรักษา Audit trail.
