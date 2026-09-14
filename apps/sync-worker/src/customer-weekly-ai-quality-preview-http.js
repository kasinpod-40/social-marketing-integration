import { createHash } from 'node:crypto';

import {
  buildLarkWeeklyExecutiveFactualReport,
} from '../../../packages/application/src/notifications/build-lark-weekly-executive-factual-report.js';
import {
  buildLarkNativeAiWeekly7dControlledUat,
} from '../../../packages/application/src/reports/build-lark-native-ai-weekly-7d-controlled-uat.js';
import {
  repairLarkWeeklyExecutiveFullChannelAiOutputs,
} from '../../../packages/application/src/reports/build-lark-weekly-executive-full-channel-ai-evidence.js';
import { loadCustomerRuntimeConfig } from '../../../packages/config/src/customer-profiles.js';
import { sanitizeOperationalError } from '../../../packages/shared/src/errors/runtime-error.js';
import { json } from '../../../packages/shared/src/http/response.js';
import { timingSafeEqualText } from '../../../packages/shared/src/security/secure-token.js';
import {
  assertLarkWeekly7dExecutiveDecisionGenerated,
  buildLarkWeekly7dExecutiveDecisionSynthesis,
} from '../../../scripts/lib/lark-weekly-7d-executive-decision-preview.js';
import {
  collectRetainedD1Weekly7dSource,
} from './lark-weekly-executive-auto.js';
import { createInfrastructure } from './runtime-infrastructure.js';

export const CUSTOMER_WEEKLY_AI_QUALITY_PREVIEW_PATH =
  '/__codex/customer-weekly-ai-quality-v1';

const EXPECTED_WORK_KEY = 'lark_notification:weekly-executive-auto-20260913';
const EXPECTED_PERIOD_END = '2026-09-13';
const EXPECTED_WORK_TYPE = 'lark_automatic_weekly_executive_notification_v1';
const EXPECTED_AI_TABLE_ID = 'tblM96oQuMoN2E5v';
const HASH = /^[a-f0-9]{64}$/u;

/**
 * Read-only Preview diagnostic for one retained Customer PROD Weekly identity.
 * It returns only state, hashes, output presence, and quality violation codes;
 * generated prose and customer record values never leave the Worker.
 */
export function createCustomerWeeklyAiQualityPreviewHttpHandler(dependencies = {}) {
  const infrastructureFactory = dependencies.createInfrastructure ?? createInfrastructure;
  const collectRetainedSource = dependencies.collectRetainedSource
    ?? collectRetainedD1Weekly7dSource;
  const buildSeed = dependencies.buildSeed ?? buildLarkNativeAiWeekly7dControlledUat;
  const buildFactualReport = dependencies.buildFactualReport
    ?? buildLarkWeeklyExecutiveFactualReport;
  const buildSynthesis = dependencies.buildSynthesis
    ?? buildLarkWeekly7dExecutiveDecisionSynthesis;
  const assertGenerated = dependencies.assertGenerated
    ?? assertLarkWeekly7dExecutiveDecisionGenerated;
  const digest = dependencies.digest ?? sha256;

  return async function handle({ request, env, url }) {
    if (url.pathname !== CUSTOMER_WEEKLY_AI_QUALITY_PREVIEW_PATH) return null;
    try {
      if (request.method !== 'POST') {
        return json({ ok: false, code: 'METHOD_NOT_ALLOWED' }, {
          status: 405,
          headers: { allow: 'POST', ...noStoreHeaders() },
        });
      }
      assertExactCustomerRuntime(env);
      await requireAuthorization(request, env, digest);
      const body = await request.json().catch(() => null);
      if (body?.mode !== 'diagnose'
          || body?.workKey !== EXPECTED_WORK_KEY
          || body?.periodEnd !== EXPECTED_PERIOD_END) {
        throw previewError(
          'Diagnostic request does not match the exact retained Weekly identity',
          'CUSTOMER_WEEKLY_AI_QUALITY_IDENTITY_INVALID',
        );
      }

      const infrastructure = infrastructureFactory(env);
      const db = infrastructure.getStateDb();
      const work = await db.prepare(`
        SELECT work_key, work_type, generation, lifecycle_status, terminal_reason
        FROM sync_work_runs
        WHERE work_key = ?
      `).bind(EXPECTED_WORK_KEY).first();
      if (!work || work.work_type !== EXPECTED_WORK_TYPE
          || work.lifecycle_status !== 'terminal'
          || work.terminal_reason !== 'LARK_WEEKLY_7D_FULL_CHANNEL_AI_QUALITY_FAILED') {
        throw previewError(
          'Retained Weekly Work is outside the exact quality-failure boundary',
          'CUSTOMER_WEEKLY_AI_QUALITY_WORK_INVALID',
        );
      }
      const phases = await db.prepare(`
        SELECT phase, state_json, complete
        FROM sync_work_phases
        WHERE work_key = ?
          AND phase IN ('fresh_ai_row_create_attempt', 'native_ai_trigger_attempt')
        ORDER BY phase
      `).bind(EXPECTED_WORK_KEY).all();
      const phaseMap = new Map((phases?.results ?? []).map((row) => [row.phase, row]));
      const createPhase = readCompletePhase(phaseMap.get('fresh_ai_row_create_attempt'));
      const triggerPhase = readCompletePhase(phaseMap.get('native_ai_trigger_attempt'));
      const identitySha256 = requireHash(createPhase.identitySha256, 'identitySha256');
      if (requireHash(triggerPhase.aiRunKeySha256, 'aiRunKeySha256') !== identitySha256) {
        throw previewError(
          'Retained Weekly phase identities differ',
          'CUSTOMER_WEEKLY_AI_QUALITY_PHASE_INVALID',
        );
      }

      const records = await infrastructure.repository.listByFieldValues(
        EXPECTED_AI_TABLE_ID,
        'scope_type',
        ['executive'],
      );
      const matches = records.filter((record) => {
        const aiRunKey = scalar(record?.fields?.ai_run_key);
        return aiRunKey && hashText(aiRunKey) === identitySha256;
      });
      if (matches.length !== 1) {
        throw previewError(
          'Retained Weekly AI record is not exact',
          'CUSTOMER_WEEKLY_AI_QUALITY_RECORD_INVALID',
          { matchCount: matches.length },
        );
      }

      const source = await collectRetainedSource({
        db,
        customerProfile: 'chemistry_k',
        targetPeriodEnd: EXPECTED_PERIOD_END,
      });
      const generatedAt = Math.max(...source.reportBundles.map((bundle) => (
        Number(bundle?.payload?.generatedAt ?? 0)
      )));
      const seed = await buildSeed({
        generatedAt,
        customerKey: 'chemistry_k',
        customerProfile: 'chemistry_k',
        utcOffset: '+07:00',
        targetPeriod: source.targetPeriod,
        settings: source.settings,
        reportBundles: source.reportBundles,
      });
      const sourceRecord = Object.freeze({ recordId: null, fields: seed.executiveRow });
      const factualReport = buildFactualReport({
        targetPeriod: source.targetPeriod,
        reportBundles: source.reportBundles,
      });
      const synthesis = buildSynthesis({ sourceRecord, factualReport });
      const record = matches[0];
      const expected = Object.freeze({
        ...synthesis,
        aiRunKey: scalar(record.fields.ai_run_key),
      });
      let qualityGate;
      let generatedOutputs = null;
      try {
        qualityGate = assertGenerated(record.fields, expected).qualityGate;
      } catch (error) {
        if (error?.code !== 'LARK_WEEKLY_7D_FULL_CHANNEL_AI_QUALITY_FAILED') throw error;
        generatedOutputs = error?.details?.outputs ?? null;
        qualityGate = Object.freeze({
          passed: false,
          violations: Object.freeze([...(error?.details?.violations ?? [])]),
        });
      }
      const repair = qualityGate.passed === true
        ? Object.freeze({ repaired: false, qualityGate })
        : repairLarkWeeklyExecutiveFullChannelAiOutputs(
          generatedOutputs ?? {},
          expected.evidence.evidence,
        );
      return json({
        ok: true,
        result: {
          mode: 'read_only',
          work: {
            workKey: EXPECTED_WORK_KEY,
            generation: Number(work.generation),
            lifecycleStatus: work.lifecycle_status,
            terminalReason: work.terminal_reason,
          },
          retainedIdentitySha256: identitySha256,
          outputPresence: Object.fromEntries([
            'insight_summary', 'strengths', 'weaknesses', 'recommendations',
          ].map((field) => [field, Boolean(scalar(record.fields[field]))])),
          qualityGate,
          boundedRepair: {
            repaired: repair.repaired === true,
            repairCode: repair.repairCode ?? null,
            passed: repair.qualityGate?.passed === true,
            violations: repair.qualityGate?.violations ?? [],
            repairViolations: repair.repairViolations ?? [],
          },
          recordReadCount: 1,
          d1WriteCount: 0,
          larkWriteCount: 0,
          queueAdmissionCount: 0,
          messageSendCount: 0,
        },
      }, { status: 200, headers: noStoreHeaders() });
    } catch (error) {
      const operational = sanitizeOperationalError(error);
      const status = operational.code === 'CUSTOMER_WEEKLY_AI_QUALITY_UNAUTHORIZED' ? 401 : 400;
      return json({
        ok: false,
        code: operational.code ?? 'CUSTOMER_WEEKLY_AI_QUALITY_PREVIEW_FAILED',
        error: status === 401 ? 'Unauthorized' : operational.message,
        details: status === 401 ? {} : operational.details,
      }, { status, headers: noStoreHeaders() });
    }
  };
}

function assertExactCustomerRuntime(env) {
  const runtime = loadCustomerRuntimeConfig(env);
  if (runtime.environment !== 'production'
      || runtime.profileKey !== 'chemistry_k'
      || runtime.customerKey !== 'chemistry_k'
      || runtime.infrastructureOwner !== 'customer'
      || env?.LARK_TABLE_MKT_AI_REPORT_RUNS !== EXPECTED_AI_TABLE_ID
      || !env?.MKT_STATE_DB || typeof env.MKT_STATE_DB.prepare !== 'function') {
    throw previewError(
      'Preview runtime is not exact Customer PROD',
      'CUSTOMER_WEEKLY_AI_QUALITY_RUNTIME_INVALID',
    );
  }
}

async function requireAuthorization(request, env, digest) {
  const match = /^Bearer[ \t]+(.+)$/iu.exec(request.headers.get('authorization') ?? '');
  const supplied = match?.[1]?.trim() ?? '';
  const suppliedDigest = supplied ? await digest(supplied) : '';
  const expectedDigest = requireHash(
    env?.MKT_WEEKLY_AI_QUALITY_PREVIEW_TOKEN_SHA256,
    'MKT_WEEKLY_AI_QUALITY_PREVIEW_TOKEN_SHA256',
  );
  if (!match || !(await timingSafeEqualText(suppliedDigest, expectedDigest))) {
    throw previewError('Preview authorization was rejected', 'CUSTOMER_WEEKLY_AI_QUALITY_UNAUTHORIZED');
  }
}

function readCompletePhase(row) {
  if (!row || Number(row.complete) !== 1) {
    throw previewError('Retained Weekly phase is incomplete', 'CUSTOMER_WEEKLY_AI_QUALITY_PHASE_INVALID');
  }
  try { return JSON.parse(row.state_json); } catch {
    throw previewError('Retained Weekly phase state is invalid', 'CUSTOMER_WEEKLY_AI_QUALITY_PHASE_INVALID');
  }
}
function scalar(value) {
  if (value === null || value === undefined) return null;
  if (Array.isArray(value)) return value.map(scalar).join('');
  if (typeof value === 'object') return scalar(value.text ?? value.name ?? value.value);
  const text = String(value).trim();
  return text || null;
}
function requireHash(value, label) {
  const text = String(value ?? '').trim().toLowerCase();
  if (!HASH.test(text)) throw previewError(`${label} is invalid`, 'CUSTOMER_WEEKLY_AI_QUALITY_PHASE_INVALID');
  return text;
}
function hashText(value) {
  return createHash('sha256').update(String(value)).digest('hex');
}
async function sha256(value) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(value)));
  return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}
function noStoreHeaders() { return { 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' }; }
function previewError(message, code, details = {}) {
  const error = new Error(message);
  error.code = code;
  error.details = Object.freeze({ ...details });
  return error;
}
