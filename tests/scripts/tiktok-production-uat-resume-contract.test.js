import assert from 'node:assert/strict';
import test from 'node:test';

import {
  TIKTOK_PRODUCTION_RESUME,
  buildResumeIdempotencyEnvelope,
  buildResumeRedriveEnvelope,
  validateResumeDlqRow,
  validateResumeSuccessRun,
  validateRootRedrivenRow,
} from '../../scripts/lib/tiktok-production-uat-resume-contract.js';

const ROOT = {
  dlq_id: TIKTOK_PRODUCTION_RESUME.rootDlqId,
  job_type: 'tiktok.creator.native.sync',
  status: 'redriven',
  redrive_requested_at: TIKTOK_PRODUCTION_RESUME.rootRedriveRequestedAt,
  redrive_reference: TIKTOK_PRODUCTION_RESUME.rootRedriveReference,
  redriven_at: 1787424211745,
};

const RESUME_PAYLOAD = {
  schemaVersion: 1,
  type: 'tiktok.creator.native.sync',
  trigger: 'production_connector_uat',
  metricDate: '2026-08-22',
  requestedAt: '2026-08-23T02:22:00.000Z',
  redriveOfDlqId: TIKTOK_PRODUCTION_RESUME.parentDlqId,
  redriveReference: `redrive:${TIKTOK_PRODUCTION_RESUME.parentDlqId}:1787450940163`,
};

const RESUME = {
  dlq_id: TIKTOK_PRODUCTION_RESUME.resumeDlqId,
  message_id: TIKTOK_PRODUCTION_RESUME.resumeMessageId,
  job_type: 'tiktok.creator.native.sync',
  status: 'open',
  error_code: 'QUEUE_RETRY_EXHAUSTED',
  created_at: TIKTOK_PRODUCTION_RESUME.resumeCreatedAt,
  payload_json: JSON.stringify(RESUME_PAYLOAD),
};

test('validates the immutable root redrive evidence', () => {
  assert.equal(validateRootRedrivenRow(ROOT).status, 'redriven');
  assert.throws(
    () => validateRootRedrivenRow({ ...ROOT, status: 'open' }),
    /root status mismatch/u,
  );
});

test('accepts only exact fef queue-exhaustion DLQ linked to b86 parent generation', () => {
  const validated = validateResumeDlqRow(RESUME);
  assert.equal(validated.dlqId, TIKTOK_PRODUCTION_RESUME.resumeDlqId);
  assert.equal(validated.payload.redriveOfDlqId, TIKTOK_PRODUCTION_RESUME.parentDlqId);

  assert.throws(
    () => validateResumeDlqRow({
      ...RESUME,
      payload_json: JSON.stringify({ ...RESUME_PAYLOAD, redriveOfDlqId: 'terminal:other' }),
    }),
    /redriveOfDlqId mismatch/u,
  );
  assert.throws(
    () => validateResumeDlqRow({
      ...RESUME,
      payload_json: JSON.stringify({ ...RESUME_PAYLOAD, redriveReference: 'redrive:terminal:other:1' }),
    }),
    /does not preserve the b86 parent lineage/u,
  );
  assert.throws(
    () => validateResumeDlqRow({ ...RESUME, error_code: 'OTHER' }),
    /resume error_code mismatch/u,
  );
  assert.throws(
    () => validateResumeDlqRow({ ...RESUME, message_id: 'other' }),
    /resume message_id mismatch/u,
  );
});

test('builds a canonical redrive for fef only', () => {
  assert.deepEqual(buildResumeRedriveEnvelope(), {
    body: {
      schemaVersion: 1,
      type: 'system.dead-letter.redrive',
      dlqId: TIKTOK_PRODUCTION_RESUME.resumeDlqId,
    },
  });
});

test('idempotency rerun strips redrive lineage and uses a fresh requestedAt', () => {
  const requestedAt = 1787453000000;
  const envelope = buildResumeIdempotencyEnvelope(RESUME_PAYLOAD, requestedAt);
  assert.equal(envelope.body.type, 'tiktok.creator.native.sync');
  assert.equal(envelope.body.trigger, 'production_connector_uat');
  assert.equal(envelope.body.metricDate, '2026-08-22');
  assert.equal(envelope.body.requestedAt, new Date(requestedAt).toISOString());
  assert.equal('redriveOfDlqId' in envelope.body, false);
  assert.equal('redriveReference' in envelope.body, false);
});

test('success validation rejects latest stale row and idempotency business writes', () => {
  const success = {
    sync_run_id: 'fresh-success',
    customer_profile: 'chemistry_k',
    platform: 'tiktok',
    sync_type: 'native_import',
    status: 'success',
    error_code: null,
    records_created: 0,
    records_updated: 0,
    records_written: 0,
  };
  assert.equal(validateResumeSuccessRun(success, { idempotency: true }).sync_run_id, 'fresh-success');
  assert.throws(
    () => validateResumeSuccessRun({ ...success, sync_run_id: TIKTOK_PRODUCTION_RESUME.staleRunId }),
    /Stale pre-resume/u,
  );
  assert.throws(
    () => validateResumeSuccessRun({ ...success, records_written: 1 }, { idempotency: true }),
    /Idempotency rerun produced a business write/u,
  );
});
