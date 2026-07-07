export function validateAdsPerformanceMetric(metric) {
  const required = ['platform', 'adsAccountId', 'metricDate'];
  const missing = required.filter((key) => !metric?.[key]);

  if (missing.length > 0) {
    return { ok: false, errors: missing.map((key) => `${key} is required`) };
  }

  if (metric.spend !== null && metric.spend !== undefined && metric.currency === null) {
    return { ok: false, errors: ['currency is required when spend is present'] };
  }

  return { ok: true, errors: [] };
}
