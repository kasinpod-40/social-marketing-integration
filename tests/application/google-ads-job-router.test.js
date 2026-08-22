import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildGoogleAdsQueueReference,
} from '../../packages/application/src/google-ads/google-ads-queue-reference.js';
import {
  processGoogleAdsManualUatJob,
} from '../../apps/sync-worker/src/google-ads-job-router.js';

describe('Google Ads Worker runtime table wiring', () => {
  it('requires the Asset Groups Lark table before signed-delivery processing', async () => {
    const reference = buildGoogleAdsQueueReference({
      runId: '01234567-89ab-4cde-8f01-23456789abcd',
      runStartedAt: Date.parse('2026-08-22T03:00:00.000Z'),
    });
    const runtimeConfig = {
      environment: 'development',
      profileKey: 'integration_workspace',
      infrastructureOwner: 'developer',
      customerKey: 'chemistry_k',
      connectors: {
        google_ads: {
          accountKey: 'chemistry_k',
          enabled: true,
        },
      },
    };
    const env = {
      MKT_CONNECTOR_GOOGLE_ADS_ENABLED: 'true',
      MKT_GOOGLE_ADS_QUEUE_ADMISSION_ENABLED: 'true',
      MKT_GOOGLE_ADS_BUSINESS_WRITE_ENABLED: 'true',
      MKT_GOOGLE_ADS_LARK_WRITE_ENABLED: 'true',
      LARK_TABLE_MKT_ADS_ACCOUNTS: 'tbl_ads_accounts',
      LARK_TABLE_MKT_ADS_CAMPAIGNS: 'tbl_ads_campaigns',
      LARK_TABLE_MKT_ADS_ADGROUPS: 'tbl_ads_adgroups',
      LARK_TABLE_MKT_ADS_ADS: 'tbl_ads_ads',
      LARK_TABLE_MKT_ADS_CREATIVES: 'tbl_ads_creatives',
      LARK_TABLE_MKT_ADS_DAILY: 'tbl_ads_daily',
      LARK_TABLE_MKT_SYNC_LOG: 'tbl_sync_log',
      LARK_TABLE_MKT_SYSTEM_ALERTS: 'tbl_system_alerts',
    };
    const admission = {
      operationId: reference.operationId,
      workKey: reference.workKey,
      generation: reference.generation,
      originalRequestedAt: reference.originalRequestedAt,
      status: 'queued',
    };
    const admissionStore = {
      async getByOperationId() {
        return admission;
      },
      async markQueued() {
        throw new Error('queued admission must not be promoted again');
      },
    };

    await assert.rejects(
      () => processGoogleAdsManualUatJob({
        env,
        job: { body: reference },
        operation: {
          stable: true,
          operationId: reference.operationId,
          workKey: reference.workKey,
          generation: reference.generation,
          originalRequestedAt: reference.originalRequestedAt,
        },
        getRuntimeConfig: () => runtimeConfig,
        getInfrastructure: () => ({
          getGoogleAdsAdmissionStore: () => admissionStore,
        }),
      }),
      (error) => {
        assert.equal(error.code, 'LARK_TABLE_CONFIG_INVALID');
        assert.equal(error.retryable, false);
        assert.deepEqual(error.details, {
          envName: 'LARK_TABLE_MKT_ADS_ASSET_GROUPS',
          tableKey: 'mktAdsAssetGroups',
        });
        return true;
      },
    );
  });
});