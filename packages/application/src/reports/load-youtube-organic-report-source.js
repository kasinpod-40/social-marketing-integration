/** Application boundary for the YouTube Organic D1 historical report reader. */
export async function loadYouTubeOrganicReportSource(input = {}) {
  const source = requireSource(input.source);
  return source.load({
    customerKey: requireText(input.customerKey, 'customerKey'),
    accountKey: requireText(input.accountKey, 'accountKey'),
    timeZone: requireText(input.timeZone ?? 'Asia/Bangkok', 'timeZone'),
    periodStart: requireText(input.period?.periodStart, 'period.periodStart'),
    periodEnd: requireText(input.period?.periodEnd, 'period.periodEnd'),
    compareStart: optionalText(input.period?.compareStart),
    compareEnd: optionalText(input.period?.compareEnd),
    maxContentRecords: input.maxContentRecords,
    maxAccountRecords: input.maxAccountRecords,
  });
}

function requireSource(value) {
  if (typeof value?.load !== 'function') {
    throw new TypeError('YouTube D1 report source requires source.load');
  }
  return value;
}

function requireText(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new TypeError(`YouTube D1 report source requires ${fieldName}`);
  }
  return value.trim();
}

function optionalText(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}
