import test from 'node:test';
import assert from 'node:assert/strict';

import { redriveDeadLetterJob } from '../../packages/application/src/use-cases/redrive-dead-letter-job.js';

const GENERATION = Date.parse('2026-08-10T00:30:00.000Z');
const FACEBOOK_JOB = Object.freeze({
  schemaVersion: 1,
  type: 'facebook.page.organic.sync',
  trigger: 'manual_uat',
  operationId: 'facebook-dashboard-repair-20260809-v1',
  workKey: 'facebook:facebook-dashboard-repair-20260809-v1',
  generation: GENERATION,
  originalRequestedAt: GENERATION,
  requestedAt: new Date(GENERATION).toISOString(),
  periodStart: '2026-08-09',
  periodEnd: '2026-08-09',
  dryRun: false,
  d1Only: false,
});

function deadLetterStore(calls) {
  return {
    async readDeadLetterRedriveCandidate() {
      calls.push(['read-dead-letter']);
      return {
        status: 'open',
        schemaVersion: 1,
        payload: FACEBOOK_JOB,
        redriveRequestedAt: null,
        redriveReference: null,
      };
    },
    async prepareDeadLetterRedrive(input) {
      calls.push(['prepare-dead-letter', input]);
      return {
        status: 'redrive_pending',
        schemaVersion: 1,
        payload: FACEBOOK_JOB,
        redriveRequestedAt: input.requestedAt,
        redriveReference: input.redriveReference,
      };
    },
    async markDeadLetterRedriven(input) {
      calls.push(['mark-dead-letter', input]);
    },
  };
}

test('Facebook redrive revives exact completed-source generation and sends byte-for-field original body', async () => {
  const calls = [];
  const sent = [];
  const nowValues = [
    Date.parse('2026-08-11T00:00:00.000Z'),
    Date.parse('2026-08-11T00:00:01.000Z'),
    Date.parse('2026-08-11T00:00:02.000Z'),
  ];

  const result = await redriveDeadLetterJob({
    store: deadLetterStore(calls),
    stableOperationRedriveStore: {
      async prepareCompletedSourceRedrive(input) {
        calls.push(['prepare-stable-work', input]);
        return { disposition: 'revived' };
      },
    },
    queue: {
      async send(body) {
        sent.push(structuredClone(body));
      },
    },
    dlqId: 'terminal:facebook-message-173',
    now: () => nowValues.shift(),
  });

  assert.equal(result.status, 'redriven');
  assert.equal(result.jobType, FACEBOOK_JOB.type);
  assert.equal(result.queueSend, 'sent');
  assert.equal(sent.length, 1);
  assert.deepEqual(sent[0], FACEBOOK_JOB);
  assert.deepEqual(Object.keys(sent[0]).sort(), Object.keys(FACEBOOK_JOB).sort());
  assert.equal('redriveOfDlqId' in sent[0], false);
  assert.equal('redriveReference' in sent[0], false);

  const prepare = calls.find(([name]) => name === 'prepare-stable-work')[1];
  assert.equal(prepare.workKey, FACEBOOK_JOB.workKey);
  assert.equal(prepare.generation, GENERATION);
  assert.equal(prepare.sourcePhase, 'meta_end_to_end_source_staging_v1');
  assert.match(prepare.auditReference, /^redrive:terminal:facebook-message-173:/u);
  assert.ok(calls.some(([name]) => name === 'mark-dead-letter'));
});

test('Facebook redrive does not send when the exact Work is already processing', async () => {
  let sent = false;
  let marked = false;
  const result = await redriveDeadLetterJob({
    store: {
      ...deadLetterStore([]),
      async markDeadLetterRedriven() { marked = true; },
    },
    stableOperationRedriveStore: {
      async prepareCompletedSourceRedrive() {
        return { disposition: 'already_processing' };
      },
    },
    queue: { async send() { sent = true; } },
    dlqId: 'terminal:facebook-message-173',
    now: (() => {
      const values = [
        Date.parse('2026-08-11T00:01:00.000Z'),
        Date.parse('2026-08-11T00:01:01.000Z'),
        Date.parse('2026-08-11T00:01:02.000Z'),
      ];
      return () => values.shift();
    })(),
  });

  assert.equal(result.queueSend, 'already_admitted');
  assert.equal(sent, false);
  assert.equal(marked, true);
});
