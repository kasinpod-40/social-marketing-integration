/**
 * Compatibility re-export สำหรับ Connector ที่ยัง Import จาก Path เดิม
 * Logic วันที่จริงอยู่ใน Shared layer เพื่อไม่ให้ Domain/Application พึ่งพา Connector layer
 */
export {
  bangkokDateToEpochMilliseconds,
  toEpochMilliseconds,
} from '../../../shared/src/date/date-time.js';
