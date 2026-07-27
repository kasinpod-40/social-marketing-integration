import { permanentError } from '../../shared/src/errors/runtime-error.js';
import {
  createLargeAccountReadiness,
  LARGE_ACCOUNT_STATUS,
} from './large-account-readiness.js';

/** Central connector registry. */
export const CONNECTOR_KEYS = Object.freeze({
  TIKTOK: 'tiktok',
  FACEBOOK: 'facebook',
  INSTAGRAM: 'instagram',
  META_ADS: 'meta_ads',
  GOOGLE_ADS: 'google_ads',
  YOUTUBE: 'youtube',
  WOOCOMMERCE: 'woocommerce',
  CHATWOOT: 'chatwoot',
});

export const CONNECTOR_IMPLEMENTATION_STATUS = Object.freeze({
  ACTIVE: 'active',
  UAT_PENDING: 'uat_pending',
  PLANNED: 'planned',
});

const CONNECTOR_CATALOG = Object.freeze({
  [CONNECTOR_KEYS.TIKTOK]: freezeDefinition({
    key: CONNECTOR_KEYS.TIKTOK,
    displayName: 'TikTok',
    capability: 'organic_content',
    implementationStatus: CONNECTOR_IMPLEMENTATION_STATUS.ACTIVE,
    featureFlagEnv: 'MKT_CONNECTOR_TIKTOK_ENABLED',
    sourceHandleEnv: 'TIKTOK_SOURCE_HANDLE',
    requiredRuntimeFields: ['accountKey', 'sourceHandle'],
    largeAccount: createLargeAccountReadiness({
      status: LARGE_ACCOUNT_STATUS.DEV_READY,
      primaryEntity: 'videos',
      minimumFixtureItems: 1000,
      gates: {
        fullBackfill: true,
        incrementalSync: true,
        periodicFullReconciliation: true,
        boundedPagination: true,
        durableResume: true,
        boundedChunking: true,
        stableKeyIdempotency: true,
        completenessAccounting: true,
        rateLimitAwareRetry: true,
        largeAccountFixture: true,
        liveAccountUat: false,
      },
    }),
  }),
  [CONNECTOR_KEYS.FACEBOOK]: freezeDefinition({
    key: CONNECTOR_KEYS.FACEBOOK,
    displayName: 'Facebook Page',
    capability: 'organic_content',
    implementationStatus: CONNECTOR_IMPLEMENTATION_STATUS.UAT_PENDING,
    featureFlagEnv: 'MKT_CONNECTOR_FACEBOOK_ENABLED',
    requiredRuntimeFields: ['accountKey'],
    largeAccount: plannedLargeAccount('posts', 5000),
  }),
  [CONNECTOR_KEYS.INSTAGRAM]: freezeDefinition({
    key: CONNECTOR_KEYS.INSTAGRAM,
    displayName: 'Instagram Business',
    capability: 'organic_content',
    implementationStatus: CONNECTOR_IMPLEMENTATION_STATUS.UAT_PENDING,
    featureFlagEnv: 'MKT_CONNECTOR_INSTAGRAM_ENABLED',
    requiredRuntimeFields: ['accountKey'],
    largeAccount: plannedLargeAccount('posts', 2000),
  }),
  [CONNECTOR_KEYS.META_ADS]: freezeDefinition({
    key: CONNECTOR_KEYS.META_ADS,
    displayName: 'Meta Ads',
    capability: 'paid_ads',
    implementationStatus: CONNECTOR_IMPLEMENTATION_STATUS.UAT_PENDING,
    featureFlagEnv: 'MKT_CONNECTOR_META_ADS_ENABLED',
    requiredRuntimeFields: ['accountKey'],
    largeAccount: plannedLargeAccount('ads', 5000),
  }),
  [CONNECTOR_KEYS.GOOGLE_ADS]: freezeDefinition({
    key: CONNECTOR_KEYS.GOOGLE_ADS,
    displayName: 'Google Ads',
    capability: 'paid_ads',
    implementationStatus: CONNECTOR_IMPLEMENTATION_STATUS.UAT_PENDING,
    featureFlagEnv: 'MKT_CONNECTOR_GOOGLE_ADS_ENABLED',
    requiredRuntimeFields: ['accountKey'],
    largeAccount: plannedLargeAccount('ads', 5000),
  }),
  [CONNECTOR_KEYS.YOUTUBE]: freezeDefinition({
    key: CONNECTOR_KEYS.YOUTUBE,
    displayName: 'YouTube',
    capability: 'organic_content',
    implementationStatus: CONNECTOR_IMPLEMENTATION_STATUS.ACTIVE,
    featureFlagEnv: 'MKT_CONNECTOR_YOUTUBE_ENABLED',
    requiredRuntimeFields: ['accountKey'],
    largeAccount: createLargeAccountReadiness({
      status: LARGE_ACCOUNT_STATUS.DEV_READY,
      primaryEntity: 'videos',
      minimumFixtureItems: 1000,
      gates: {
        fullBackfill: true,
        incrementalSync: true,
        periodicFullReconciliation: true,
        boundedPagination: true,
        durableResume: true,
        boundedChunking: true,
        stableKeyIdempotency: true,
        completenessAccounting: true,
        rateLimitAwareRetry: true,
        largeAccountFixture: true,
        liveAccountUat: false,
      },
    }),
  }),
  [CONNECTOR_KEYS.WOOCOMMERCE]: freezeDefinition({
    key: CONNECTOR_KEYS.WOOCOMMERCE,
    displayName: 'WooCommerce',
    capability: 'commerce',
    implementationStatus: CONNECTOR_IMPLEMENTATION_STATUS.UAT_PENDING,
    featureFlagEnv: 'MKT_CONNECTOR_WOOCOMMERCE_ENABLED',
    requiredRuntimeFields: ['accountKey'],
    largeAccount: plannedLargeAccount('orders', 5000),
  }),
  [CONNECTOR_KEYS.CHATWOOT]: freezeDefinition({
    key: CONNECTOR_KEYS.CHATWOOT,
    displayName: 'Chatwoot',
    capability: 'conversations',
    implementationStatus: CONNECTOR_IMPLEMENTATION_STATUS.UAT_PENDING,
    featureFlagEnv: 'MKT_CONNECTOR_CHATWOOT_ENABLED',
    requiredRuntimeFields: ['accountKey'],
    largeAccount: plannedLargeAccount('conversations', 5000),
  }),
});

function plannedLargeAccount(primaryEntity, minimumFixtureItems) {
  return createLargeAccountReadiness({
    status: LARGE_ACCOUNT_STATUS.PLANNED,
    primaryEntity,
    minimumFixtureItems,
    gates: {},
  });
}

export function getConnectorCatalogEntry(connectorKey) {
  const key = normalizeConnectorKey(connectorKey);
  const definition = CONNECTOR_CATALOG[key];
  if (!definition) {
    throw permanentError(`Unknown connector key: ${key}`, {
      code: 'UNKNOWN_CONNECTOR',
      details: { connectorKey: key },
    });
  }
  return definition;
}

export function listConnectorCatalog() {
  return Object.freeze(Object.values(CONNECTOR_CATALOG));
}

export function listConnectorKeys() {
  return Object.freeze(Object.keys(CONNECTOR_CATALOG));
}

function normalizeConnectorKey(value) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw permanentError('Connector key is required', { code: 'UNKNOWN_CONNECTOR' });
  }
  return value.trim().toLowerCase();
}

function freezeDefinition(definition) {
  return Object.freeze({
    ...definition,
    requiredRuntimeFields: Object.freeze([...(definition.requiredRuntimeFields ?? [])]),
  });
}
