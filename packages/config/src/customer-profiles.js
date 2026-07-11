import { permanentError } from '../../shared/src/errors/runtime-error.js';

/**
 * โปรไฟล์ลูกค้าและสภาพแวดล้อมที่ไม่เป็นความลับ
 *
 * หมายเหตุสำคัญ:
 * - เก็บเฉพาะชื่อ, key, mapping และค่าเริ่มต้นที่ไม่ใช่ความลับไว้ในโค้ด
 * - Token, Secret, API Key และรหัสผ่านต้องมาจาก Environment/Secret Manager เท่านั้น
 * - accountKey เป็นส่วนหนึ่งของ Stable Key ห้ามเปลี่ยนหลังเริ่มใช้งานจริง
 */
const CUSTOMER_PROFILES = Object.freeze({
  dev_ft_pumkin: Object.freeze({
    profileKey: 'dev_ft_pumkin',
    environment: 'development',
    customerKey: 'dev_ft_pumkin',
    customerName: 'Development - FT Pumkin',
    resourceOwner: 'developer',
    tiktok: Object.freeze({
      // Stable account key สำหรับข้อมูลทดสอบของผู้พัฒนา
      accountKey: 'ft_pumkin',
      // Handle จริงที่ Lark Native Connector ดึงมาใน Base สำหรับพัฒนา
      sourceHandle: 'ft.pumkin',
    }),
  }),

  chemistry_k: Object.freeze({
    profileKey: 'chemistry_k',
    environment: 'production',
    customerKey: 'chemistry_k',
    customerName: 'Chemistry K',
    resourceOwner: 'customer',
    businessType: 'online_chemistry_course',
    tiktok: Object.freeze({
      // Stable account key ของลูกค้า ใช้สร้าง canonical key ตอน Production
      accountKey: 'chemistry_k',
      // Handle Production ที่คาดหวัง เตรียมไว้ล่วงหน้าและไม่ต้องแก้ source code ตอน Deploy
      sourceHandle: 'chemistry_k',
    }),
    connectors: Object.freeze({
      facebook: true,
      instagram: true,
      youtube: true,
      chatwoot: true,
      woocommerce: true,
    }),
  }),
});

const SUPPORTED_ENVIRONMENTS = Object.freeze(['development', 'production']);

/**
 * โหลด Runtime Profile จาก Environment โดยตรวจว่าคู่ environment/profile ถูกต้อง
 * เพื่อป้องกันการใช้ทรัพยากร Dev ปนกับ Production
 */
export function loadCustomerRuntimeConfig(env) {
  const source = env ?? {};
  const environment = requireChoice(source.MKT_ENV, 'MKT_ENV', SUPPORTED_ENVIRONMENTS);
  const profileKey = requireText(source.MKT_CUSTOMER_PROFILE, 'MKT_CUSTOMER_PROFILE');
  const profile = CUSTOMER_PROFILES[profileKey];

  if (!profile) {
    throw permanentError(`Unknown MKT_CUSTOMER_PROFILE=${profileKey}. Supported profiles: ${Object.keys(CUSTOMER_PROFILES).join(', ')}`, {
      code: 'MKT_RUNTIME_CONFIG_INVALID',
      details: { fieldName: 'MKT_CUSTOMER_PROFILE', profileKey },
    });
  }

  if (profile.environment !== environment) {
    throw permanentError(
      `Invalid runtime pairing: MKT_ENV=${environment} cannot use MKT_CUSTOMER_PROFILE=${profileKey}; expected MKT_ENV=${profile.environment}`,
      {
        code: 'MKT_RUNTIME_CONFIG_INVALID',
        details: { environment, profileKey, expectedEnvironment: profile.environment },
      },
    );
  }

  return Object.freeze({
    environment,
    profileKey,
    customerKey: profile.customerKey,
    customerName: profile.customerName,
    resourceOwner: profile.resourceOwner,
    businessType: profile.businessType ?? null,
    tiktok: Object.freeze({ ...profile.tiktok }),
    connectors: Object.freeze({ ...(profile.connectors ?? {}) }),
  });
}

/** คืนรายชื่อ Profile ที่เตรียมใน Source code สำหรับหน้า Admin/Test โดยไม่เปิดเผย Secret */
export function listCustomerProfiles() {
  return Object.freeze(Object.keys(CUSTOMER_PROFILES));
}

/** บังคับค่าให้เป็นหนึ่งในตัวเลือกที่รองรับ */
function requireChoice(value, fieldName, choices) {
  const text = requireText(value, fieldName);
  if (!choices.includes(text)) {
    throw permanentError(`${fieldName} must be one of: ${choices.join(', ')}`, {
      code: 'MKT_RUNTIME_CONFIG_INVALID',
      details: { fieldName },
    });
  }
  return text;
}

/** บังคับข้อความ Config ที่ไม่ว่างและตัดช่องว่างหัวท้าย */
function requireText(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw permanentError(`Missing ${fieldName}`, {
      code: 'MKT_RUNTIME_CONFIG_INVALID',
      details: { fieldName },
    });
  }
  return value.trim();
}
