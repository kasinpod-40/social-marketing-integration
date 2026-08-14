import { YOUTUBE_LARK_BLUEPRINT } from './youtube-organic-blueprint.js';
import { LARK_TABLE_ENV } from './lark-table-config.js';
import { permanentError } from '../../shared/src/errors/runtime-error.js';

export const YOUTUBE_LARK_SCHEMA_VERSION = 'youtube-d1-raw-customer-lark-v2';

const TABLE_PRESENTATION = Object.freeze({
  rawYouTubeChannels: Object.freeze({
    createName: '📺 RAW_YouTube_Channels',
    aliases: Object.freeze(['RAW_YouTube_Channels', '📺 RAW_YouTube_Channels', '🧪 RAW_YouTube_Channels']),
    defaultViewName: '📋 All Channels',
  }),
  rawYouTubeVideos: Object.freeze({
    createName: '🎬 RAW_YouTube_Videos',
    aliases: Object.freeze(['RAW_YouTube_Videos', '🎬 RAW_YouTube_Videos', '🧪 RAW_YouTube_Videos']),
    defaultViewName: '📋 All Videos',
  }),
  rawYouTubeAnalyticsDaily: Object.freeze({
    createName: '📊 RAW_YouTube_Analytics_Daily',
    aliases: Object.freeze(['RAW_YouTube_Analytics_Daily', '📊 RAW_YouTube_Analytics_Daily', '🧪 RAW_YouTube_Analytics_Daily']),
    defaultViewName: '📋 All Analytics',
  }),
});

// Live tenant ยืนยันว่า formatter นี้แสดงทั้งวันและเวลา และเป็นค่าเดียวกับ
// MKT_Content.published_at ที่ใช้งานจริงอยู่แล้ว เหมาะกับ Audit/Sync timestamps
const AUDIT_DATETIME_PROPERTY = Object.freeze({
  date_formatter: 'yyyy/MM/dd HH:mm',
  auto_fill: false,
});

// Presentation contract ภาษาไทยสำหรับ Field info ใน Lark UI แยกจาก Source semantics ใน Blueprint
// เพื่อให้เอกสารต้นทางคงศัพท์ API ที่ตรวจทานแล้ว แต่ผู้ใช้งาน Base อ่านคำอธิบายได้ทันที
const FIELD_DESCRIPTIONS_TH = deepFreeze({
  rawYouTubeChannels: {
    raw_channel_key: 'คีย์คงที่ของข้อมูลช่องแบบสถานะล่าสุด ใช้ Upsert และไม่เพิ่มแถวตาม fetched_at',
    channel_id: 'รหัสช่อง YouTube ภายนอก ใช้ตรวจสอบตัวตนก่อนเขียนข้อมูล',
    title: 'ชื่อช่องล่าสุดที่ได้รับจาก YouTube',
    uploads_playlist_id: 'รหัสเพลย์ลิสต์ Uploads หากไม่มีต้องหยุดก่อนเริ่ม Sync',
    view_count: 'ยอดดูสะสมของช่อง หาก Source ไม่ส่งค่าให้เก็บเป็นค่าว่าง',
    subscriber_count: 'จำนวนผู้ติดตามที่ Source เปิดเผย หากซ่อนหรือไม่ส่งค่าให้เก็บเป็นค่าว่าง',
    subscriber_count_hidden: 'ระบุว่า Source ซ่อนจำนวนผู้ติดตามของช่องหรือไม่',
    video_count: 'จำนวนวิดีโอสะสมของช่อง หาก Source ไม่ส่งค่าให้เก็บเป็นค่าว่าง',
    fetched_at: 'เวลาที่ดึงข้อมูลจาก API ในรูปแบบ UTC',
    source_payload_json: 'Payload สำหรับตรวจสอบย้อนหลัง หลังตัด Credential และข้อมูลลับออกแล้ว',
  },
  rawYouTubeVideos: {
    raw_video_key: 'คีย์คงที่ของวิดีโอแบบสถานะล่าสุด ใช้ Upsert และไม่เพิ่มแถวตาม fetched_at',
    channel_id: 'รหัสช่องเจ้าของวิดีโอ ต้องตรงกับช่องที่ตั้งค่าไว้',
    video_id: 'รหัสวิดีโอ YouTube ภายนอก ต้องเก็บเป็นข้อความและห้ามแปลงเป็นตัวเลข',
    published_at: 'วันและเวลาเผยแพร่วิดีโอในรูปแบบ UTC',
    title: 'ชื่อวิดีโอจาก Source ใช้ร่วมกับคำอธิบายเพื่อสร้าง Caption กลาง',
    description: 'คำอธิบายวิดีโอจาก Source อนุญาตให้เป็นค่าว่าง',
    video_url: 'ลิงก์หน้ารับชมวิดีโอ YouTube แบบมาตรฐาน',
    thumbnail_url: 'ลิงก์ภาพตัวอย่างที่มีคุณภาพดีที่สุดจาก Source',
    duration_seconds: 'ความยาววิดีโอเป็นวินาที ต้องไม่ติดลบ',
    view_count: 'ยอดดูสะสมของวิดีโอ หาก Source ไม่ส่งค่าให้เก็บเป็นค่าว่าง',
    like_count: 'ยอดถูกใจสะสมของวิดีโอ หาก Source ไม่ส่งค่าให้เก็บเป็นค่าว่าง',
    comment_count: 'ยอดความคิดเห็นสะสมของวิดีโอ หาก Source ไม่ส่งค่าให้เก็บเป็นค่าว่าง',
    privacy_status: 'สถานะ public, unlisted หรือ private เฉพาะเมื่อ Source ส่งค่าชัดเจน',
    etag: 'ค่า Fingerprint จาก Source สำหรับช่วยตรวจการเปลี่ยนแปลง ไม่ใช่คีย์คงที่',
    last_seen_at: 'เวลาล่าสุดที่พบวิดีโอจาก Source ห้ามเลื่อนเวลาเมื่อวิดีโอหายไป',
    source_availability_status: 'สถานะ available, missing, private, deleted หรือ unknown โดยการไม่พบเพียงอย่างเดียวให้เป็น missing',
    missing_since: 'เวลาที่เริ่มไม่พบวิดีโอครั้งแรก ต้องเก็บ Metrics เดิมและห้ามแทนด้วยศูนย์',
    fetched_at: 'เวลาที่ดึงข้อมูลจาก API ในรูปแบบ UTC',
    source_payload_json: 'Payload สำหรับตรวจสอบย้อนหลัง หลังตัด Credential และข้อมูลลับออกแล้ว',
  },
  rawYouTubeAnalyticsDaily: {
    raw_analytics_daily_key: 'คีย์คงที่ของ Metrics รายวัน ใช้วันที่จาก Source ตามจริง',
    source_metric_date: 'วันที่ YYYY-MM-DD ตามเขตเวลา Pacific เก็บเป็นข้อความเพื่อป้องกันวันที่เลื่อน',
    channel_id: 'รหัสช่อง YouTube ภายนอก ต้องผ่านการตรวจสอบตัวตนก่อนเขียนข้อมูล',
    video_id: 'รหัสวิดีโอ YouTube ภายนอก ต้องเก็บเป็นข้อความและห้ามแปลงเป็นตัวเลข',
    views: 'ยอดดูรายวันจาก Source เก็บค่าปรับย้อนหลังแบบจำนวนเต็มมีเครื่องหมายตามจริง และไม่ใช่ยอดสะสม',
    likes: 'ยอดถูกใจรายวันจาก Source เก็บค่าปรับย้อนหลังแบบจำนวนเต็มมีเครื่องหมายตามจริง หากไม่มีให้เว้นว่าง',
    comments: 'ยอดความคิดเห็นรายวันจาก Source เก็บค่าปรับย้อนหลังแบบจำนวนเต็มมีเครื่องหมายตามจริง หากไม่มีให้เว้นว่าง',
    shares: 'ยอดแชร์รายวันจาก Source เก็บค่าปรับย้อนหลังแบบจำนวนเต็มมีเครื่องหมายตามจริง หากไม่มีให้เว้นว่าง',
    estimated_minutes_watched: 'เวลาในการรับชมรวม หน่วยเป็นนาที หากแปลงเป็นวินาทีให้คูณ 60',
    average_view_duration_seconds: 'ระยะเวลารับชมเฉลี่ย หน่วยจาก Source เป็นวินาทีอยู่แล้ว',
    average_view_percentage: 'เปอร์เซ็นต์การรับชมเฉลี่ยจาก Source ต้องไม่ติดลบ และอาจเกิน 100 เมื่อมีการรับชมซ้ำ',
    fetched_at: 'เวลาที่ดึงข้อมูลจาก API ในรูปแบบ UTC',
    source_payload_json: 'Payload สำหรับตรวจสอบย้อนหลัง หลังตัด Credential และข้อมูลลับออกแล้ว ใช้เฉพาะ RAW ใน Phase 1',
  },
});

/** Contract สำหรับ Preview/Apply สาม YouTube RAW tables โดย derive จาก Blueprint ชุดเดียว */
export const YOUTUBE_LEGACY_RAW_LARK_SCHEMA = deepFreeze(YOUTUBE_LARK_BLUEPRINT.map((table) => {
  const presentation = TABLE_PRESENTATION[table.key];
  if (!presentation) {
    throw permanentError(`Missing YouTube Lark presentation for ${table.key}`, {
      code: 'YOUTUBE_LARK_SCHEMA_INVALID',
      details: { tableKey: table.key },
    });
  }
  const envName = LARK_TABLE_ENV[table.key];
  if (!envName) {
    throw permanentError(`Missing YouTube Lark environment mapping for ${table.key}`, {
      code: 'YOUTUBE_LARK_SCHEMA_INVALID',
      details: { tableKey: table.key },
    });
  }

  return {
    key: table.key,
    createName: presentation.createName,
    aliases: presentation.aliases,
    envName,
    defaultViewName: presentation.defaultViewName,
    logicalName: table.tableName,
    fields: [...table.fields]
      .sort((left, right) => left.order - right.order)
      .map((field) => toInstallerField(table.key, field)),
  };
}));

// YouTube RAW is D1-owned. The customer Base has no YouTube-specific RAW table to provision.
export const YOUTUBE_LARK_SCHEMA = Object.freeze([]);

/** ตรวจ Schema ที่ derive จาก Blueprint เพื่อจับ Field order/Primary/Select contract ก่อนเรียก Lark */
export function validateYouTubeLarkSchema(schema = YOUTUBE_LARK_SCHEMA) {
  if (!Array.isArray(schema) || schema.length !== 0) {
    throw permanentError('YouTube customer Lark schema must not contain RAW tables', {
      code: 'YOUTUBE_LARK_SCHEMA_INVALID',
    });
  }

  const tableKeys = new Set();
  for (const table of schema) {
    if (tableKeys.has(table.key)) throw invalid(`Duplicate YouTube table key: ${table.key}`);
    tableKeys.add(table.key);
    if (!Array.isArray(table.fields) || table.fields.length === 0) {
      throw invalid(`YouTube table ${table.key} has no fields`);
    }
    const primaryFields = table.fields.filter((field) => field.primary === true);
    if (primaryFields.length !== 1 || table.fields[0].primary !== true) {
      throw invalid(`YouTube table ${table.key} must have exactly one Primary field as the first field`);
    }
    const names = new Set();
    for (const field of table.fields) {
      if (names.has(field.fieldName)) throw invalid(`Duplicate field ${table.key}.${field.fieldName}`);
      names.add(field.fieldName);
    }
  }
  return true;
}

function toInstallerField(tableKey, field) {
  const property = field.type === 3
    ? { options: field.options.map((name, index) => ({ name, color: index % 8 })) }
    : field.type === 5
      ? AUDIT_DATETIME_PROPERTY
      : undefined;
  const description = FIELD_DESCRIPTIONS_TH[tableKey]?.[field.fieldName];
  if (!description) {
    throw permanentError(`Missing Thai YouTube field description: ${tableKey}.${field.fieldName}`, {
      code: 'YOUTUBE_LARK_SCHEMA_INVALID',
      details: { tableKey, fieldName: field.fieldName },
    });
  }
  return {
    fieldName: field.fieldName,
    type: field.type,
    uiType: readUiType(field.type),
    primary: field.primary === true,
    description,
    manageDescription: true,
    ...(property ? { property } : {}),
  };
}

function readUiType(type) {
  return ({ 1: 'Text', 2: 'Number', 3: 'SingleSelect', 5: 'DateTime', 7: 'Checkbox', 15: 'Url' })[type]
    ?? `LarkType${type}`;
}

function invalid(message) {
  return permanentError(message, { code: 'YOUTUBE_LARK_SCHEMA_INVALID' });
}

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}
