import { describe, expect, it, vi } from 'vitest';
import { processJobWithTikTokD1AwareReport } from '../../apps/sync-worker/src/tiktok-d1-aware-report-job-router.js';
import { JOB_TYPES } from '../../packages/application/src/jobs/job-catalog.js';

describe('multichannel report Worker route', () => {
  it('fails closed before infrastructure access when D1 report reads are disabled', async () => {
    const getRuntimeConfig = vi.fn();
    const getInfrastructure = vi.fn();
    await expect(processJobWithTikTokD1AwareReport({
      job: {
        body: {
          type: JOB_TYPES.REPORT_MATERIALIZATION_GENERATE,
          trigger: 'dashboard_preset',
          periodKind: 'rolling_days',
          windowDays: 3,
          platformScope: 'youtube',
          reportSettingKey: 'integration_workspace:youtube:rolling:3d',
          sourceWatermark: 'wm',
          requestedAt: '2026-07-28T00:00:00.000Z',
        },
      },
      env: {
        MKT_REPORT_D1_READ_ENABLED: 'false',
      },
      getRuntimeConfig,
      getInfrastructure,
    })).rejects.toMatchObject({ code: 'DASHBOARD_REPORT_CONFIGURATION_INVALID' });
    expect(getRuntimeConfig).not.toHaveBeenCalled();
    expect(getInfrastructure).not.toHaveBeenCalled();
  });

  it('rejects unknown platform scopes before constructing report adapters', async () => {
    await expect(processJobWithTikTokD1AwareReport({
      job: {
        body: {
          type: JOB_TYPES.REPORT_MATERIALIZATION_GENERATE,
          trigger: 'dashboard_preset',
          periodKind: 'rolling_days',
          windowDays: 3,
          platformScope: 'unknown',
          reportSettingKey: 'integration_workspace:unknown:rolling:3d',
          sourceWatermark: 'wm',
          requestedAt: '2026-07-28T00:00:00.000Z',
        },
      },
      env: { MKT_REPORT_D1_READ_ENABLED: 'true' },
    })).rejects.toMatchObject({ code: 'DASHBOARD_REPORT_PLATFORM_UNSUPPORTED' });
  });

  it('requires WooCommerce report-read but permits independent scheduled ingestion flags', async () => {
    const baseInput = {
      job: {
        body: {
          type: JOB_TYPES.REPORT_MATERIALIZATION_GENERATE,
          trigger: 'dashboard_preset',
          periodKind: 'rolling_days',
          windowDays: 3,
          platformScope: 'woocommerce',
          reportSettingKey: 'integration_workspace:woocommerce:rolling:3d',
          requestedAt: '2026-07-28T00:00:00.000Z',
        },
      },
      getRuntimeConfig: vi.fn(),
      getInfrastructure: vi.fn(),
    };
    await expect(processJobWithTikTokD1AwareReport({
      ...baseInput,
      env: {
        MKT_REPORT_D1_READ_ENABLED: 'true',
        MKT_REPORT_PRESET_MATERIALIZATION_ENABLED: 'true',
        MKT_WOOCOMMERCE_REPORT_READ_ENABLED: 'false',
        WOOCOMMERCE_DEFAULT_CURRENCY: 'THB',
      },
    })).rejects.toMatchObject({ code: 'DASHBOARD_REPORT_CONFIGURATION_INVALID' });
    const reachedInfrastructure = new Error('reached infrastructure');
    reachedInfrastructure.code = 'TEST_INFRASTRUCTURE_REACHED';
    baseInput.getRuntimeConfig.mockReturnValue({
      profileKey: 'integration_workspace',
      customerKey: 'chemistry_k',
      connectors: { woocommerce: { accountKey: 'chemistry_k' } },
    });
    baseInput.getInfrastructure.mockImplementation(() => { throw reachedInfrastructure; });
    await expect(processJobWithTikTokD1AwareReport({
      ...baseInput,
      env: {
        MKT_REPORT_D1_READ_ENABLED: 'true',
        MKT_REPORT_PRESET_MATERIALIZATION_ENABLED: 'true',
        MKT_WOOCOMMERCE_REPORT_READ_ENABLED: 'true',
        MKT_CONNECTOR_WOOCOMMERCE_ENABLED: 'true',
        MKT_WOOCOMMERCE_D1_WRITE_ENABLED: 'true',
        MKT_WOOCOMMERCE_LARK_WRITE_ENABLED: 'true',
        MKT_SCHEDULE_WOOCOMMERCE_ENABLED: 'true',
        WOOCOMMERCE_BASE_URL: 'https://example.com',
        WOOCOMMERCE_CONSUMER_KEY: 'ck_test',
        WOOCOMMERCE_CONSUMER_SECRET: 'secret',
        WOOCOMMERCE_DEFAULT_CURRENCY: 'THB',
      },
    })).rejects.toMatchObject({ code: 'TEST_INFRASTRUCTURE_REACHED' });
    expect(baseInput.getRuntimeConfig).toHaveBeenCalledTimes(1);
    expect(baseInput.getInfrastructure).toHaveBeenCalledTimes(1);
  });

  it('requires Meta report-read for scheduled or manual Shared materialization', async () => {
    await expect(processJobWithTikTokD1AwareReport({
      job: {
        body: {
          type: JOB_TYPES.REPORT_MATERIALIZATION_GENERATE,
          trigger: 'dashboard_scheduled',
          periodKind: 'rolling_days',
          windowDays: 7,
          platformScope: 'meta_ads',
          reportSettingKey: 'integration_workspace:meta_ads:rolling:7d',
          requestedAt: '2026-08-09T01:10:00.000Z',
        },
      },
      env: {
        MKT_REPORT_D1_READ_ENABLED: 'true',
        MKT_REPORT_PRESET_MATERIALIZATION_ENABLED: 'true',
        MKT_META_REPORT_READ_ENABLED: 'false',
      },
      getRuntimeConfig: vi.fn(),
      getInfrastructure: vi.fn(),
    })).rejects.toMatchObject({ code: 'DASHBOARD_REPORT_CONFIGURATION_INVALID' });
  });
});
