/**
 * ข้อผิดพลาดมาตรฐานของระบบที่ระบุได้ชัดว่าควร Retry หรือไม่
 *
 * หลักการ:
 * - retryable=true ใช้เฉพาะเหตุการณ์ชั่วคราว เช่น Network, Timeout, 429 หรือ 5xx
 * - retryable=false ใช้กับข้อมูล/Config/Schema/Business rule ที่ Retry แล้วไม่หายเอง
 * - code เป็นรหัสคงที่สำหรับ Log, Alert และการทดสอบ โดยไม่ต้องจับจากข้อความ
 */
export class RuntimeError extends Error {
  /**
   * @param {string} message ข้อความที่อธิบายสาเหตุให้ผู้พัฒนาอ่านได้
   * @param {Object} [options] ตัวเลือกประกอบข้อผิดพลาด
   * @param {string} [options.code] รหัสคงที่สำหรับการจัดกลุ่มข้อผิดพลาด
   * @param {boolean} [options.retryable] ระบุว่าการ Retry ภายหลังมีโอกาสสำเร็จหรือไม่
   * @param {unknown} [options.cause] ข้อผิดพลาดต้นทางตามมาตรฐาน Error.cause
   * @param {Record<string, unknown>} [options.details] รายละเอียดที่ปลอดภัยต่อการเขียน Log
   */
  constructor(message, options = {}) {
    super(requireMessage(message), { cause: options.cause });
    this.name = 'RuntimeError';
    this.code = normalizeCode(options.code ?? 'RUNTIME_ERROR');
    this.retryable = options.retryable === true;
    this.details = freezeDetails(options.details);
  }
}

/**
 * สร้างข้อผิดพลาดถาวรสำหรับปัญหาที่ต้องแก้ข้อมูลหรือ Config ก่อนจึงจะรันใหม่ได้
 */
export function permanentError(message, options = {}) {
  return new RuntimeError(message, {
    ...options,
    retryable: false,
  });
}

/**
 * สร้างข้อผิดพลาดชั่วคราวสำหรับปัญหาที่ระบบ Queue สามารถ Retry ภายหลังได้
 */
export function transientError(message, options = {}) {
  return new RuntimeError(message, {
    ...options,
    retryable: true,
  });
}

/**
 * ตรวจว่าข้อผิดพลาดถูกประกาศอย่างชัดเจนว่า Retry ได้หรือไม่
 * ข้อผิดพลาดทั่วไปที่ไม่มีสถานะจะไม่ Retry โดยอัตโนมัติ เพื่อลด Retry loop จาก bug ในโค้ด
 */
export function isRetryableError(error) {
  return error?.retryable === true;
}

/**
 * แปลงข้อความว่างหรือค่าที่ไม่ใช่ข้อความให้เป็นข้อผิดพลาดตั้งแต่ต้นทาง
 */
function requireMessage(value) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new TypeError('RuntimeError requires a non-empty message');
  }

  return value.trim();
}

/**
 * ทำให้รหัสข้อผิดพลาดอยู่ในรูปแบบตัวพิมพ์ใหญ่ที่ค้นหาใน Log ได้ง่าย
 */
function normalizeCode(value) {
  const code = typeof value === 'string' ? value.trim().toUpperCase() : '';
  return code || 'RUNTIME_ERROR';
}

/**
 * ป้องกันผู้เรียกแก้ไขรายละเอียดข้อผิดพลาดหลังจากส่งเข้า Log แล้ว
 */
function freezeDetails(value) {
  if (value === null || value === undefined) return Object.freeze({});
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('RuntimeError details must be an object');
  }

  return Object.freeze({ ...value });
}
