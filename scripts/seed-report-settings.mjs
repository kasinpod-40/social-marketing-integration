import { seedReportSettings } from '../packages/application/src/use-cases/seed-report-settings.js';
import { createLocalLarkRuntime, printJson } from './lib/lark-runtime.js';

// คำสั่งนี้เขียนข้อมูลจริง จึงต้องยืนยันจาก Shell ทุกครั้งและไม่อ่านค่าจาก .dev.vars อัตโนมัติ
if (process.env.CONFIRM_WRITE !== 'YES') {
  throw new Error('Refusing to write to Lark. Run with CONFIRM_WRITE=YES npm run seed:report-settings');
}

// ใช้ Customer profile จาก Environment เพื่อ Seed Account/Setting ของลูกค้าถูกชุดโดยไม่แก้ Source code
const profileKey = process.env.MKT_CUSTOMER_PROFILE;
if (typeof profileKey !== 'string' || profileKey.trim() === '') {
  throw new Error('MKT_CUSTOMER_PROFILE is required');
}

const runtime = await createLocalLarkRuntime(['mktReportSettings']);
const result = await seedReportSettings({
  repository: runtime.repository,
  syncEngine: runtime.syncEngine,
  tableId: runtime.tables.mktReportSettings,
  profileKey: profileKey.trim(),
});

printJson(result);
