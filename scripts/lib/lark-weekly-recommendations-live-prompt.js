const RECOMMENDATIONS_RB_PROMPT_ANCHORS = Object.freeze([
  'metric_summary_json มี rb=[...]',
  'กฎ rb นี้มี authority สูงสุด',
  'จำนวนบรรทัดต้องเท่ากับจำนวนสมาชิก rb พอดี',
  'คัดลอกข้อความภายในสมาชิก rb ตรงทุกตัวอักษร',
  'กฎที่เหลือต่อไปนี้ใช้เฉพาะเมื่อไม่มี rb',
]);

export function assertLarkWeeklyRecommendationsPromptDefinition(value) {
  const strings = [];
  collectStringLeaves(value, strings);
  const normalized = normalize(strings.join('\n'));
  const compact = normalized.replace(/\s+/gu, '');
  const matched = RECOMMENDATIONS_RB_PROMPT_ANCHORS.filter((anchor) => (
    normalized.includes(anchor)
    || compact.includes(normalize(anchor).replace(/\s+/gu, ''))
  ));

  if (matched.length !== RECOMMENDATIONS_RB_PROMPT_ANCHORS.length) {
    throw promptError(
      'Live AI Materialization Recommendations prompt is missing the approved rb authority contract',
      'LARK_WEEKLY_7D_EXECUTIVE_DECISION_LIVE_PROMPT_MISMATCH',
      {
        matchedAnchorCount: matched.length,
        requiredAnchorCount: RECOMMENDATIONS_RB_PROMPT_ANCHORS.length,
      },
    );
  }

  return Object.freeze({
    verified: true,
    matchedAnchorCount: matched.length,
    requiredAnchorCount: RECOMMENDATIONS_RB_PROMPT_ANCHORS.length,
  });
}

function collectStringLeaves(value, output, seen = new WeakSet()) {
  if (typeof value === 'string') {
    output.push(value);
    return;
  }
  if (!value || typeof value !== 'object' || seen.has(value)) return;
  seen.add(value);
  if (Array.isArray(value)) {
    for (const item of value) collectStringLeaves(item, output, seen);
    return;
  }
  for (const nested of Object.values(value)) collectStringLeaves(nested, output, seen);
}

function normalize(value) {
  return String(value ?? '').replace(/\s+/gu, ' ').trim();
}

function promptError(message, code, details = {}) {
  const error = new Error(message);
  error.name = 'LarkWeeklyRecommendationsLivePromptError';
  error.code = code;
  error.details = Object.freeze({ ...details });
  return error;
}
