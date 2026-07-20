import test from 'node:test';
import assert from 'node:assert/strict';
import {
  consumeTikTokStagedSourceUnits,
  iterateTikTokStagedSourceUnits,
} from '../../packages/application/src/use-cases/tiktok-resumable-unit-reader.js';

function createContext({ units, expectedRecords = null, complete = true }) {
  const pageCalls = [];
  return {
    pageCalls,
    workKey: 'tiktok:message-1',
    async assertCurrent() {},
    store: {
      async loadPhase() {
        return {
          complete,
          processedItems: expectedRecords ?? units.reduce((sum, unit) => sum + unit.payload.records.length, 0),
          pagesProcessed: units.length,
        };
      },
      async listPhaseUnits({ afterSequence, limit }) {
        pageCalls.push({ afterSequence, limit });
        const selected = units
          .filter((unit) => unit.sequence >= afterSequence)
          .slice(0, limit);
        return {
          units: selected,
          nextSequence: selected.length === limit
            ? selected.at(-1).sequence + 1
            : null,
        };
      },
    },
  };
}

test('TikTok staged unit consumer processes 10,000 records without rebuilding one source array', async () => {
  const units = Array.from({ length: 100 }, (_, sequence) => ({
    unitKey: `page:${sequence + 1}`,
    sequence,
    payload: {
      records: Array.from({ length: 100 }, (_, index) => ({
        recordId: `record-${sequence * 100 + index + 1}`,
      })),
    },
  }));
  const context = createContext({ units });
  let activeUnits = 0;
  let maxActiveUnits = 0;
  let maxRecordsSeen = 0;

  const summary = await consumeTikTokStagedSourceUnits({
    context,
    limit: 7,
    consumeUnit: async (unit) => {
      activeUnits += 1;
      maxActiveUnits = Math.max(maxActiveUnits, activeUnits);
      maxRecordsSeen = Math.max(maxRecordsSeen, unit.records.length);
      assert.equal(unit.records.length, 100);
      activeUnits -= 1;
    },
  });

  assert.deepEqual(summary, {
    unitsProcessed: 100,
    recordsProcessed: 10_000,
    maxUnitRecords: 100,
    expectedRecords: 10_000,
    pagesProcessed: 100,
  });
  assert.equal(maxActiveUnits, 1);
  assert.equal(maxRecordsSeen, 100);
  assert.ok(context.pageCalls.length > 1);
});

test('TikTok staged unit consumer fails when durable counts do not match consumed records', async () => {
  const context = createContext({
    units: [{ unitKey: 'page:1', sequence: 0, payload: { records: [{ id: '1' }] } }],
    expectedRecords: 2,
  });

  await assert.rejects(
    consumeTikTokStagedSourceUnits({ context, consumeUnit: async () => {} }),
    (error) => error?.code === 'TIKTOK_SOURCE_STAGING_INCOMPLETE' && error.retryable === false,
  );
});

test('TikTok staged unit reader refuses an incomplete phase before business processing', async () => {
  const context = createContext({ units: [], complete: false });
  await assert.rejects(
    consumeTikTokStagedSourceUnits({ context, consumeUnit: async () => {} }),
    (error) => error?.code === 'TIKTOK_SOURCE_STAGING_INCOMPLETE' && error.retryable === false,
  );
});

test('TikTok staged unit iterator yields units in sequence across bounded store pages', async () => {
  const units = [0, 1, 2].map((sequence) => ({
    unitKey: `page:${sequence + 1}`,
    sequence,
    payload: { records: [{ sequence }] },
  }));
  const context = createContext({ units });
  const sequences = [];

  for await (const unit of iterateTikTokStagedSourceUnits({ context, limit: 2 })) {
    sequences.push(unit.sequence);
  }

  assert.deepEqual(sequences, [0, 1, 2]);
  assert.deepEqual(context.pageCalls.map((call) => call.afterSequence), [0, 2]);
});
