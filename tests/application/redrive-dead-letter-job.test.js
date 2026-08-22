import test from 'node:test';
import assert from 'node:assert/strict';
import { redriveDeadLetterJob } from '../../packages/application/src/use-cases/redrive-dead-letter-job.js';

const ORIGINAL_JOB = Object.freeze({
  schemaVersion: 1,
  type: 'youtube.channel.organic.sync',
  trigger: 'scheduled',
  requestedAt: '2026-07-18T00:00:00.000Z',
  metricDate: '2026-07-18',
  syncMode: 'auto',
  analyticsEnabled: false,
});

const TIKTOK_UAT_JOB = Object.freeze({
  schemaVersion: 1,
  type: 'tiktok.creator.native.sync',
  trigger: 'production_connector_uat',
  requestedAt: '2026-08-22T10:43:35.801Z',
  metricDate: '2026-08-22',
});

const GOOGLE_RUN_ID = '123e4567-e89b-42d3-a456-426614174000';
const GOOGLE_GENERATION = Date.parse('2026-07-25T04:00:00.000Z');
const GOOGLE_JOB = Object.freeze({
  schemaVersion: 1,
  type: 'google.ads.manager.signed-delivery.process',
  operationId: GOOGLE_RUN_ID,
  workKey: `google_ads:${GOOGLE_RUN_ID}`,
  generation: GOOGLE_GENERATION,
  originalRequestedAt: GOOGLE_GENERATION,
  requestedAt: new Date(GOOGLE_GENERATION).toISOString(),
});

test('redrive reserves one generation, sends the original payload, and marks it redriven', async () => {
  const calls = [];
  const store = {
    async readDeadLetterRedriveCandidate(input) {
      calls.push(['read', input]);
      return {
        dlqId: input.dlqId,
        schemaVersion: 1,
        payload: ORIGINAL_JOB,
        status: 'open',
        redriveRequestedAt: null,
        redriveReference: null,
      };
    },
    async prepareDeadLetterRedrive(input) {
      calls.push(['prepare', input]);
      return {
        dlqId: input.dlqId,
        schemaVersion: 1,
        payload: ORIGINAL_JOB,
        status: 'redrive_pending',
        redriveRequestedAt: input.requestedAt,
        redriveReference: input.redriveReference,
      };
    },
    async markDeadLetterRedriven(input) { calls.push(['mark', input]); },
  };
  const sent = [];
  const queue = { async send(body) { sent.push(body); } };
  const nowValues = [Date.parse('2026-07-19T00:00:00.000Z'), Date.parse('2026-07-19T00:00:01.000Z')];

  const result = await redriveDeadLetterJob({
    store,
    queue,
    dlqId: 'dlq:message-old',
    now: () => nowValues.shift(),
  });

  assert.equal(result.status, 'redriven');
  assert.equal(result.queueSend, 'sent');
  assert.equal(sent.length, 1);
  assert.deepEqual(sent[0], {
    ...ORIGINAL_JOB,
    requestedAt: '2026-07-19T00:00:00.000Z',
    redriveOfDlqId: 'dlq:message-old',
    redriveReference: 'redrive:dlq:message-old:1784419200000',
  });
  assert.equal(calls[0][0], 'read');
  assert.ok(calls[1][1].forbiddenJobTypes.includes('system.dead-letter.redrive'));
  assert.equal(calls[1][1].forbiddenJobTypes.includes('tiktok.creator.native.sync'), false);
  assert.equal(calls[1][1].forbiddenJobTypes.includes('youtube.channel.organic.sync'), false);
  assert.equal(calls[1][1].forbiddenJobTypes.includes('google.ads.manager.signed-delivery.process'), false);
  assert.equal(calls[2][0], 'mark');
  assert.equal(calls[2][1].dlqId, 'dlq:message-old');
});

test('TikTok Production UAT redrive preserves the controlled trigger and metric date on a fresh generation', async () => {
  const calls = [];
  const sent = [];
  const redriveAt = Date.parse('2026-08-22T11:30:00.000Z');
  const store = {
    async readDeadLetterRedriveCandidate(input) {
      calls.push(['read', input]);
      return {
        dlqId: input.dlqId,
        schemaVersion: 1,
        payload: TIKTOK_UAT_JOB,
        status: 'open',
        redriveRequestedAt: null,
        redriveReference: null,
      };
    },
    async prepareDeadLetterRedrive(input) {
      calls.push(['prepare', input]);
      return {
        dlqId: input.dlqId,
        schemaVersion: 1,
        payload: TIKTOK_UAT_JOB,
        status: 'redrive_pending',
        redriveRequestedAt: input.requestedAt,
        redriveReference: input.redriveReference,
      };
    },
    async markDeadLetterRedriven(input) { calls.push(['mark', input]); },
  };

  const result = await redriveDeadLetterJob({
    store,
    queue: { async send(body) { sent.push(structuredClone(body)); } },
    dlqId: 'terminal:tiktok-production-uat',
    now: (() => {
      const values = [redriveAt, redriveAt + 1000];
      return () => values.shift();
    })(),
  });

  assert.equal(result.status, 'redriven');
  assert.equal(result.queueSend, 'sent');
  assert.equal(result.jobType, TIKTOK_UAT_JOB.type);
  assert.equal(sent.length, 1);
  assert.deepEqual(sent[0], {
    ...TIKTOK_UAT_JOB,
    requestedAt: '2026-08-22T11:30:00.000Z',
    redriveOfDlqId: 'terminal:tiktok-production-uat',
    redriveReference: `redrive:terminal:tiktok-production-uat:${redriveAt}`,
  });
  assert.equal(sent[0].trigger, 'production_connector_uat');
  assert.equal(sent[0].metricDate, '2026-08-22');
  assert.notEqual(sent[0].requestedAt, TIKTOK_UAT_JOB.requestedAt);
  assert.equal(calls[1][1].forbiddenJobTypes.includes('tiktok.creator.native.sync'), false);
  assert.equal(calls[2][0], 'mark');
});

test('retry after queue send reuses the persisted generation so duplicate messages fence each other', async () => {
  const prepared = {
    dlqId: 'dlq:message-old',
    schemaVersion: 1,
    payload: ORIGINAL_JOB,
    status: 'redrive_pending',
    redriveRequestedAt: Date.parse('2026-07-19T00:00:00.000Z'),
    redriveReference: 'redrive:dlq:message-old:1784419200000',
  };
  let markCalls = 0;
  const store = {
    async readDeadLetterRedriveCandidate() { return prepared; },
    async prepareDeadLetterRedrive() { return prepared; },
    async markDeadLetterRedriven() {
      markCalls += 1;
      if (markCalls === 1) throw new Error('Synthetic mark failure after Queue send');
    },
  };
  const sent = [];
  const queue = { async send(body) { sent.push(body); } };

  await assert.rejects(
    redriveDeadLetterJob({ store, queue, dlqId: prepared.dlqId, now: () => Date.parse('2026-07-19T00:00:02.000Z') }),
    /Synthetic mark failure/,
  );
  await redriveDeadLetterJob({
    store,
    queue,
    dlqId: prepared.dlqId,
    now: () => Date.parse('2026-07-19T00:00:03.000Z'),
  });

  assert.equal(sent.length, 2);
  assert.equal(sent[0].requestedAt, sent[1].requestedAt);
  assert.equal(sent[0].redriveReference, sent[1].redriveReference);
});

test('Google Ads redrive sends the exact original reference without redrive metadata', async () => {
  const calls = [];
  const store = {
    async readDeadLetterRedriveCandidate() {
      return {
        status: 'open',
        schemaVersion: 1,
        payload: GOOGLE_JOB,
        redriveRequestedAt: null,
        redriveReference: null,
      };
    },
    async prepareDeadLetterRedrive(input) {
      calls.push(['prepare-dead-letter', input]);
      return {
        status: 'redrive_pending',
        schemaVersion: 1,
        payload: GOOGLE_JOB,
        redriveRequestedAt: input.requestedAt,
        redriveReference: input.redriveReference,
      };
    },
    async markDeadLetterRedriven(input) { calls.push(['mark-dead-letter', input]); },
  };
  const googleAdsRedriveStore = {
    async prepare(input) {
      calls.push(['prepare-google-ads', input]);
      return { disposition: 'send_pending' };
    },
    async markQueued(input) {
      calls.push(['mark-google-ads-queued', input]);
      return { disposition: 'queued' };
    },
  };
  const sent = [];
  const nowValues = [
    Date.parse('2026-07-26T00:00:00.000Z'),
    Date.parse('2026-07-26T00:00:01.000Z'),
    Date.parse('2026-07-26T00:00:02.000Z'),
    Date.parse('2026-07-26T00:00:03.000Z'),
  ];
  const result = await redriveDeadLetterJob({
    store,
    googleAdsRedriveStore,
    queue: { async send(body) { sent.push(structuredClone(body)); } },
    dlqId: 'dlq:google-ads-old',
    now: () => nowValues.shift(),
  });

  assert.equal(result.status, 'redriven');
  assert.equal(result.queueSend, 'sent');
  assert.equal(sent.length, 1);
  assert.deepEqual(sent[0], GOOGLE_JOB);
  assert.deepEqual(Object.keys(sent[0]).sort(), Object.keys(GOOGLE_JOB).sort());
  assert.equal('redriveOfDlqId' in sent[0], false);
  assert.equal('redriveReference' in sent[0], false);
  assert.equal(sent[0].requestedAt, GOOGLE_JOB.requestedAt);
  assert.equal(calls.find(([name]) => name === 'prepare-google-ads')[1].generation, GOOGLE_GENERATION);
});

test('Google Ads ambiguous send retry emits only identical stable references', async () => {
  const prepared = {
    status: 'redrive_pending',
    schemaVersion: 1,
    payload: GOOGLE_JOB,
    redriveRequestedAt: Date.parse('2026-07-26T00:00:00.000Z'),
    redriveReference: 'redrive:dlq:google-ads-old:1785024000000',
  };
  const store = {
    async readDeadLetterRedriveCandidate() { return prepared; },
    async prepareDeadLetterRedrive() { return prepared; },
    async markDeadLetterRedriven() {},
  };
  let queuedMarkers = 0;
  const googleAdsRedriveStore = {
    async prepare() { return { disposition: 'send_pending' }; },
    async markQueued() {
      queuedMarkers += 1;
      if (queuedMarkers === 1) throw new Error('Synthetic queued marker ambiguity');
      return { disposition: 'queued' };
    },
  };
  const sent = [];
  const queue = { async send(body) { sent.push(structuredClone(body)); } };

  await assert.rejects(
    () => redriveDeadLetterJob({
      store,
      googleAdsRedriveStore,
      queue,
      dlqId: 'dlq:google-ads-old',
      now: () => Date.parse('2026-07-26T00:00:04.000Z'),
    }),
    /Synthetic queued marker ambiguity/,
  );
  await redriveDeadLetterJob({
    store,
    googleAdsRedriveStore,
    queue,
    dlqId: 'dlq:google-ads-old',
    now: () => Date.parse('2026-07-26T00:00:05.000Z'),
  });

  assert.equal(sent.length, 2);
  assert.deepEqual(sent[0], GOOGLE_JOB);
  assert.deepEqual(sent[1], GOOGLE_JOB);
});

test('Google Ads prepared admission avoids another Queue send after dead-letter mark ambiguity', async () => {
  const prepared = {
    status: 'redrive_pending',
    schemaVersion: 1,
    payload: GOOGLE_JOB,
    redriveRequestedAt: Date.parse('2026-07-26T00:00:00.000Z'),
    redriveReference: 'redrive:dlq:google-ads-old:1785024000000',
  };
  let marked = false;
  const result = await redriveDeadLetterJob({
    store: {
      async readDeadLetterRedriveCandidate() { return prepared; },
      async prepareDeadLetterRedrive() { return prepared; },
      async markDeadLetterRedriven() { marked = true; },
    },
    googleAdsRedriveStore: {
      async prepare() { return { disposition: 'already_queued' }; },
      async markQueued() { throw new Error('must not mark queued'); },
    },
    queue: { async send() { throw new Error('must not send'); } },
    dlqId: 'dlq:google-ads-old',
    now: () => Date.parse('2026-07-26T00:00:06.000Z'),
  });
  assert.equal(result.queueSend, 'already_admitted');
  assert.equal(marked, true);
});

test('unsupported job types fail before prepare mutation or Queue send', async () => {
  let prepareCalled = false;
  let sent = false;
  await assert.rejects(
    redriveDeadLetterJob({
      store: {
        async readDeadLetterRedriveCandidate() {
          return {
            status: 'open',
            schemaVersion: 1,
            payload: { schemaVersion: 1, type: 'metric.definitions.seed' },
            redriveRequestedAt: null,
            redriveReference: null,
          };
        },
        async prepareDeadLetterRedrive() { prepareCalled = true; },
        async markDeadLetterRedriven() {},
      },
      queue: { async send() { sent = true; } },
      dlqId: 'dlq:unsupported-old',
    }),
    (error) => error?.code === 'DEAD_LETTER_REDRIVE_JOB_TYPE_UNSUPPORTED'
      && error.retryable === false,
  );
  assert.equal(prepareCalled, false);
  assert.equal(sent, false);
});

test('already-redriven jobs are no-op and recursive commands fail before prepare mutation', async () => {
  const queue = { async send() { throw new Error('must not send'); } };
  const already = await redriveDeadLetterJob({
    store: {
      async readDeadLetterRedriveCandidate() {
        return {
          status: 'redriven',
          redriveRequestedAt: Date.parse('2026-07-19T00:00:00.000Z'),
          redriveReference: 'redrive:done',
        };
      },
      async prepareDeadLetterRedrive() { throw new Error('must not prepare'); },
      async markDeadLetterRedriven() {},
    },
    queue,
    dlqId: 'dlq:done',
  });
  assert.equal(already.status, 'already_redriven');

  let prepareCalled = false;
  await assert.rejects(
    redriveDeadLetterJob({
      store: {
        async readDeadLetterRedriveCandidate() {
          return {
            status: 'open',
            schemaVersion: 1,
            payload: { type: 'system.dead-letter.redrive', dlqId: 'dlq:self' },
            redriveRequestedAt: null,
            redriveReference: null,
          };
        },
        async prepareDeadLetterRedrive() { prepareCalled = true; },
        async markDeadLetterRedriven() {},
      },
      queue: { async send() {} },
      dlqId: 'dlq:self',
    }),
    (error) => error?.code === 'DEAD_LETTER_REDRIVE_RECURSION_BLOCKED',
  );
  assert.equal(prepareCalled, false);
});
