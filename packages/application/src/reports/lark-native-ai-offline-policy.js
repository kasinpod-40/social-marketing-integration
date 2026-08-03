import {
  LARK_NATIVE_AI_SECTIONS,
  resolveLarkNativeAiOfflineSection,
} from '../../../config/src/lark-native-ai-offline-contract.js';

const BUSINESS_EVIDENCE = new Set(['complete', 'partial', 'coverage_incomplete']);

export function resolveLarkNativeAiSectionPolicy(bundle, sectionId) {
  const section = resolveLarkNativeAiOfflineSection(sectionId);
  const channels = bundle.channels.filter((channel) => section.platforms.includes(channel.platform));
  const businessChannels = channels.filter((channel) => BUSINESS_EVIDENCE.has(channel.availabilityStatus));

  if (sectionId === 'executive_summary') {
    return freezePolicy(section, businessChannels.length > 0, channels,
      businessChannels.length > 0 ? null : 'no_validated_business_evidence');
  }
  if (sectionId === 'recommendations') {
    const eligible = channels.filter((channel) => channel.recommendationEligibility.level !== 'none');
    return freezePolicy(section, eligible.length > 0, eligible,
      eligible.length > 0 ? null : 'recommendation_evidence_ineligible');
  }
  if (sectionId === 'warnings_missing_data') {
    const warningChannels = channels.filter((channel) => channel.availabilityStatus !== 'complete'
      || channel.coverageStatus !== 'complete'
      || channel.freshness.status !== 'fresh'
      || channel.warnings.length > 0
      || channel.dataQualityIssues.length > 0);
    return freezePolicy(section, warningChannels.length > 0, warningChannels,
      warningChannels.length > 0 ? null : 'no_warnings_or_missing_data');
  }
  if (sectionId === 'data_quality_operations') {
    const operations = channels.find((channel) => channel.platform === 'operations');
    const render = Boolean(operations) && (BUSINESS_EVIDENCE.has(operations.availabilityStatus)
      || operations.warnings.length > 0
      || operations.dataQualityIssues.length > 0);
    return freezePolicy(section, render, operations ? [operations] : [],
      render ? null : 'operations_evidence_unavailable');
  }

  return freezePolicy(section, businessChannels.length > 0, businessChannels,
    businessChannels.length > 0 ? null : 'section_evidence_unavailable');
}

export function resolveAllLarkNativeAiSectionPolicies(bundle) {
  return Object.freeze(LARK_NATIVE_AI_SECTIONS.map(({ sectionId }) => (
    resolveLarkNativeAiSectionPolicy(bundle, sectionId)
  )));
}

export function isLarkNativeAiBusinessEvidence(channel) {
  return BUSINESS_EVIDENCE.has(channel.availabilityStatus);
}

function freezePolicy(section, rendered, channels, suppressionReason) {
  return Object.freeze({
    sectionId: section.sectionId,
    title: section.title,
    expectedStatus: rendered ? 'rendered' : 'suppressed',
    suppressionReason,
    channels: Object.freeze(channels),
  });
}
