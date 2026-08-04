export const META_K2_EXACT_RECOVERY_PATH =
  '/operator/meta/d1-only-partial-staging-continuation';
export const META_K2_EXACT_RECOVERY_MODE =
  'RECOVER_EXACT_PARTIAL_META_ADS_STAGING';
export const META_K2_EXACT_RECOVERY_MODE_ENV =
  'MKT_META_D1_ONLY_PARTIAL_STAGING_RECOVERY';
export const META_K2_EXACT_RECOVERY_PHASE_ENV =
  'MKT_META_K2_EXACT_CONTINUATION_PHASE';
export const META_K2_EXACT_RECOVERY_TOKEN_SHA256_ENV =
  'MKT_META_D1_ONLY_PARTIAL_STAGING_RECOVERY_TOKEN_SHA256';
export const META_K2_EXACT_RECOVERY_ATTESTATION_ENV =
  'MKT_META_D1_ONLY_PARTIAL_STAGING_RECOVERY_ATTESTATION';
export const META_K2_EXACT_RECOVERY_ATTESTATION_HEADER =
  'x-mkt-meta-partial-staging-attestation';

export const META_K2_EXACT_RECOVERY_IDENTITY = Object.freeze({
  environment: 'development',
  customerProfile: 'integration_workspace',
  customerKey: 'chemistry_k',
  accountKey: 'chemistry_k',
  targetKey: 'chemistry_k2',
  connectorKey: 'meta_ads',
  platform: 'meta_ads',
  sourceAccountKey: 'chemistry_k2',
  operationId: 'meta-chemistry_k2-history-20260701-20260731-f741090d1d8a',
  workKey:
    'meta_ads:chemistry_k2:meta-chemistry_k2-history-20260701-20260731-f741090d1d8a',
  syncRunId:
    'meta:meta_ads:chemistry_k2:meta-chemistry_k2-history-20260701-20260731-f741090d1d8a',
  periodStart: '2026-07-01',
  periodEnd: '2026-07-31',
  sourceStage: 'daily',
  sourceUnitCount: 27,
  sourceRowCount: 2601,
  sourcePageNumber: 27,
  sourceContentIndex: 0,
  queueOperationAttempts: 1,
  mainQueueAttempts: 29,
});

export const META_K2_EXACT_RECOVERY_TRUE_FLAGS_BY_PHASE = Object.freeze({
  d1: Object.freeze([
    'MKT_CONNECTOR_META_ADS_ENABLED',
    'MKT_META_D1_WRITE_ENABLED',
    'MKT_META_SOURCE_READ_ENABLED',
  ]),
  lark: Object.freeze([
    'MKT_CONNECTOR_META_ADS_ENABLED',
    'MKT_META_D1_WRITE_ENABLED',
    'MKT_META_LARK_WRITE_ENABLED',
    'MKT_META_SOURCE_READ_ENABLED',
  ]),
});

export const META_K2_EXACT_LARK_TABLE_KEYS = Object.freeze([
  'mktAdsAccounts',
  'mktAdsCampaigns',
  'mktAdsAdGroups',
  'mktAdsAds',
]);
