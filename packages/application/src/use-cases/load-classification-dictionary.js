import { analyzeClassificationDictionaryRecords } from '../services/classification-dictionary.js';

/**
 * โหลด Rule ที่ลูกค้าแก้ไขได้จาก MKT_Classification_Dictionary แล้วแปลงเป็น Rule พร้อมใช้
 * Table นี้เป็น Master configuration จึงต้องอ่านทุก Record ที่เปิดใช้งานในแต่ละรอบ Prepare
 */
export async function loadClassificationDictionary(input) {
  const repository = requireRepository(input?.repository);
  const tableId = requireText(input?.tableId, 'tableId');
  const analysis = await loadClassificationDictionaryAnalysis({ repository, tableId });
  return analysis.rules;
}

/** โหลด Dictionary พร้อม Invalid-row diagnostics สำหรับ Preflight/Write readiness */
export async function loadClassificationDictionaryAnalysis(input) {
  const repository = requireRepository(input?.repository);
  const tableId = requireText(input?.tableId, 'tableId');
  const records = await repository.listAll(tableId);
  return analyzeClassificationDictionaryRecords(records);
}

/** ตรวจ Repository contract ขั้นต่ำสำหรับการอ่าน Master table */
function requireRepository(repository) {
  if (typeof repository?.listAll !== 'function') {
    throw new TypeError('loadClassificationDictionary requires repository.listAll');
  }
  return repository;
}

/** บังคับ Table ID เป็นข้อความที่ไม่ว่าง */
function requireText(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`loadClassificationDictionary requires ${fieldName}`);
  }
  return value.trim();
}
