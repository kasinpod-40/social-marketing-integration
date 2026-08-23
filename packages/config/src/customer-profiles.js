import { resolveConnectorRuntimeConfig } from './connector-runtime-config.js';
import { permanentError } from '../../shared/src/errors/runtime-error.js';

/**
 * โปรไฟล์ Runtime ที่ไม่เป็นความลับ
 *
 * Operating model ปัจจุบัน:
 * - ก่อน Production มี Integration Workspace เพียงชุดเดียวบน Infrastructure ของผู้พัฒนา
 * - Source ownership แยกราย Connector และอาจเป็นของผู้พัฒนากับลูกค้าปะปนกันได้
 * - Production แยกต่างหากและต้องใช้ทรัพยากรที่ลูกค้าเป็นเจ้าของ
 * - accountKey เป็นส่วนหนึ่งของ Canonical Stable key จึงห้ามเปลี่ยนจาก Historical label
 * - Token, Secret, API key, Password และ Platform account ID จริงต้องมาจาก Environment/Secret Manager
 */
const CUSTOMER_PROFILES = Object.freeze({
  integration_workspace: freezeProfile({
    profileKey: 'integration_workspace',
    environment: 'development',
    customerKey: 'chemistry_k',
    customerName: 'Social MKT Data Hub — Integration Workspace',
    // resourceOwner คงไว้เป็น Compatibility alias ของ infrastructureOwner
    resourceOwner: 'developer',
    infrastructureOwner: 'developer',
    sourceAssetOwner: 'mixed',
    dataOwner: 'mixed',
    dataMode: 'integration_workspace_mixed_sources',
    businessType: 'multi_source_marketing_integration',
    connectors: {
      tiktok: {
        // Chemistry K เป็น Source ที่ยืนยันแล้ว แต่ Runtime ต้องเปิดด้วย Feature flag แบบ Manual เท่านั้น
        enabledByDefault: false,
        accountKey: 'chemistry_k',
        sourceHandle: 'chemistry_k',
        displayLabel: 'TikTok Organic — Chemistry K',
      },
      facebook: {
        enabledByDefault: false,
        accountKey: 'chemistry_k',
        displayLabel: 'Facebook Organic — Chemistry K preflight pending',
      },
      instagram: {
        enabledByDefault: false,
        accountKey: 'chemistry_k',
        displayLabel: 'Instagram Organic — Chemistry K preflight pending',
      },
      meta_ads: {
        enabledByDefault: false,
        accountKey: 'chemistry_k',
        displayLabel: 'Meta Ads — Chemistry K reviewed runtime',
      },
      google_ads: {
        enabledByDefault: false,
        accountKey: 'chemistry_k',
        displayLabel: 'Google Ads — Chemistry K signed delivery',
      },
      youtube: {
        enabledByDefault: false,
        accountKey: 'chemistry_k',
        displayLabel: 'YouTube Organic — Chemistry K',
      },
      woocommerce: {
        enabledByDefault: false,
        accountKey: 'chemistry_k',
        displayLabel: 'WooCommerce — Chemistry K pending',
      },
      chatwoot: {
        enabledByDefault: false,
        accountKey: 'chemistry_k',
        displayLabel: 'Chatwoot — Chemistry K reviewed runtime',
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
        // Production connector ต้องเปิดด้วย Environment หลังผ่าน Cutover gate เท่านั้น
        enabledByDefault: false,
        accountKey: 'chemistry_k',
        sourceHandle: 'chemistry_k',
        displayLabel: 'TikTok — Chemistry K',
      },
      facebook: {
        enabledByDefault: false,
        accountKey: 'chemistry_k',
        displayLabel: 'Facebook — Chemistry K',
      },
      instagram: {
        enabledByDefault: false,
        accountKey: 'chemistry_k',
        displayLabel: 'Instagram — Chemistry K',
      },
      meta_ads: {
        enabledByDefault: false,
        accountKey: 'chemistry_k',
        displayLabel: 'Meta Ads — Chemistry K',
      },
      google_ads: {
        enabledByDefault: false,
        accountKey: 'chemistry_k',
        displayLabel: 'Google Ads — Chemistry K',
      },
      youtube: {
        enabledByDefault: false,
        accountKey: 'chemistry_k',
        displayLabel: 'YouTube — Chemistry K',
      },
      woocommerce: {
        enabledByDefault: false,
        accountKey: 'chemistry_k',
        displayLabel: 'WooCommerce — Chemistry K',
      },
      chatwoot: {
        enabledByDefault: false,
        accountKey: 'chemistry_k',
        displayLabel: 'Chatwoot — Chemistry K',
      },
    },
  }),
});

/**
 * Historical labels ยังคงรับได้เพื่อให้ Local config เก่า Fail safely ไปยัง Contract ใหม่
 * แต่ไม่คืนเป็น Profile แยกและไม่สามารถสร้าง customer/account identity เก่าได้อีก
 */
const PROFILE_ALIASES = Object.freeze({
  dev_ft_pumkin: 'integration_workspace',
  uat_chemistry_k: 'integration_workspace',
});

const SUPPORTED_ENVIRONMENTS = Object.freeze(['development', 'production']);

/**
 * โหลด Runtime Profile จาก Environment โดย Resolve Historical alias ก่อนตรวจ Environment
 * เพื่อให้มี Operating mode ก่อน Production เพียง Integration Workspace เดียว
 */
export function loadCustomerRuntimeConfig(env) {
  const source = env ?? {};
  const environment = requireChoice(source.MKT_ENV, 'MKT_ENV', SUPPORTED_ENVIRONMENTS);
  const requestedProfileKey = requireText(source.MKT_CUSTOMER_PROFILE, 'MKT_CUSTOMER_PROFILE');
  const profileKey = PROFILE_ALIASES[requestedProfileKey] ?? requestedProfileKey;
  const profile = CUSTOMER_PROFILES[profileKey];

  if (!profile) {
    const accepted = [...Object.keys(CUSTOMER_PROFILES), ...Object.keys(PROFILE_ALIASES)];
    throw permanentError(
      `Unknown MKT_CUSTOMER_PROFILE=${requestedProfileKey}. Supported profiles/aliases: ${accepted.join(', ')}`,
      {
        code: 'MKT_RUNTIME_CONFIG_INVALID',
        details: { fieldName: 'MKT_CUSTOMER_PROFILE', profileKey: requestedProfileKey },
      },
    );
  }

  if (profile.environment !== environment) {
    throw permanentError(
      `Invalid runtime pairing: MKT_ENV=${environment} cannot use MKT_CUSTOMER_PROFILE=${requestedProfileKey}; expected MKT_ENV=${profile.environment}`,
      {
        code: 'MKT_RUNTIME_CONFIG_INVALID',
        details: {
          environment,
          requestedProfileKey,
          profileKey,
          expectedEnvironment: profile.environment,
        },
      },
    );
  }

  const connectors = resolveConnectorRuntimeConfig(profile.connectors, source);
  assertLockedConnectorIdentities(profileKey, connectors);

  return Object.freeze({
    environment,
    profileKey,
    requestedProfileKey,
    compatibilityAlias: requestedProfileKey === profileKey ? null : requestedProfileKey,
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

/** คืนเฉพาะ Canonical Profile เพื่อไม่ให้หน้า Admin แสดง Historical alias เป็น Operating mode */
export function listCustomerProfiles() {
  return Object.freeze(Object.keys(CUSTOMER_PROFILES));
}

/** คืน Alias สำหรับ Diagnostics/Test โดยไม่เปิดเผย Secret */
export function listCustomerProfileAliases() {
  return Object.freeze({ ...PROFILE_ALIASES });
}

/**
 * Runtime ownership tuple ที่ผ่านการทบทวนสำหรับ Connector จริง.
 * รับเฉพาะ Integration Workspace เดิม หรือ Customer Production ของ Chemistry K เท่านั้น.
 */
export function isReviewedConnectorRuntime(runtimeConfig = {}) {
  const integrationWorkspace = runtimeConfig.environment === 'development'
    && runtimeConfig.profileKey === 'integration_workspace'
    && runtimeConfig.infrastructureOwner === 'developer'
    && runtimeConfig.customerKey === 'chemistry_k';
  const customerProduction = runtimeConfig.environment === 'production'
    && runtimeConfig.profileKey === 'chemistry_k'
    && runtimeConfig.infrastructureOwner === 'customer'
    && runtimeConfig.customerKey === 'chemistry_k';
  return integrationWorkspace || customerProduction;
}

/**
 * TikTok ของ Integration Workspace เป็น Chemistry K ที่ผูกกับ Canonical accountKey แล้ว
 * จึงห้าม Environment เปลี่ยน Handle ไปเป็น Source อื่นใต้ Stable key เดิม.
 */
function assertLockedConnectorIdentities(profileKey, connectors) {
  if (profileKey !== 'integration_workspace') return;
  const tiktok = connectors?.tiktok;
  if (tiktok?.accountKey !== 'chemistry_k'
    || normalizeHandle(tiktok?.sourceHandle) !== 'chemistry_k') {
    throw permanentError('Integration Workspace TikTok identity cannot be overridden', {
      code: 'MKT_RUNTIME_IDENTITY_OVERRIDE_BLOCKED',
      details: {
        connectorKey: 'tiktok',
        expectedAccountKey: 'chemistry_k',
        expectedSourceHandle: 'chemistry_k',
      },
    });
  }
}

function normalizeHandle(value) {
  return typeof value === 'string'
    ? value.trim().replace(/^@/u, '').toLowerCase()
    : '';
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
