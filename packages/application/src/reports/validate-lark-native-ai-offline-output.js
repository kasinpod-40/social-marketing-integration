import {
  LARK_NATIVE_AI_OFFLINE_CONTRACT_VERSION,
  LARK_NATIVE_AI_OUTPUT_SCHEMA_VERSION,
  LARK_NATIVE_AI_SECTIONS,
} from '../../../config/src/lark-native-ai-offline-contract.js';
import { LarkNativeAiContractError } from './build-lark-native-ai-offline-bundle.js';
import { resolveAllLarkNativeAiSectionPolicies } from './lark-native-ai-offline-policy.js';

const TREND_LANGUAGE = /(?:increase|decrease|growth|decline|rose|fell|grew|dropped|เพิ่ม|ลด|เติบโต|สูงขึ้น|ต่ำลง)/iu;
const NUMBER_TOKEN = /[-+]?\d[\d,]*(?:\.\d+)?%?/gu;
const LEVEL_WEIGHT = Object.freeze({ none: 0, limited: 1, full: 2 });
const NON_NUMERIC_STATUSES = new Set(['unavailable', 'no_data_confirmed', 'source_pending']);

export function validateLarkNativeAiOfflineOutput(bundle, output) {
  const value = requireObject(output, 'output');
  if (value.schemaVersion !== LARK_NATIVE_AI_OUTPUT_SCHEMA_VERSION) {
    fail('AI_OUTPUT_SCHEMA_INVALID', `output.schemaVersion must be ${LARK_NATIVE_AI_OUTPUT_SCHEMA_VERSION}`);
  }
  if (value.contractVersion !== LARK_NATIVE_AI_OFFLINE_CONTRACT_VERSION) {
    fail('AI_OUTPUT_CONTRACT_INVALID', `output.contractVersion must be ${LARK_NATIVE_AI_OFFLINE_CONTRACT_VERSION}`);
  }
  if (value.mode !== 'offline_preview' || value.bundleId !== bundle.bundleId) {
    fail('AI_OUTPUT_IDENTITY_MISMATCH', 'output mode or bundleId does not match the input bundle');
  }
  validateExecutionBoundary(value.execution);
  validateLarkNativeAiSectionSuppression(bundle, value);
  validateLarkNativeAiNumericTraces(bundle, value);
  validateLarkNativeAiRecommendationEligibility(bundle, value);
  validateLarkNativeAiAntiFabrication(bundle, value);
  return Object.freeze({
    ok: true,
    sectionCount: value.sections.length,
    numericClaimCount: collectItems(value).reduce((sum, item) => sum + item.claims.length, 0),
    aiCallCount: 0,
    larkWriteCount: 0,
    remoteActionCount: 0,
  });
}

export function validateLarkNativeAiSectionSuppression(bundle, output) {
  const sections = requireArray(output.sections, 'output.sections');
  const expectedIds = LARK_NATIVE_AI_SECTIONS.map(({ sectionId }) => sectionId);
  const actualIds = sections.map((section, index) => requireText(section.sectionId, `output.sections[${index}].sectionId`));
  if (JSON.stringify(actualIds) !== JSON.stringify(expectedIds)) {
    fail('AI_OUTPUT_SECTION_SET_INVALID', `output must contain sections in exact order: ${expectedIds.join(', ')}`);
  }
  const policies = resolveAllLarkNativeAiSectionPolicies(bundle);
  for (let index = 0; index < sections.length; index += 1) {
    const section = requireObject(sections[index], `output.sections[${index}]`);
    const policy = policies[index];
    if (section.status !== policy.expectedStatus) {
      fail('AI_SECTION_SUPPRESSION_INVALID', `${section.sectionId} must be ${policy.expectedStatus}`);
    }
    const statements = requireArray(section.statements, `${section.sectionId}.statements`);
    const recommendations = requireArray(section.recommendations, `${section.sectionId}.recommendations`);
    const warnings = requireArray(section.warnings, `${section.sectionId}.warnings`);
    if (section.status === 'suppressed') {
      if (section.suppressionReason !== policy.suppressionReason) {
        fail('AI_SECTION_SUPPRESSION_INVALID', `${section.sectionId} suppression reason is invalid`);
      }
      if (statements.length || recommendations.length || warnings.length) {
        fail('AI_SECTION_SUPPRESSION_INVALID', `${section.sectionId} suppressed section must be empty`);
      }
    } else if (section.suppressionReason !== null) {
      fail('AI_SECTION_SUPPRESSION_INVALID', `${section.sectionId} rendered section cannot have a suppression reason`);
    }
  }
  return true;
}

export function validateLarkNativeAiNumericTraces(bundle, output) {
  for (const item of collectItems(output)) {
    const text = requireText(item.text, 'output item.text');
    const claims = requireArray(item.claims, 'output item.claims');
    const tokenCounts = countTokens(extractNumericTokens(text));
    const claimCounts = countTokens(claims.map((claim, index) => {
      const normalized = requireObject(claim, `claim[${index}]`);
      const traceId = requireText(normalized.traceId, `claim[${index}].traceId`);
      const trace = bundle.traceIndex[traceId];
      if (!trace) fail('AI_NUMERIC_TRACE_UNKNOWN', `Unknown numeric trace: ${traceId}`);
      if (normalized.reportId !== trace.reportId
        || normalized.metricIdentity !== trace.metricIdentity
        || normalized.field !== trace.field
        || !Object.is(Number(normalized.value), trace.value)
        || normalized.currency !== trace.currency
        || normalized.unit !== trace.unit) {
        fail('AI_NUMERIC_TRACE_MISMATCH', `Numeric claim does not match trace ${traceId}`);
      }
      return normalizeNumericToken(requireText(normalized.renderedValue, `claim[${index}].renderedValue`));
    }));
    if (!sameTokenCounts(tokenCounts, claimCounts)) {
      fail('AI_NUMERIC_CLAIM_UNTRACED', `Every number in output text must have one exact numeric claim: ${text}`);
    }
    const currencies = new Set(claims.map(({ traceId }) => bundle.traceIndex[traceId]?.currency).filter(Boolean));
    if (currencies.size > 1) {
      fail('AI_MULTI_CURRENCY_AGGREGATION_FORBIDDEN', 'A numeric statement cannot combine different currencies');
    }
    if (TREND_LANGUAGE.test(text)) {
      if (claims.length === 0 || claims.some(({ traceId }) => bundle.traceIndex[traceId]?.trendEligible !== true)) {
        fail('AI_TREND_WITHOUT_BASELINE', 'Trend language requires exact trend-eligible Report traces');
      }
    }
    const platform = optionalText(item.platform);
    if (platform) {
      const channel = bundle.channels.find((candidate) => candidate.platform === platform);
      if (!channel) fail('AI_OUTPUT_PLATFORM_UNKNOWN', `Unknown output platform: ${platform}`);
      if (NON_NUMERIC_STATUSES.has(channel.availabilityStatus) && claims.length > 0) {
        fail('AI_NUMERIC_CLAIM_AVAILABILITY_FORBIDDEN', `${platform} cannot expose numeric claims in ${channel.availabilityStatus}`);
      }
    }
  }
  return true;
}

export function validateLarkNativeAiAntiFabrication(bundle, output) {
  const evidenceRefs = new Set();
  for (const channel of bundle.channels) {
    evidenceRefs.add(channel.evidenceIdentity);
    if (channel.reportIdentity?.reportId) evidenceRefs.add(channel.reportIdentity.reportId);
  }
  for (const traceId of Object.keys(bundle.traceIndex)) evidenceRefs.add(traceId);

  const policies = new Map(resolveAllLarkNativeAiSectionPolicies(bundle).map((policy) => [policy.sectionId, policy]));
  for (const section of output.sections) {
    const policy = policies.get(section.sectionId);
    const allowedPlatforms = new Set(policy.channels.map((channel) => channel.platform));
    for (const item of [...section.statements, ...section.recommendations, ...section.warnings]) {
      const refs = requireArray(item.evidenceRefs, `${section.sectionId}.evidenceRefs`);
      if (refs.length === 0) fail('AI_OUTPUT_EVIDENCE_REF_MISSING', `${section.sectionId} output item requires evidenceRefs`);
      for (const reference of refs) {
        if (!evidenceRefs.has(reference)) {
          fail('AI_OUTPUT_EVIDENCE_REF_UNKNOWN', `Unknown evidence reference: ${reference}`);
        }
      }
      if (item.platform && !allowedPlatforms.has(item.platform)) {
        fail('AI_SECTION_PLATFORM_INVALID', `${item.platform} is not eligible for ${section.sectionId}`);
      }
      const text = requireText(item.text, `${section.sectionId}.text`);
      if (/<\/?UNTRUSTED_REPORT_DATA>/iu.test(text)) {
        fail('AI_PROMPT_BOUNDARY_LEAK', 'Output cannot reproduce prompt boundary markers');
      }
    }
  }
  return true;
}

export function validateLarkNativeAiRecommendationEligibility(bundle, output) {
  const recommendationSection = output.sections.find(({ sectionId }) => sectionId === 'recommendations');
  if (!recommendationSection) fail('AI_RECOMMENDATION_SECTION_MISSING', 'Recommendations section is required');
  for (const recommendation of recommendationSection.recommendations) {
    const platform = requireText(recommendation.platform, 'recommendation.platform');
    const channel = bundle.channels.find((candidate) => candidate.platform === platform);
    if (!channel) fail('AI_OUTPUT_PLATFORM_UNKNOWN', `Unknown recommendation platform: ${platform}`);
    const level = requireText(recommendation.evidenceLevel, 'recommendation.evidenceLevel');
    if (!(level in LEVEL_WEIGHT)) fail('AI_RECOMMENDATION_LEVEL_INVALID', `Unsupported evidence level: ${level}`);
    const allowed = channel.recommendationEligibility.level;
    if (allowed === 'none' || LEVEL_WEIGHT[level] > LEVEL_WEIGHT[allowed]) {
      fail('AI_RECOMMENDATION_EVIDENCE_INSUFFICIENT', `${platform} recommendation exceeds evidence eligibility`);
    }
    if (channel.freshness.status !== 'fresh') {
      fail('AI_RECOMMENDATION_STALE_EVIDENCE', `${platform} recommendation cannot use stale or unknown evidence`);
    }
  }
  return true;
}

function validateExecutionBoundary(value) {
  const execution = requireObject(value, 'output.execution');
  const expected = {
    aiCallCount: 0,
    larkWriteCount: 0,
    remoteActionCount: 0,
    notificationCount: 0,
    scheduleEnabled: false,
    production: 'BLOCKED',
  };
  for (const [key, expectedValue] of Object.entries(expected)) {
    if (execution[key] !== expectedValue) {
      fail('AI_OFFLINE_BOUNDARY_VIOLATION', `output.execution.${key} must be ${String(expectedValue)}`);
    }
  }
}

function collectItems(output) {
  return requireArray(output.sections, 'output.sections').flatMap((section) => [
    ...requireArray(section.statements, `${section.sectionId}.statements`),
    ...requireArray(section.recommendations, `${section.sectionId}.recommendations`),
    ...requireArray(section.warnings, `${section.sectionId}.warnings`),
  ]);
}

function extractNumericTokens(text) {
  return [...text.matchAll(NUMBER_TOKEN)].map(([token]) => normalizeNumericToken(token));
}

function normalizeNumericToken(token) {
  return token.replaceAll(',', '').replace(/%$/u, '');
}

function countTokens(tokens) {
  const counts = new Map();
  for (const token of tokens) counts.set(token, (counts.get(token) ?? 0) + 1);
  return counts;
}

function sameTokenCounts(left, right) {
  if (left.size !== right.size) return false;
  for (const [token, count] of left) if (right.get(token) !== count) return false;
  return true;
}

function optionalText(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function requireText(value, label) {
  if (typeof value !== 'string' || value.trim() === '') fail('AI_REQUIRED_TEXT_MISSING', `${label} is required`);
  return value.trim();
}

function requireObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('AI_OBJECT_REQUIRED', `${label} must be an object`);
  return value;
}

function requireArray(value, label) {
  if (!Array.isArray(value)) fail('AI_ARRAY_REQUIRED', `${label} must be an array`);
  return value;
}

function fail(code, message) {
  throw new LarkNativeAiContractError(code, message);
}
