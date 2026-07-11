import { seedMetricDefinitions } from '../packages/application/src/use-cases/seed-metric-definitions.js';
import { createLocalLarkRuntime, printJson } from './lib/lark-runtime.js';

// คำสั่งนี้เขียนข้อมูลจริง จึงต้องยืนยันจาก Shell ทุกครั้งและไม่อ่านค่าจาก .dev.vars
if (process.env.CONFIRM_WRITE !== 'YES') {
  throw new Error('Refusing to write to Lark. Run with CONFIRM_WRITE=YES npm run seed:metrics');
}

// สร้าง Runtime เฉพาะตาราง Metric definitions เพื่อลด Environment ที่จำเป็นต่อคำสั่งนี้
const runtime = await createLocalLarkRuntime(['mktMetricDefinitions']);
const result = await seedMetricDefinitions({
  repository: runtime.repository,
  syncEngine: runtime.syncEngine,
  tableId: runtime.tables.mktMetricDefinitions,
});

// แสดงผล Create/Update/Skip ให้ผู้พัฒนาตรวจสอบหลังรัน
printJson(result);
