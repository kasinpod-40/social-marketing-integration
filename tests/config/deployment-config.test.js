import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

/**
 * อ่านตัวอย่าง Wrangler ของ Sync Worker เป็นข้อความ
 * เพราะไฟล์ JSONC มีคอมเมนต์ภาษาไทยและไม่ควรถูก Parse ด้วย JSON.parse โดยตรง
 */
async function readSyncWranglerExample() {
  return readFile(new URL('../../deploy/wrangler.sync.example.jsonc', import.meta.url), 'utf8');
}

test('sync queue consumer is pinned to one concurrent invocation until a distributed lock exists', async () => {
  const configText = await readSyncWranglerExample();

  // Guard นี้ป้องกันการลบ max_concurrency โดยไม่ตั้งใจ ซึ่งอาจเปิดให้สอง Consumer
  // วาง Plan จาก Stable key เดียวกันพร้อมกันและ Batch Create ข้อมูลซ้ำได้
  assert.match(configText, /"max_concurrency"\s*:\s*1\b/);
});
