export const METRIC_DICTIONARY = Object.freeze({
  spend: {
    thaiName: 'ค่าใช้จ่ายโฆษณา',
    definition: 'Actual media spend reported by the ads platform for the selected period.',
    requiresCurrency: true,
    unsupportedValue: null,
  },
  targetRoas: {
    thaiName: 'ROAS เป้าหมาย',
    definition: 'Optimization target configured in the ads platform. This is not actual ROAS.',
    requiresCurrency: false,
    unsupportedValue: null,
  },
  actualRoas: {
    thaiName: 'ROAS จริง',
    definition: 'Conversion value divided by spend. Both values must be present and spend must be greater than zero.',
    requiresCurrency: false,
    unsupportedValue: null,
  },
  uniqueViewers: {
    thaiName: 'ผู้ชมไม่ซ้ำ',
    definition: 'Deduplicated viewers from the platform. Do not automatically rename this as reach.',
    requiresCurrency: false,
    unsupportedValue: null,
  },
});
