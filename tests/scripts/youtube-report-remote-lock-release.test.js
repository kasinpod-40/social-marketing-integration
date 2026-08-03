import test from 'node:test';
import assert from 'node:assert/strict';
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  YOUTUBE_REPORT_REMOTE_LOCK_RELEASE_ENV,
  assertYouTubeReportRemoteLockReleaseEvidence,
  createYouTubeReportRemoteLockReleaseEvidence,
  loadYouTubeReportRemoteLockReleaseEvidence,
} from '../../scripts/lib/youtube-report-remote-lock-release.js';

const HEAD = 'a'.repeat(40);
const OTHER_HEAD = 'c'.repeat(40);
const CAPTURED_AT = Date.parse('2026-08-03T07:00:00Z');
const reviewedTerminalUrl = new URL(
  '../../scripts/youtube-report-remote-readiness-reviewed-terminal.mjs',
  import.meta.url,
);
const reviewedSource = readFileSync(reviewedTerminalUrl, 'utf8');

function validInput(overrides = {}) {
  return {
    auditHead: HEAD,
    capturedAt: CAPTURED_AT,
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

function validEvidence(overrides = {}) {
  return {
    ...createYouTubeReportRemoteLockReleaseEvidence(validInput()),
    ...overrides,
  };
}

test('valid retained Meta lock-release evidence is digest-bound and reduced to bounded authority', () => {
  const evidence = validEvidence();
  assert.match(evidence.evidenceSha256, /^[0-9a-f]{64}$/u);
  assert.deepEqual(assertYouTubeReportRemoteLockReleaseEvidence(evidence, {
    expectedHead: HEAD,
  }), {
    released: true,
    auditHead: HEAD,
    evidenceSha256: evidence.evidenceSha256,
    capturedAt: CAPTURED_AT,
  });
});

test('retained evidence loader requires a file and does not accept a caller Boolean', async () => {
  await assert.rejects(
    loadYouTubeReportRemoteLockReleaseEvidence({
      env: { MKT_META_REMOTE_LOCK_RELEASED: 'true' },
      expectedHead: HEAD,
    }),
    (error) => error.code === 'YOUTUBE_REPORT_REMOTE_LOCK_RELEASE_EVIDENCE_REQUIRED',
  );
});

test('retained evidence rejects unsafe runtime state, nested credentials and stale Head', () => {
  assert.throws(
    () => assertYouTubeReportRemoteLockReleaseEvidence(
      createYouTubeReportRemoteLockReleaseEvidence(validInput({
        runtime: { ...validInput().runtime, activeWorkCount: 1 },
      })),
      { expectedHead: HEAD },
    ),
    (error) => error.code === 'YOUTUBE_REPORT_REMOTE_LOCK_RELEASE_INVALID',
  );
  assert.throws(
    () => assertYouTubeReportRemoteLockReleaseEvidence(validEvidence({
      nested: { authorization: 'Bearer secret' },
    })),
    (error) => error.code === 'YOUTUBE_REPORT_REMOTE_LOCK_RELEASE_NOT_SANITIZED',
  );
  assert.throws(
    () => assertYouTubeReportRemoteLockReleaseEvidence(validEvidence(), {
      expectedHead: OTHER_HEAD,
    }),
    (error) => error.code === 'YOUTUBE_REPORT_REMOTE_LOCK_RELEASE_INVALID'
      && error.details.exactHeadMatch === false,
  );
});

test('retained evidence rejects payload changes after digest creation', () => {
  const evidence = validEvidence();
  assert.throws(
    () => assertYouTubeReportRemoteLockReleaseEvidence({
      ...evidence,
      runtime: { ...evidence.runtime, activeLockCount: 1 },
    }, { expectedHead: HEAD }),
    (error) => error.code === 'YOUTUBE_REPORT_REMOTE_LOCK_RELEASE_INVALID'
      && error.details.evidenceDigestMatch === false,
  );
});

test('loader reads one retained sanitized private evidence file including paths with spaces', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'youtube lock release '));
  const path = join(directory, 'lock release.json');
  try {
    await writeFile(path, JSON.stringify(validEvidence()), { mode: 0o600 });
    await chmod(path, 0o600);
    const result = await loadYouTubeReportRemoteLockReleaseEvidence({
      env: { [YOUTUBE_REPORT_REMOTE_LOCK_RELEASE_ENV]: path },
      expectedHead: HEAD,
    });
    assert.equal(result.released, true);
    assert.equal(result.auditHead, HEAD);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('loader rejects evidence files with non-private permissions', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'youtube-lock-release-mode-'));
  const path = join(directory, 'lock-release.json');
  try {
    await writeFile(path, JSON.stringify(validEvidence()), { mode: 0o644 });
    await chmod(path, 0o644);
    await assert.rejects(
      loadYouTubeReportRemoteLockReleaseEvidence({
        env: { [YOUTUBE_REPORT_REMOTE_LOCK_RELEASE_ENV]: path },
        expectedHead: HEAD,
      }),
      (error) => error.code === 'YOUTUBE_REPORT_REMOTE_LOCK_RELEASE_LOAD_FAILED'
        && error.details.sourceCode === 'OPERATOR_TERMINAL_FILE_MODE_INVALID',
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('reviewed terminal blocks on exact retained lock evidence before Remote collector', () => {
  const repositoryStage = reviewedSource.indexOf("stage = 'repository-read-only-preflight'");
  const lockStage = reviewedSource.indexOf("stage = 'meta-remote-lock-release-preflight'");
  const collectorStage = reviewedSource.indexOf("stage = 'run-internal-read-only-collector'");
  assert.ok(repositoryStage >= 0);
  assert.ok(lockStage > repositoryStage);
  assert.ok(collectorStage > lockStage);
  assert.match(reviewedSource, /expectedHead:\s*repository\.head/u);
  assert.match(reviewedSource, /remoteReadExecuted = true/u);
  assert.match(reviewedSource, /callerBooleanAccepted:\s*false/u);
});
