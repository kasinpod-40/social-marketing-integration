import test from 'node:test';
import assert from 'node:assert/strict';
import {
  permanentError,
  sanitizeOperationalError,
  sanitizeOperationalText,
  sanitizeOperationalValue,
  sanitizeQueueReplayValue,
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
    privateKey: 'PRIVATE',
    signingKey: 'SIGNING',
    credential: 'CREDENTIAL',
    safe: 'ok',
  });

  assert.equal(sanitized.expectedHandle, '[REDACTED]');
  assert.equal(sanitized.detectedHandles, '[REDACTED]');
  assert.equal(sanitized.missingAnalyticsStableKeys, '[REDACTED]');
  assert.equal(sanitized.missingVideoIds, 2);
  assert.equal(sanitized.apiToken, '[REDACTED]');
  assert.equal(sanitized.privateKey, '[REDACTED]');
  assert.equal(sanitized.signingKey, '[REDACTED]');
  assert.equal(sanitized.credential, '[REDACTED]');
  assert.equal(sanitized.safe, 'ok');
  assert.doesNotMatch(JSON.stringify(sanitized), /PRIVATE|SIGNING|CREDENTIAL/u);
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


test('queue replay sanitization preserves routing scope while removing all secret material', () => {
  const sanitized = sanitizeQueueReplayValue({
    schemaVersion: 1,
    type: 'youtube.channel.organic.sync',
    requestedAt: '2026-07-19T00:00:00.000Z',
    metricDate: '2026-07-18',
    channelId: 'channel_A',
    nested: {
      refreshToken: 'refresh-private',
      clientSecret: 'client-private',
      privateKey: 'PRIVATE',
      signingKey: 'SIGNING',
      credential: 'CREDENTIAL',
      safeId: 'video_A',
      pageToken: 'page-2',
    },
  });

  assert.equal(sanitized.channelId, 'channel_A');
  assert.equal(sanitized.nested.safeId, 'video_A');
  assert.equal(sanitized.nested.pageToken, 'page-2');
  assert.equal(sanitized.nested.refreshToken, '[REDACTED]');
  assert.equal(sanitized.nested.clientSecret, '[REDACTED]');
  assert.equal(sanitized.nested.privateKey, '[REDACTED]');
  assert.equal(sanitized.nested.signingKey, '[REDACTED]');
  assert.equal(sanitized.nested.credential, '[REDACTED]');
  assert.doesNotMatch(
    JSON.stringify(sanitized),
    /refresh-private|client-private|PRIVATE|SIGNING|CREDENTIAL/u,
  );
});
