import assert from 'node:assert/strict';
import test from 'node:test';

import { buildLarkNativeAiOfflineBundle } from '../../packages/application/src/reports/build-lark-native-ai-offline-bundle.js';
import { renderLarkNativeAiOfflinePreview } from '../../packages/application/src/reports/render-lark-native-ai-offline-preview.js';
import { validateLarkNativeAiOfflineOutput } from '../../packages/application/src/reports/validate-lark-native-ai-offline-output.js';
import { createLarkNativeAiOfflineFixture } from '../fixtures/lark-native-ai-offline-preview-fixtures.js';

async function buildOutput(fixtureName) {
  const fixture = createLarkNativeAiOfflineFixture(fixtureName);
  const bundle = await buildLarkNativeAiOfflineBundle(fixture.input);
  return {
    fixture,
    bundle,
    output: structuredClone(renderLarkNativeAiOfflinePreview(bundle)),
  };
}

test('rejects a mutated section title', async () => {
  const { bundle, output } = await buildOutput('executive_mixed_availability');
  output.sections[0].title = 'Injected title';
  assert.throws(
    () => validateLarkNativeAiOfflineOutput(bundle, output),
    (error) => error?.code === 'AI_OUTPUT_SECTION_TITLE_INVALID',
  );
});

test('rejects recommendations outside the recommendations section', async () => {
  const { bundle, output } = await buildOutput('tiktok_complete_golden_dataset');
  const organic = output.sections.find(({ sectionId }) => sectionId === 'organic_performance');
  const tiktok = bundle.channels.find(({ platform }) => platform === 'tiktok');
  organic.recommendations.push({
    text: 'Change strategy immediately.',
    platform: 'tiktok',
    evidenceLevel: 'full',
    evidenceRefs: [tiktok.evidenceIdentity],
    claims: [],
  });
  assert.throws(
    () => validateLarkNativeAiOfflineOutput(bundle, output),
    (error) => error?.code === 'AI_SECTION_TOPOLOGY_INVALID',
  );
});

test('rejects numeric output backed by a metric marked unobserved', async () => {
  const fixture = createLarkNativeAiOfflineFixture('tiktok_complete_golden_dataset');
  const metric = fixture.input.channels.find(({ platform }) => platform === 'tiktok').report.metricValues[0];
  metric.observed = false;
  const bundle = await buildLarkNativeAiOfflineBundle(fixture.input);
  const output = structuredClone(renderLarkNativeAiOfflinePreview(bundle));
  assert.throws(
    () => validateLarkNativeAiOfflineOutput(bundle, output),
    (error) => error?.code === 'AI_NUMERIC_TRACE_UNOBSERVED',
  );
});

test('rejects a numeric trace attributed to another platform', async () => {
  const { bundle, output } = await buildOutput('executive_mixed_availability');
  const organic = output.sections.find(({ sectionId }) => sectionId === 'organic_performance');
  const tiktokStatement = organic.statements.find(({ platform }) => platform === 'tiktok');
  tiktokStatement.platform = 'instagram';
  assert.throws(
    () => validateLarkNativeAiOfflineOutput(bundle, output),
    (error) => error?.code === 'AI_NUMERIC_TRACE_PLATFORM_MISMATCH',
  );
});

test('requires both Report and trace evidence references for every numeric claim', async () => {
  const { bundle, output } = await buildOutput('tiktok_complete_golden_dataset');
  const organic = output.sections.find(({ sectionId }) => sectionId === 'organic_performance');
  organic.statements[0].evidenceRefs = [organic.statements[0].claims[0].reportId];
  assert.throws(
    () => validateLarkNativeAiOfflineOutput(bundle, output),
    (error) => error?.code === 'AI_NUMERIC_EVIDENCE_REF_MISSING',
  );
});

test('rejects same-currency multi-claim statements to prevent swapped metric labels', async () => {
  const { bundle, output } = await buildOutput('meta_ads_partial');
  const paid = output.sections.find(({ sectionId }) => sectionId === 'paid_ads_performance');
  const spend = paid.statements.find(({ text }) => text.includes('Spend'));
  const clicks = paid.statements.find(({ text }) => text.includes('Clicks'));
  paid.statements = [{
    text: `Meta Ads: Spend = ${spend.claims[0].renderedValue} THB; Clicks = ${clicks.claims[0].renderedValue}.`,
    platform: 'meta_ads',
    evidenceRefs: [...spend.evidenceRefs, ...clicks.evidenceRefs],
    claims: [...spend.claims, ...clicks.claims],
  }];
  assert.throws(
    () => validateLarkNativeAiOfflineOutput(bundle, output),
    (error) => error?.code === 'AI_MULTI_CLAIM_STATEMENT_UNSUPPORTED',
  );
});

test('rejects non-numeric evidence references from another platform', async () => {
  const { bundle, output } = await buildOutput('executive_mixed_availability');
  const recommendations = output.sections.find(({ sectionId }) => sectionId === 'recommendations');
  const tiktokRecommendation = recommendations.recommendations.find(({ platform }) => platform === 'tiktok');
  const instagram = bundle.channels.find(({ platform }) => platform === 'instagram');
  tiktokRecommendation.evidenceRefs = [instagram.evidenceIdentity];
  assert.throws(
    () => validateLarkNativeAiOfflineOutput(bundle, output),
    (error) => error?.code === 'AI_OUTPUT_EVIDENCE_PLATFORM_MISMATCH',
  );
});

test('rejects duplicate recommendations for the same platform', async () => {
  const { bundle, output } = await buildOutput('executive_mixed_availability');
  const recommendations = output.sections.find(({ sectionId }) => sectionId === 'recommendations');
  const tiktokRecommendation = recommendations.recommendations.find(({ platform }) => platform === 'tiktok');
  recommendations.recommendations.push(structuredClone(tiktokRecommendation));
  assert.throws(
    () => validateLarkNativeAiOfflineOutput(bundle, output),
    (error) => error?.code === 'AI_RECOMMENDATION_PLATFORM_DUPLICATE',
  );
});
