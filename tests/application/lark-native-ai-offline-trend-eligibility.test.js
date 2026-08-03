import assert from 'node:assert/strict';
import test from 'node:test';

import { buildLarkNativeAiOfflineBundle } from '../../packages/application/src/reports/build-lark-native-ai-offline-bundle.js';
import { renderLarkNativeAiOfflinePreview } from '../../packages/application/src/reports/render-lark-native-ai-offline-preview.js';
import { validateLarkNativeAiOfflineOutput } from '../../packages/application/src/reports/validate-lark-native-ai-offline-output.js';
import { createLarkNativeAiOfflineFixture } from '../fixtures/lark-native-ai-offline-preview-fixtures.js';

function addTrendLanguage(output) {
  const organic = output.sections.find(({ sectionId }) => sectionId === 'organic_performance');
  const statement = organic.statements[0];
  assert.ok(statement, 'fixture must expose one organic numeric statement');
  statement.text = statement.text.replace('=', 'increased to');
}

test('allows trend language only for complete, covered, fresh and clean Report evidence', async () => {
  const bundle = await buildLarkNativeAiOfflineBundle(
    createLarkNativeAiOfflineFixture('tiktok_complete_golden_dataset').input,
  );
  const output = structuredClone(renderLarkNativeAiOfflinePreview(bundle));
  addTrendLanguage(output);
  assert.equal(validateLarkNativeAiOfflineOutput(bundle, output).ok, true);
});

for (const fixtureName of ['instagram_partial', 'stale_report']) {
  test(`rejects trend language for ${fixtureName} evidence`, async () => {
    const bundle = await buildLarkNativeAiOfflineBundle(
      createLarkNativeAiOfflineFixture(fixtureName).input,
    );
    const output = structuredClone(renderLarkNativeAiOfflinePreview(bundle));
    addTrendLanguage(output);
    assert.throws(
      () => validateLarkNativeAiOfflineOutput(bundle, output),
      (error) => error?.code === 'AI_TREND_INCOMPLETE_EVIDENCE',
    );
  });
}

test('rejects trend language when Report data-quality issues are present', async () => {
  const input = createLarkNativeAiOfflineFixture('tiktok_complete_golden_dataset').input;
  input.channels.find(({ platform }) => platform === 'tiktok').report.dataQualityIssues.push({
    code: 'QUALITY_LIMITATION',
    severity: 'warning',
    message: 'Validated Report contains a data-quality limitation.',
  });
  const bundle = await buildLarkNativeAiOfflineBundle(input);
  const output = structuredClone(renderLarkNativeAiOfflinePreview(bundle));
  addTrendLanguage(output);
  assert.throws(
    () => validateLarkNativeAiOfflineOutput(bundle, output),
    (error) => error?.code === 'AI_TREND_INCOMPLETE_EVIDENCE',
  );
});
