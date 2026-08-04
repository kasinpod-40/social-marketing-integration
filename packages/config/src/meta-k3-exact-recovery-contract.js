export const META_K3_EXACT_RECOVERY_PATH =
  '/operator/meta/k3-exact-partial-staging-continuation';
export const META_K3_EXACT_RECOVERY_MODE =
  'RECOVER_EXACT_PARTIAL_META_ADS_STAGING';
export const META_K3_EXACT_RECOVERY_MODE_ENV =
  'MKT_META_D1_ONLY_PARTIAL_STAGING_RECOVERY';
export const META_K3_EXACT_RECOVERY_PHASE_ENV =
  'MKT_META_K3_EXACT_CONTINUATION_PHASE';
export const META_K3_EXACT_RECOVERY_TOKEN_SHA256_ENV =
  'MKT_META_D1_ONLY_PARTIAL_STAGING_RECOVERY_TOKEN_SHA256';
export const META_K3_EXACT_RECOVERY_ATTESTATION_ENV =
  'MKT_META_D1_ONLY_PARTIAL_STAGING_RECOVERY_ATTESTATION';
export const META_K3_EXACT_RECOVERY_ATTESTATION_HEADER =
  'x-mkt-meta-partial-staging-attestation';

export const META_K3_EXACT_RECOVERY_IDENTITY = Object.freeze({
  environment: 'development',
  customerProfile: 'integration_workspace',
  customerKey: 'chemistry_k',
  accountKey: 'chemistry_k',
  targetKey: 'chemistry_k3',
  connectorKey: 'meta_ads',
  platform: 'meta_ads',
  sourceAccountKey: 'chemistry_k3',
  operationId: 'meta-chemistry_k3-history-20260701-20260731-d4824a9e2ba9',
  workKey:
    'meta_ads:chemistry_k3:meta-chemistry_k3-history-20260701-20260731-d4824a9e2ba9',
  syncRunId:
    'meta:meta_ads:chemistry_k3:meta-chemistry_k3-history-20260701-20260731-d4824a9e2ba9',
  periodStart: '2026-07-01',
  periodEnd: '2026-07-31',
  sourceStage: 'daily',
  sourceUnitCount: 13,
  sourceRowCount: 1201,
  sourcePageNumber: 13,
  sourceContentIndex: 0,
  queueOperationAttempts: 1,
  mainQueueAttempts: 14,
});

export const META_K3_EXACT_RECOVERY_TRUE_FLAGS_BY_PHASE = Object.freeze({
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

export const META_K3_EXACT_LARK_TABLE_KEYS = Object.freeze([
  'mktAdsAccounts',
  'mktAdsCampaigns',
  'mktAdsAdGroups',
  'mktAdsAds',
]);

// The incident adapter reuses the already reviewed K2 finalizer modules through an
// isolated Node loader. These aliases preserve their static import surface while all
// values remain bound to the exact K3 operation above.
export {
  META_K3_EXACT_RECOVERY_PATH as META_K2_EXACT_RECOVERY_PATH,
  META_K3_EXACT_RECOVERY_MODE as META_K2_EXACT_RECOVERY_MODE,
  META_K3_EXACT_RECOVERY_MODE_ENV as META_K2_EXACT_RECOVERY_MODE_ENV,
  META_K3_EXACT_RECOVERY_PHASE_ENV as META_K2_EXACT_RECOVERY_PHASE_ENV,
  META_K3_EXACT_RECOVERY_TOKEN_SHA256_ENV as META_K2_EXACT_RECOVERY_TOKEN_SHA256_ENV,
  META_K3_EXACT_RECOVERY_ATTESTATION_ENV as META_K2_EXACT_RECOVERY_ATTESTATION_ENV,
  META_K3_EXACT_RECOVERY_ATTESTATION_HEADER as META_K2_EXACT_RECOVERY_ATTESTATION_HEADER,
  META_K3_EXACT_RECOVERY_IDENTITY as META_K2_EXACT_RECOVERY_IDENTITY,
  META_K3_EXACT_RECOVERY_TRUE_FLAGS_BY_PHASE as META_K2_EXACT_RECOVERY_TRUE_FLAGS_BY_PHASE,
  META_K3_EXACT_LARK_TABLE_KEYS as META_K2_EXACT_LARK_TABLE_KEYS,
};
