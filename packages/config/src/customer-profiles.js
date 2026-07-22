import { resolveConnectorRuntimeConfig } from './connector-runtime-config.js';
import { permanentError } from '../../shared/src/errors/runtime-error.js';

/**
 * โปรไฟล์ Runtime ที่ไม่เป็นความลับ
 *
 * หลักถาวรของโปรเจกต์:
 * - ก่อน Production มี Integration Workspace เพียงชุดเดียวบนทรัพยากรของผู้พัฒนา
 * - Workspace เดียวนี้ประกอบระบบครบทั้ง Connector, Worker, Queue, D1, Lark, Report, AI และ Notify
 * - แหล่งข้อมูลของแต่ละ Connector อาจเป็นของผู้พัฒนาหรือลูกค้าได้ชั่วคราว โดยระบุ Ownership รายช่องทาง
 * - ห้ามสร้างโหมด DEV/UAT แยกกันหรือสลับ Profile ไปมาเพื่อทดสอบแต่ละช่องทาง
 * - เมื่อ Connector ของลูกค้าพร้อม ให้หยุดช่องทางนั้น ลบข้อมูลทดแทนตามขอบเขต Source แล้วเปลี่ยน Source/Credential ใน Workspace เดิม
 * - Production ใช้ทรัพยากรทุกส่วนที่ลูกค้าเป็นเจ้าของและเชิญผู้พัฒนาเข้าไปดูแล
 * - Token, Secret, API key, Password และ Platform account ID จริงต้องมาจาก Environment/Secret Manager
 */
const CUSTOMER_PROFILES = Object.freeze({
  integration_workspace: freezeProfile({
    profileKey: 'integration_workspace',
    environment: 'development',
    customerKey: 'chemistry_k',
    customerName: 'MKT Integration Workspace — Chemistry K target',
    // resourceOwner คงไว้เป็น Compatibility alias ของ infrastructureOwner
    resourceOwner: 'developer',
    infrastructureOwner: 'developer',
    sourceAssetOwner: 'mixed',
    dataOwner: 'mixed',
    dataMode: 'mixed_source_integration',
    businessType: 'online_chemistry_course',
    workspacePurpose: 'assemble_full_system_before_customer_owned_production',
    connectors: {
      tiktok: {
        enabledByDefault: true,
        accountKey: 'chemistry_k',
        sourceHandle: 'chemistry_k',
        sourceOwner: 'customer',
        sourceRole: 'customer_real',
        replacementRequired: false,
        displayLabel: 'TikTok Integration — Chemistry K source',
      },
      facebook: {
        enabledByDefault: false,
        accountKey: 'thanakirin_farm',
        sourceOwner: 'developer',
        sourceRole: 'temporary_substitute',
        replacementRequired: true,
        displayLabel: 'Facebook Integration — temporary developer source',
      },
      instagram: {
        enabledByDefault: false,
        accountKey: 'thanakirin_farm',
        sourceOwner: 'developer',
        sourceRole: 'temporary_substitute',
        replacementRequired: true,
        displayLabel: 'Instagram Integration — temporary developer source',
      },
      youtube: {
        enabledByDefault: false,
        accountKey: 'thanakirin_farm',
        sourceOwner: 'developer',
        sourceRole: 'temporary_substitute',
        replacementRequired: true,
        displayLabel: 'YouTube Integration — temporary developer source',
      },
      google_ads: {
        enabledByDefault: false,
        accountKey: 'chemistry_k',
        sourceOwner: 'customer',
        sourceRole: 'customer_real',
        replacementRequired: false,
        displayLabel: 'Google Ads Integration — Chemistry K source',
      },
      woocommerce: {
        enabledByDefault: false,
        accountKey: 'chemistry_k',
        sourceOwner: 'customer',
        sourceRole: 'customer_real',
        replacementRequired: false,
        displayLabel: 'WooCommerce Integration — Chemistry K source',
      },
      chatwoot: {
        enabledByDefault: false,
        accountKey: 'chemistry_k',
        sourceOwner: 'customer',
        sourceRole: 'customer_real',
        replacementRequired: false,
        displayLabel: 'Chatwoot Integration — Chemistry K source',
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
    workspacePurpose: 'customer_owned_production',
    connectors: {
      tiktok: customerConnector({
        enabledByDefault: true,
        sourceHandle: 'chemistry_k',
        displayLabel: 'TikTok - Chemistry K',
      }),
      facebook: customerConnector({ displayLabel: 'Facebook - Chemistry K' }),
      instagram: customerConnector({ displayLabel: 'Instagram - Chemistry K' }),
      youtube: customerConnector({ displayLabel: 'YouTube - Chemistry K' }),
      google_ads: customerConnector({ displayLabel: 'Google Ads - Chemistry K' }),
      woocommerce: customerConnector({ displayLabel: 'WooCommerce - Chemistry K' }),
      chatwoot: customerConnector({ displayLabel: 'Chatwoot - Chemistry K' }),
    },
  }),
});

/**
 * Compatibility aliases ป้องกัน Config เดิมล้มระหว่างเปลี่ยนชื่อเท่านั้น
 * ทั้งสองชื่อชี้เข้า Integration Workspace เดียวกันและไม่ใช่ Operating mode แยกกัน
 */
const LEGACY_PROFILE_ALIASES = Object.freeze({
  dev_ft_pumkin: 'integration_workspace',
  uat_chemistry_k: 'integration_workspace',
});

const SUPPORTED_ENVIRONMENTS = Object.freeze(['development', 'production']);

/**
 * โหลด Runtime Profile จาก Environment โดยตรวจคู่ Environment/Profile และ Feature flags
 * `development` เป็น Technical isolation label ของ Cloudflare เท่านั้น; งานก่อน Production ใช้
 * `integration_workspace` ตัวเดียวและระบุ Source ownership แยกราย Connector
 */
export function loadCustomerRuntimeConfig(env) {
  const source = env ?? {};
  const environment = requireChoice(source.MKT_ENV, 'MKT_ENV', SUPPORTED_ENVIRONMENTS);
  const requestedProfileKey = requireText(source.MKT_CUSTOMER_PROFILE, 'MKT_CUSTOMER_PROFILE');
  const profileKey = normalizeCustomerProfileKey(requestedProfileKey);
  const profile = CUSTOMER_PROFILES[profileKey];

  if (!profile) {
    throw permanentError(`Unknown MKT_CUSTOMER_PROFILE=${requestedProfileKey}. Supported profiles: ${Object.keys(CUSTOMER_PROFILES).join(', ')}`, {
      code: 'MKT_RUNTIME_CONFIG_INVALID',
      details: { fieldName: 'MKT_CUSTOMER_PROFILE', profileKey: requestedProfileKey },
    });
  }

  if (profile.environment !== environment) {
    throw permanentError(
      `Invalid runtime pairing: MKT_ENV=${environment} cannot use MKT_CUSTOMER_PROFILE=${requestedProfileKey}; expected MKT_ENV=${profile.environment}`,
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
    profileAliasUsed: requestedProfileKey !== profileKey,
    customerKey: profile.customerKey,
    customerName: profile.customerName,
    resourceOwner: profile.resourceOwner,
    infrastructureOwner: profile.infrastructureOwner ?? profile.resourceOwner,
    sourceAssetOwner: profile.sourceAssetOwner ?? profile.resourceOwner,
    dataOwner: profile.dataOwner ?? profile.resourceOwner,
    dataMode: profile.dataMode ?? null,
    businessType: profile.businessType ?? null,
    workspacePurpose: profile.workspacePurpose ?? null,
    connectors,

    // Alias ชั่วคราวเพื่อรักษา Compatibility กับ TikTok use case เดิม
    // โค้ดใหม่ควรอ่านผ่าน runtimeConfig.connectors.tiktok
    tiktok: connectors.tiktok,
  });
}

/** Normalize legacy pre-Production profile names into the single Integration Workspace identity. */
export function normalizeCustomerProfileKey(profileKey) {
  const key = requireText(profileKey, 'profileKey');
  return LEGACY_PROFILE_ALIASES[key] ?? key;
}

/** คืนเฉพาะ Profile ที่เป็น Operating model จริง ไม่คืน Compatibility aliases */
export function listCustomerProfiles() {
  return Object.freeze(Object.keys(CUSTOMER_PROFILES));
}

function customerConnector(input = {}) {
  return {
    enabledByDefault: input.enabledByDefault === true,
    accountKey: 'chemistry_k',
    sourceHandle: input.sourceHandle ?? null,
    sourceOwner: 'customer',
    sourceRole: 'customer_real',
    replacementRequired: false,
    displayLabel: input.displayLabel ?? null,
  };
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
