import test from 'node:test';
import assert from 'node:assert/strict';
import {
  permanentError,
  sanitizeOperationalError,
  sanitizeOperationalText,
  sanitizeOperationalValue,
  transientError,
} from '../../packages/shared/src/errors/runtime-error.js';

test('operational error sanitization removes source identity from messages and details', () => {
  const error = permanentError(
    'YouTube channel identity mismatch: expected=channel_A, actual=channel_B',
    {
      code: 'YOUTUBE_CHANNEL_IDENTITY_MISMATCH',
      details: {
        requestedChannelId: 'channel_A',
        mismatchedVideos: ['video_A'],
        resultCount: 1,
      },
    },
  );

  const sanitized = sanitizeOperationalError(error);
  assert.equal(sanitized.message, 'Source identity validation failed');
  assert.equal(sanitized.details.requestedChannelId, '[REDACTED]');
  assert.equal(sanitized.details.mismatchedVideos, '[REDACTED]');
  assert.equal(sanitized.details.resultCount, 1);
  assert.doesNotMatch(JSON.stringify(sanitized), /channel_A|channel_B|video_A/u);
});

test('structured operational sanitization keeps counts but redacts stable keys, handles and secrets', () => {
  const sanitized = sanitizeOperationalValue({
    expectedHandle: 'customer.handle',
    detectedHandles: ['other.handle'],
    missingAnalyticsStableKeys: ['youtube:channel_A:video_A:2026-07-14'],
    missingVideoIds: 2,
    apiToken: 'private',
    safe: 'ok',
  });

  assert.equal(sanitized.expectedHandle, '[REDACTED]');
  assert.equal(sanitized.detectedHandles, '[REDACTED]');
  assert.equal(sanitized.missingAnalyticsStableKeys, '[REDACTED]');
  assert.equal(sanitized.missingVideoIds, 2);
  assert.equal(sanitized.apiToken, '[REDACTED]');
  assert.equal(sanitized.safe, 'ok');
});

test('sync lock messages use the error code without exposing the scoped lock key', () => {
  const error = transientError('Sync lock is busy: customer:youtube:account:sync', {
    code: 'SYNC_LOCK_BUSY',
    details: { lockKey: 'customer:youtube:account:sync' },
  });
  const sanitized = sanitizeOperationalError(error);

  assert.equal(sanitized.message, 'Sync lock operation failed');
  assert.equal(sanitized.details.lockKey, '[REDACTED]');
  assert.equal(
    sanitizeOperationalText('RAW TikTok source handle mismatch: expected @customer, detected @other'),
    'Source identity validation failed',
  );
});
