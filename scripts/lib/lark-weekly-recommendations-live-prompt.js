const RECOMMENDATIONS_RB_PROMPT_ANCHORS = Object.freeze([
  'metric_summary_json มี rb=[...]',
  'กฎ rb นี้มี authority สูงสุด',
  'จำนวนบรรทัดต้องเท่ากับจำนวนสมาชิก rb พอดี',
  'คัดลอกข้อความภายในสมาชิก rb ตรงทุกตัวอักษร',
  'กฎที่เหลือต่อไปนี้ใช้เฉพาะเมื่อไม่มี rb',
]);

const BASE_V3_WORKFLOW_ID = /^wkf[A-Za-z0-9_-]{4,}$/u;
const BITABLE_V1_AUTOMATION_ID = /^[0-9]{10,30}$/u;

export const LARK_WEEKLY_RECOMMENDATIONS_PROMPT_ATTESTATION = Object.freeze({
  envName: 'CONFIRM_LARK_WEEKLY_RECOMMENDATIONS_PROMPT',
  value: 'APPLIED_EXACT_PROMPT_V3_RB_AUTHORITY',
});

export async function verifyLarkWeeklyRecommendationsPrompt(input = {}) {
  const workflowId = requireText(input.workflowId, 'workflowId');
  const env = input.env ?? process.env;

  if (BASE_V3_WORKFLOW_ID.test(workflowId)) {
    if (typeof input.readDefinition !== 'function') throw new TypeError('readDefinition is required');
    const definition = await input.readDefinition(workflowId);
    const verified = assertLarkWeeklyRecommendationsPromptDefinition(definition);
    return Object.freeze({
      verificationAccepted: true,
      verificationMode: 'base_v3_exact_definition',
      exactPromptApiVerified: true,
      manualAttestationVerified: false,
      matchedAnchorCount: verified.matchedAnchorCount,
      requiredAnchorCount: verified.requiredAnchorCount,
    });
  }

  if (BITABLE_V1_AUTOMATION_ID.test(workflowId)) {
    if (env[LARK_WEEKLY_RECOMMENDATIONS_PROMPT_ATTESTATION.envName]
      !== LARK_WEEKLY_RECOMMENDATIONS_PROMPT_ATTESTATION.value) {
      throw promptError(
        'Bitable v1 Automation exposes only identity/status; exact manual Recommendations prompt attestation is required before Fresh AI work',
        'LARK_WEEKLY_7D_EXECUTIVE_DECISION_LIVE_PROMPT_ATTESTATION_REQUIRED',
        { envName: LARK_WEEKLY_RECOMMENDATIONS_PROMPT_ATTESTATION.envName },
      );
    }
    return Object.freeze({
      verificationAccepted: true,
      verificationMode: 'manual_attestation_for_bitable_v1',
      exactPromptApiVerified: false,
      manualAttestationVerified: true,
      matchedAnchorCount: null,
      requiredAnchorCount: RECOMMENDATIONS_RB_PROMPT_ANCHORS.length,
    });
  }

  throw promptError(
    'AI Materialization Automation identity format is unsupported for prompt verification',
    'LARK_WEEKLY_7D_EXECUTIVE_DECISION_LIVE_PROMPT_UNVERIFIABLE',
    { workflowIdFormat: 'unsupported' },
  );
}

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

function requireText(value, field) {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text) throw new TypeError(`${field} is required`);
  return text;
}

function promptError(message, code, details = {}) {
  const error = new Error(message);
  error.name = 'LarkWeeklyRecommendationsLivePromptError';
  error.code = code;
  error.details = Object.freeze({ ...details });
  return error;
}
