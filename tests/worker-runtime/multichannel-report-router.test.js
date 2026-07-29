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

  it('requires an isolated WooCommerce report-only flag window', async () => {
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
        MKT_WOOCOMMERCE_REPORT_READ_ENABLED: 'false',
        WOOCOMMERCE_DEFAULT_CURRENCY: 'THB',
      },
    })).rejects.toMatchObject({ code: 'DASHBOARD_REPORT_CONFIGURATION_INVALID' });
    await expect(processJobWithTikTokD1AwareReport({
      ...baseInput,
      env: {
        MKT_REPORT_D1_READ_ENABLED: 'true',
        MKT_WOOCOMMERCE_REPORT_READ_ENABLED: 'true',
        MKT_CONNECTOR_WOOCOMMERCE_ENABLED: 'true',
        WOOCOMMERCE_BASE_URL: 'https://example.com',
        WOOCOMMERCE_CONSUMER_KEY: 'ck_test',
        WOOCOMMERCE_CONSUMER_SECRET: 'secret',
        WOOCOMMERCE_DEFAULT_CURRENCY: 'THB',
      },
    })).rejects.toMatchObject({ code: 'DASHBOARD_REPORT_CONFIGURATION_INVALID' });
    expect(baseInput.getRuntimeConfig).not.toHaveBeenCalled();
    expect(baseInput.getInfrastructure).not.toHaveBeenCalled();
  });
});
