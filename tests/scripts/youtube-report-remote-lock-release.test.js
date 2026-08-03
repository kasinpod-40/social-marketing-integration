import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  YOUTUBE_REPORT_REMOTE_LOCK_RELEASE_CONTRACT,
  YOUTUBE_REPORT_REMOTE_LOCK_RELEASE_ENV,
  assertYouTubeReportRemoteLockReleaseEvidence,
  loadYouTubeReportRemoteLockReleaseEvidence,
} from '../../scripts/lib/youtube-report-remote-lock-release.js';

const HEAD = 'a'.repeat(40);
const EVIDENCE_SHA256 = 'b'.repeat(64);
const reviewedTerminalUrl = new URL(
  '../../scripts/youtube-report-remote-readiness-reviewed-terminal.mjs',
  import.meta.url,
);
const reviewedSource = readFileSync(reviewedTerminalUrl, 'utf8');

function validEvidence(overrides = {}) {
  return {
    contractVersion: YOUTUBE_REPORT_REMOTE_LOCK_RELEASE_CONTRACT,
    released: true,
    auditHead: HEAD,
    evidenceSha256: EVIDENCE_SHA256,
    capturedAt: Date.parse('2026-08-03T07:00:00Z'),
    repository: {
      clean: true,
      head: HEAD,
      reviewedHead: HEAD,
    },
    runtime: {
      allExecutionFlagsFalse: true,
      previewUrlsDisabled: true,
      scheduleEnabled: false,
      production: 'BLOCKED',
      activeWorkCount: 0,
      activeLockCount: 0,
      uncertainQueueCount: 0,
    },
    ...overrides,
  };
}

test('valid retained Meta lock-release evidence is reduced to bounded authority', () => {
  assert.deepEqual(assertYouTubeReportRemoteLockReleaseEvidence(validEvidence()), {
    released: true,
    auditHead: HEAD,
    evidenceSha256: EVIDENCE_SHA256,
    capturedAt: Date.parse('2026-08-03T07:00:00Z'),
  });
});

test('retained evidence loader requires a file and does not accept a caller Boolean', async () => {
  await assert.rejects(
    loadYouTubeReportRemoteLockReleaseEvidence({
      env: { MKT_META_REMOTE_LOCK_RELEASED: 'true' },
    }),
    (error) => error.code === 'YOUTUBE_REPORT_REMOTE_LOCK_RELEASE_EVIDENCE_REQUIRED',
  );
});

test('retained evidence rejects unsafe runtime state and nested credentials', () => {
  assert.throws(
    () => assertYouTubeReportRemoteLockReleaseEvidence(validEvidence({
      runtime: { ...validEvidence().runtime, activeWorkCount: 1 },
    })),
    (error) => error.code === 'YOUTUBE_REPORT_REMOTE_LOCK_RELEASE_INVALID',
  );
  assert.throws(
    () => assertYouTubeReportRemoteLockReleaseEvidence(validEvidence({
      nested: { authorization: 'Bearer secret' },
    })),
    (error) => error.code === 'YOUTUBE_REPORT_REMOTE_LOCK_RELEASE_NOT_SANITIZED',
  );
});

test('loader reads one retained sanitized evidence file', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'youtube-lock-release-'));
  const path = join(directory, 'lock-release.json');
  try {
    await writeFile(path, JSON.stringify(validEvidence()));
    const result = await loadYouTubeReportRemoteLockReleaseEvidence({
      env: { [YOUTUBE_REPORT_REMOTE_LOCK_RELEASE_ENV]: path },
    });
    assert.equal(result.released, true);
    assert.equal(result.auditHead, HEAD);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('reviewed terminal blocks on retained lock evidence before Remote collector', () => {
  const repositoryStage = reviewedSource.indexOf("stage = 'repository-read-only-preflight'");
  const lockStage = reviewedSource.indexOf("stage = 'meta-remote-lock-release-preflight'");
  const collectorStage = reviewedSource.indexOf("stage = 'run-internal-read-only-collector'");
  assert.ok(repositoryStage >= 0);
  assert.ok(lockStage > repositoryStage);
  assert.ok(collectorStage > lockStage);
  assert.match(reviewedSource, /loadYouTubeReportRemoteLockReleaseEvidence/u);
  assert.match(reviewedSource, /callerBooleanAccepted:\s*false/u);
});
