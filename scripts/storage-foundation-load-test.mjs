#!/usr/bin/env node

import { performance } from 'node:perf_hooks';
import { chmod, mkdir, mkdtemp, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const execute = process.argv.slice(2).includes('--execute');
const CONFIRMATION = 'RUN_LOCAL_STORAGE_FOUNDATION_10X_100X';

try {
  if (process.argv.slice(2).some((value) => value !== '--execute')) throw loadError('Unsupported argument', 'STORAGE_LOAD_ARGUMENT_INVALID');
  if (!execute) {
    process.stdout.write(`${JSON.stringify({
      ok: true, mode: 'plan', scales: [10, 100], remoteActions: 0,
      nextCommand: `CONFIRM_STORAGE_LOAD_TEST=${CONFIRMATION} node scripts/storage-foundation-load-test.mjs --execute`,
    }, null, 2)}\n`);
    process.exit(0);
  }
  if (process.env.CONFIRM_STORAGE_LOAD_TEST !== CONFIRMATION) throw loadError('Confirmation is missing', 'STORAGE_LOAD_CONFIRMATION_REQUIRED');

  const root = resolve(process.cwd());
  const work = await mkdtemp(join(tmpdir(), 'social-mkt-storage-load-'));
  await chmod(work, 0o700);
  const results = [];
  for (const scale of [10, 100]) {
    process.stderr.write(`${JSON.stringify({ stage: 'load-test', scale: `${scale}x`, status: 'running' })}\n`);
    results.push(runScale({ root, work, scale }));
    process.stderr.write(`${JSON.stringify({ stage: 'load-test', scale: `${scale}x`, status: 'completed' })}\n`);
  }
  const summary = Object.freeze({
    ok: true,
    contractVersion: 'storage-foundation-load-test-v1',
    baseline: Object.freeze({ organicObservations: 12082, adsDailyFacts: 8238 }),
    results: Object.freeze(results),
    remoteActions: 0,
    production: 'BLOCKED',
  });
  const evidencePath = resolve(process.env.MKT_STORAGE_LOAD_EVIDENCE_PATH
    ?? '/private/tmp/social-mkt-storage-load-test-20260815.json');
  await writePrivate(evidencePath, `${JSON.stringify(summary, null, 2)}\n`);
  await rm(work, { recursive: true, force: false });
  process.stdout.write(`${JSON.stringify({ ...summary, evidencePath }, null, 2)}\n`);
} catch (error) {
  process.stderr.write(`${JSON.stringify({
    ok: false, code: error?.code ?? 'STORAGE_LOAD_TEST_FAILED', message: error?.message ?? String(error),
    details: error?.details ?? {}, remoteActions: 0, production: 'BLOCKED',
  }, null, 2)}\n`);
  process.exitCode = 1;
}

function runScale({ root, work, scale }) {
  const database = join(work, `storage-${scale}x.db`);
  runSqlite(database, `.read ${join(root, 'migrations', '0009_storage_foundation.sql')}`);
  const organicRows = 12082 * scale;
  const adsRows = 8238 * scale;
  const insertStart = performance.now();
  runSqlite(database, buildInsertSql(organicRows, adsRows));
  const insertMs = round(performance.now() - insertStart);
  const organicQuery = timedQuery(database, "SELECT SUM(views) FROM organic_content_observations WHERE customer_key='chemistry_k' AND platform='tiktok' AND account_key='chemistry_k' AND metric_date BETWEEN '2026-06-01' AND '2026-06-30';");
  const adsQuery = timedQuery(database, "SELECT SUM(spend_micros),SUM(impressions),SUM(clicks) FROM ads_daily_facts WHERE customer_key='chemistry_k' AND platform='meta_ads' AND account_key='chemistry_k2' AND metric_date BETWEEN '2026-06-01' AND '2026-06-30';");
  const integrity = timedQuery(database, 'PRAGMA integrity_check;');
  if (integrity.output.trim() !== 'ok') throw loadError('SQLite integrity check failed', 'STORAGE_LOAD_INTEGRITY_FAILED', { scale });
  return Object.freeze({
    scale: `${scale}x`, organicObservationRows: organicRows, adsDailyRows: adsRows,
    databaseBytes: fileSize(database), insertMs,
    organicRangeQueryMs: organicQuery.durationMs, adsRangeQueryMs: adsQuery.durationMs,
    integrityCheckMs: integrity.durationMs,
    organicQueryPlan: query(database, `EXPLAIN QUERY PLAN SELECT SUM(views) FROM organic_content_observations WHERE customer_key='chemistry_k' AND platform='tiktok' AND account_key='chemistry_k' AND metric_date BETWEEN '2026-06-01' AND '2026-06-30';`).trim(),
    adsQueryPlan: query(database, `EXPLAIN QUERY PLAN SELECT SUM(spend_micros) FROM ads_daily_facts WHERE customer_key='chemistry_k' AND platform='meta_ads' AND account_key='chemistry_k2' AND metric_date BETWEEN '2026-06-01' AND '2026-06-30';`).trim(),
  });
}

function buildInsertSql(organicRows, adsRows) {
  return `PRAGMA journal_mode=OFF; PRAGMA synchronous=OFF; BEGIN;
    WITH RECURSIVE seq(n) AS (VALUES(1) UNION ALL SELECT n+1 FROM seq WHERE n<${organicRows})
    INSERT INTO organic_content_observations (
      observation_key,content_key,customer_key,platform,account_key,external_content_id,observed_at,
      metric_date,source_timezone,observation_kind,metric_semantics,views,likes,comments,shares,
      metrics_hash,coverage_run_id,fetched_at,sync_run_id,created_at
    ) SELECT 'obs:'||n,'content:'||(n%300800),'chemistry_k','tiktok','chemistry_k',CAST(n%300800 AS TEXT),
      1780000000000+n,date('2026-01-01','+'||(n%365)||' day'),'Asia/Bangkok','changed','cumulative',
      n,n%1000,n%100,n%50,'hash:'||n,'coverage:load',1780000000000+n,'sync:load',1780000000000+n FROM seq;
    WITH RECURSIVE seq(n) AS (VALUES(1) UNION ALL SELECT n+1 FROM seq WHERE n<${adsRows})
    INSERT INTO ads_daily_facts (
      ads_fact_key,customer_key,platform,account_key,source_account_id,report_level,entity_type,
      external_entity_id,metric_date,account_timezone,breakdown_key,segment_key,currency,spend_micros,
      impressions,clicks,conversions,conversion_value_micros,data_status,coverage_run_id,
      source_payload_hash,fetched_at,sync_run_id,created_at,updated_at
    ) SELECT 'ads:'||n,'chemistry_k','meta_ads','chemistry_k2','source','ad','ad',CAST(n%100000 AS TEXT),
      date('2026-01-01','+'||(n%365)||' day'),'Asia/Bangkok','none','none','THB',n*1000,n*10,n%20,
      n%7,n*2000,'complete','coverage:load','hash:'||n,1780000000000+n,'sync:load',1780000000000+n,1780000000000+n FROM seq;
    COMMIT;`;
}

function timedQuery(database, sql) {
  const started = performance.now();
  const output = query(database, sql);
  return Object.freeze({ output, durationMs: round(performance.now() - started) });
}

function query(database, sql) { return runSqlite(database, sql).stdout; }

function runSqlite(database, sql) {
  const result = spawnSync('sqlite3', [database, sql], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
  if (result.error || result.status !== 0) throw loadError('sqlite3 command failed', 'STORAGE_LOAD_SQLITE_FAILED', {
    exitCode: result.status ?? null, error: result.stderr?.trim().slice(0, 500) ?? null,
  });
  return result;
}

function fileSize(path) {
  const result = spawnSync('stat', ['-f', '%z', path], { encoding: 'utf8' });
  if (result.error || result.status !== 0) throw loadError('Unable to read load database size', 'STORAGE_LOAD_STAT_FAILED');
  return Number(result.stdout.trim());
}

async function writePrivate(path, content) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.tmp-${process.pid}`;
  await writeFile(temporary, content, { mode: 0o600 });
  await chmod(temporary, 0o600);
  await rename(temporary, path);
}

function round(value) { return Math.round(value * 100) / 100; }
function loadError(message, code, details = {}) { const error = new Error(message); error.code = code; error.details = details; return error; }
