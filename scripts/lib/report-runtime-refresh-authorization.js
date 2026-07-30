export const REPORT_RUNTIME_DASHBOARD_READINESS_REFRESH_AUTHORIZATION =
  'AUTHORIZE_ORGANIC_DASHBOARD_READINESS_REFRESH_1D_3D_7D_30D';

export const REPORT_RUNTIME_DASHBOARD_READINESS_REFRESH_DAYS = Object.freeze([1, 3, 7, 30]);
export const REPORT_RUNTIME_LEGACY_REFRESH_DAYS = Object.freeze([3, 7]);

/**
 * 1D/30D refresh ถูกอนุญาตเฉพาะ one-command Dashboard readiness workstream.
 * Generic closeout และงานเก่ายังคง allowlist 3D/7D เดิม.
 */
export function resolveReportRuntimeApprovedRefreshDays(env = {}) {
  return env.MKT_REPORT_RUNTIME_REFRESH_AUTHORIZATION
    === REPORT_RUNTIME_DASHBOARD_READINESS_REFRESH_AUTHORIZATION
    ? REPORT_RUNTIME_DASHBOARD_READINESS_REFRESH_DAYS
    : REPORT_RUNTIME_LEGACY_REFRESH_DAYS;
}
