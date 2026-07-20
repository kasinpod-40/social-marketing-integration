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
  assert.equal(sent.length, 1);
  assert.deepEqual(sent[0], {
    ...ORIGINAL_JOB,
    requestedAt: '2026-07-19T00:00:00.000Z',
    redriveOfDlqId: 'dlq:message-old',
    redriveReference: 'redrive:dlq:message-old:1784419200000',
  });
  assert.equal(calls[0][0], 'read');
  assert.ok(calls[1][1].forbiddenJobTypes.includes('system.dead-letter.redrive'));
  assert.ok(calls[1][1].forbiddenJobTypes.includes('tiktok.creator.native.sync'));
  assert.equal(calls[1][1].forbiddenJobTypes.includes('youtube.channel.organic.sync'), false);
  assert.equal(calls[2][0], 'mark');
  assert.equal(calls[2][1].dlqId, 'dlq:message-old');
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
            payload: { schemaVersion: 1, type: 'tiktok.creator.native.sync' },
            redriveRequestedAt: null,
            redriveReference: null,
          };
        },
        async prepareDeadLetterRedrive() { prepareCalled = true; },
        async markDeadLetterRedriven() {},
      },
      queue: { async send() { sent = true; } },
      dlqId: 'dlq:tiktok-old',
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
