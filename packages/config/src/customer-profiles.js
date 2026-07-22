import { resolveConnectorRuntimeConfig } from './connector-runtime-config.js';
import { permanentError } from '../../shared/src/errors/runtime-error.js';

/**
 * โปรไฟล์ลูกค้าและสภาพแวดล้อมที่ไม่เป็นความลับ
 *
 * หลักถาวรของโปรเจกต์:
 * - DEV ใช้ Lark Base, Cloudflare และบัญชีทดสอบของผู้พัฒนา
 * - Customer-real UAT ใช้ DEV infrastructure เดิมของผู้พัฒนา โดยเปลี่ยนเฉพาะบัญชีต้นทาง/ข้อมูลเป็นของลูกค้า
 * - Production ใช้ทรัพยากรทุกส่วนที่ลูกค้าเป็นเจ้าของและเชิญผู้พัฒนาเข้าไปดูแล
 * - เก็บเฉพาะชื่อ, Stable key, Mapping และค่าเริ่มต้นที่ไม่เป็นความลับไว้ในโค้ด
 * - Token, Secret, API key, Password และ Platform account ID จริงต้องมาจาก Environment/Secret Manager
 * - accountKey เป็นส่วนหนึ่งของ Canonical key ห้ามเปลี่ยนระหว่าง UAT และ Production
 */
const CUSTOMER_PROFILES = Object.freeze({
  dev_ft_pumkin: freezeProfile({
    profileKey: 'dev_ft_pumkin',
    environment: 'development',
    customerKey: 'dev_ft_pumkin',
    customerName: 'Development - FT Pumkin',
    // resourceOwner คงไว้เป็น Compatibility alias ของ infrastructureOwner
    resourceOwner: 'developer',
    infrastructureOwner: 'developer',
    sourceAssetOwner: 'developer',
    dataOwner: 'developer',
    dataMode: 'developer_test',
    businessType: 'development_sandbox',
    connectors: {
      tiktok: {
        enabledByDefault: true,
        accountKey: 'ft_pumkin',
        sourceHandle: 'ft.pumkin',
        displayLabel: 'TikTok Dev - FT Pumkin',
      },
      facebook: {
        enabledByDefault: false,
        accountKey: 'dev_ft_pumkin',
        displayLabel: 'Facebook Dev - FT Pumkin',
      },
      instagram: {
        enabledByDefault: false,
        accountKey: 'dev_ft_pumkin',
        displayLabel: 'Instagram Dev - FT Pumkin',
      },
      youtube: {
        enabledByDefault: false,
        accountKey: 'dev_ft_pumkin',
        displayLabel: 'YouTube Dev - FT Pumkin',
      },
      google_ads: {
        enabledByDefault: false,
        accountKey: 'dev_ft_pumkin',
        displayLabel: 'Google Ads Dev - FT Pumkin',
      },
      woocommerce: {
        enabledByDefault: false,
        accountKey: 'dev_ft_pumkin',
        displayLabel: 'WooCommerce Dev - FT Pumkin',
      },
      chatwoot: {
        enabledByDefault: false,
        accountKey: 'dev_ft_pumkin',
        displayLabel: 'Chatwoot Dev - FT Pumkin',
      },
    },
  }),

  uat_chemistry_k: freezeProfile({
    profileKey: 'uat_chemistry_k',
    environment: 'development',
    // customerKey/accountKey ต้องตรง Production เพื่อให้ Canonical identity คงเดิมตอน Cutover
    customerKey: 'chemistry_k',
    customerName: 'Chemistry K — Customer-real UAT',
    resourceOwner: 'developer',
    infrastructureOwner: 'developer',
    sourceAssetOwner: 'customer',
    dataOwner: 'customer',
    dataMode: 'customer_real_uat',
    businessType: 'online_chemistry_course',
    connectors: {
      tiktok: {
        // ปิดจนกว่า Lark Native connection และ Exact identity preflight จะผ่าน
        enabledByDefault: false,
        accountKey: 'chemistry_k',
        sourceHandle: null,
        displayLabel: 'TikTok UAT - Chemistry K',
      },
      facebook: {
        enabledByDefault: false,
        accountKey: 'chemistry_k',
        displayLabel: 'Facebook UAT - Chemistry K',
      },
      instagram: {
        enabledByDefault: false,
        accountKey: 'chemistry_k',
        displayLabel: 'Instagram UAT - Chemistry K',
      },
      youtube: {
        enabledByDefault: false,
        accountKey: 'chemistry_k',
        displayLabel: 'YouTube UAT - Chemistry K',
      },
      google_ads: {
        enabledByDefault: false,
        accountKey: 'chemistry_k',
        displayLabel: 'Google Ads UAT - Chemistry K',
      },
      woocommerce: {
        enabledByDefault: false,
        accountKey: 'chemistry_k',
        displayLabel: 'WooCommerce UAT - Chemistry K',
      },
      chatwoot: {
        enabledByDefault: false,
        accountKey: 'chemistry_k',
        displayLabel: 'Chatwoot UAT - Chemistry K',
      },
    },
  }),

  chemistry_k: freezeProfile({
    profileKey: 'chemistry_k',
    environment: 'production',
    customerKey: 'chemistry_k',
    customerName: 'Chemistry K',
    resourceOwner: 'customer',
    infrastructureOwner: 'customer',
    sourceAssetOwner: 'customer',
    dataOwner: 'customer',
    dataMode: 'customer_production',
    businessType: 'online_chemistry_course',
    connectors: {
      tiktok: {
        enabledByDefault: true,
        accountKey: 'chemistry_k',
        sourceHandle: 'chemistry_k',
        displayLabel: 'TikTok - Chemistry K',
      },
      facebook: {
        enabledByDefault: false,
        accountKey: 'chemistry_k',
        displayLabel: 'Facebook - Chemistry K',
      },
      instagram: {
        enabledByDefault: false,
        accountKey: 'chemistry_k',
        displayLabel: 'Instagram - Chemistry K',
      },
      youtube: {
        enabledByDefault: false,
        accountKey: 'chemistry_k',
        displayLabel: 'YouTube - Chemistry K',
      },
      google_ads: {
        enabledByDefault: false,
        accountKey: 'chemistry_k',
        displayLabel: 'Google Ads - Chemistry K',
      },
      woocommerce: {
        enabledByDefault: false,
        accountKey: 'chemistry_k',
        displayLabel: 'WooCommerce - Chemistry K',
      },
      chatwoot: {
        enabledByDefault: false,
        accountKey: 'chemistry_k',
        displayLabel: 'Chatwoot - Chemistry K',
      },
    },
  }),
});

const SUPPORTED_ENVIRONMENTS = Object.freeze(['development', 'production']);

/**
 * โหลด Runtime Profile จาก Environment โดยตรวจคู่ environment/profile และ Feature flags
 * โดย DEV test และ Customer-real UAT ใช้ development environment เดียวกัน แต่แยก logical profile/identity
 * เพื่อป้องกัน Connector ที่ยังไม่พร้อมถูกเปิดใช้และรักษา Stable key ของลูกค้า
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

  const connectors = resolveConnectorRuntimeConfig(profile.connectors, source);

  return Object.freeze({
    environment,
    profileKey,
    customerKey: profile.customerKey,
    customerName: profile.customerName,
    // Compatibility alias: โค้ดใหม่ควรใช้ infrastructureOwner/sourceAssetOwner/dataOwner
    resourceOwner: profile.resourceOwner,
    infrastructureOwner: profile.infrastructureOwner ?? profile.resourceOwner,
    sourceAssetOwner: profile.sourceAssetOwner ?? profile.resourceOwner,
    dataOwner: profile.dataOwner ?? profile.resourceOwner,
    dataMode: profile.dataMode ?? null,
    businessType: profile.businessType ?? null,
    connectors,

    // Alias ชั่วคราวเพื่อรักษา Compatibility กับ TikTok use case เดิม
    // โค้ดใหม่ควรอ่านผ่าน runtimeConfig.connectors.tiktok
    tiktok: connectors.tiktok,
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

/** Freeze Profile และ Connector config ทุกชั้นเพื่อป้องกัน Runtime/Test แก้ค่ากลาง */
function freezeProfile(profile) {
  return Object.freeze({
    ...profile,
    connectors: Object.freeze(Object.fromEntries(
      Object.entries(profile.connectors ?? {}).map(([key, value]) => [key, Object.freeze({ ...value })]),
    )),
  });
}
