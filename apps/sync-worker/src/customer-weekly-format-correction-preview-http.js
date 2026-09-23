import { createHash } from 'node:crypto';

import {
  buildLarkWeeklyExecutiveFactualReport,
  renderLarkWeeklyExecutiveChannelSections,
} from '../../../packages/application/src/notifications/build-lark-weekly-executive-factual-report.js';
import {
  buildLarkExecutiveNotificationMessage,
} from '../../../packages/application/src/notifications/deliver-lark-executive-notification.js';
import {
  buildLarkWeeklyExecutiveDeterministicInsightSummary,
  buildLarkWeeklyExecutiveFullChannelAiEvidence,
  repairLarkWeeklyExecutiveFullChannelAiOutputs,
  validateLarkWeeklyExecutiveFullChannelAiOutputs,
} from '../../../packages/application/src/reports/build-lark-weekly-executive-full-channel-ai-evidence.js';
import { loadCustomerRuntimeConfig } from '../../../packages/config/src/customer-profiles.js';
import {
  resolveLarkNotificationReviewedDestination,
} from '../../../packages/connectors/src/lark/lark-notification-reviewed-destination.js';
import { sanitizeOperationalError } from '../../../packages/shared/src/errors/runtime-error.js';
import { json } from '../../../packages/shared/src/http/response.js';
import { timingSafeEqualText } from '../../../packages/shared/src/security/secure-token.js';
import {
  collectRetainedD1Weekly7dSource,
} from './lark-weekly-executive-auto.js';
import { createInfrastructure } from './runtime-infrastructure.js';

export const CUSTOMER_WEEKLY_FORMAT_CORRECTION_PREVIEW_PATH =
  '/__codex/customer-weekly-format-correction-v1';

const PERIOD_START = '2026-09-14';
const PERIOD_END = '2026-09-20';
const AI_TABLE_ID = 'tblM96oQuMoN2E5v';
const SOURCE_AI_RUN_KEY_SHA256 = 'f923751dbe2760728b112eb77cd5d15a9107936eac4c5d1ed96d636f0be5d32d';
const DESTINATION_NAME = 'Chemistry K — Marketing Alerts';
const DESTINATION_KEY_HASH = '6f60448415fedffbb1717f466fcd93895bf4a6bdf550ec9fc6ce4932f562f425';
const SEND_CONFIRMATION = 'SEND_ONE_WEEKLY_20260920_FORMAT_CORRECTION_V2';
const SEND_UUID = 'weekly-exec-20260920-format-correction-v2';
const TEMPLATE_VERSION = 'executive_weekly_7d_notification_v1';

export function createCustomerWeeklyFormatCorrectionPreviewHttpHandler(dependencies = {}) {
  const infrastructureFactory = dependencies.createInfrastructure ?? createInfrastructure;
  const collectSource = dependencies.collectSource ?? collectRetainedD1Weekly7dSource;
  const buildFactualReport = dependencies.buildFactualReport ?? buildLarkWeeklyExecutiveFactualReport;
  const buildEvidence = dependencies.buildEvidence ?? buildLarkWeeklyExecutiveFullChannelAiEvidence;
  const renderSections = dependencies.renderSections ?? renderLarkWeeklyExecutiveChannelSections;
  const buildMessage = dependencies.buildMessage ?? buildLarkExecutiveNotificationMessage;
  const resolveDestination = dependencies.resolveDestination ?? resolveLarkNotificationReviewedDestination;
  const digest = dependencies.digest ?? sha256;

  return async function handle({ request, env, url }) {
    if (url.pathname !== CUSTOMER_WEEKLY_FORMAT_CORRECTION_PREVIEW_PATH) return null;
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
      if (!['preview', 'send'].includes(body?.mode) || body?.periodEnd !== PERIOD_END) {
        throw correctionError(
          'Weekly format correction request does not match the exact retained period',
          'CUSTOMER_WEEKLY_FORMAT_CORRECTION_IDENTITY_INVALID',
        );
      }
      if (body.mode === 'send' && body.confirmation !== SEND_CONFIRMATION) {
        throw correctionError(
          'Weekly format correction send confirmation is missing',
          'CUSTOMER_WEEKLY_FORMAT_CORRECTION_CONFIRMATION_REQUIRED',
        );
      }

      const infrastructure = infrastructureFactory(env);
      const db = infrastructure.getStateDb();
      const repository = infrastructure.repository;
      const client = infrastructure.getLarkBitableClient();
      const source = await collectSource({
        db,
        customerProfile: 'chemistry_k',
        targetPeriodEnd: PERIOD_END,
      });
      if (source.targetPeriod?.periodStart !== PERIOD_START
          || source.targetPeriod?.periodEnd !== PERIOD_END) {
        throw correctionError(
          'Retained D1 Weekly source is not aligned to the correction period',
          'CUSTOMER_WEEKLY_FORMAT_CORRECTION_SOURCE_INVALID',
        );
      }

      const factualReport = buildFactualReport({
        targetPeriod: source.targetPeriod,
        reportBundles: source.reportBundles,
      });
      const evidence = buildEvidence({
        factualReport,
        channelStatusVectorJson: JSON.stringify(factualReport.channels.map(({ channelKey, hasBusinessFacts }) => ({
          channelKey,
          readinessStatus: hasBusinessFacts ? 'report_ready' : 'report_available_no_business_facts',
        }))),
      }).evidence;
      const records = await repository.listByFieldValues(AI_TABLE_ID, 'scope_type', ['executive']);
      const matches = records.filter((record) => (
        scalar(record?.fields?.generation_status) === 'generated'
        && dateOnlyValue(record?.fields?.period_end) === PERIOD_END
        && hashText(scalar(record?.fields?.ai_run_key) ?? '') === SOURCE_AI_RUN_KEY_SHA256
      ));
      if (matches.length !== 1) {
        throw correctionError(
          'Exact retained Weekly AI source row is not available',
          'CUSTOMER_WEEKLY_FORMAT_CORRECTION_AI_SOURCE_INVALID',
          { matchCount: matches.length },
        );
      }

      const sourceOutputs = Object.freeze({
        insight_summary: requireTextCell(matches[0].fields.insight_summary, 'insight_summary'),
        strengths: requireTextCell(matches[0].fields.strengths, 'strengths'),
        weaknesses: requireTextCell(matches[0].fields.weaknesses, 'weaknesses'),
        recommendations: requireTextCell(matches[0].fields.recommendations, 'recommendations'),
      });
      const deterministicInsight = buildLarkWeeklyExecutiveDeterministicInsightSummary(evidence);
      if (!deterministicInsight) {
        throw correctionError(
          'Exact factual Weekly overview could not be constructed',
          'CUSTOMER_WEEKLY_FORMAT_CORRECTION_FACTUAL_OVERVIEW_INVALID',
        );
      }
      const formattedOutputs = Object.freeze({
        ...sourceOutputs,
        insight_summary: deterministicInsight,
      });
      const repair = repairLarkWeeklyExecutiveFullChannelAiOutputs(formattedOutputs, evidence);
      const deliveryOutputs = repair.repaired === true ? repair.outputs : formattedOutputs;
      const qualityGate = validateLarkWeeklyExecutiveFullChannelAiOutputs(deliveryOutputs, evidence);
      if (!qualityGate.passed) {
        throw correctionError(
          'Weekly correction output did not pass the shared factual quality gate',
          'CUSTOMER_WEEKLY_FORMAT_CORRECTION_QUALITY_INVALID',
          { violations: qualityGate.violations },
        );
      }

      const sections = renderSections(factualReport);
      const detail = sections
        .flatMap((section) => [section.heading, ...section.lines, ''])
        .join('\n')
        .trim();
      const destination = await resolveDestination({
        client,
        expectedName: env.MKT_NOTIFICATION_DESTINATION_CHAT_NAME,
        expectedDestinationKeyHash: env.MKT_NOTIFICATION_DESTINATION_KEY_HASH,
      });
      const aiRunKey = `notification-weekly-7d:full-channel:manual-format-correction:${hashText(`${PERIOD_END}:${SEND_UUID}`)}`;
      const dedupeKey = hashText(`${aiRunKey}:${SEND_UUID}`);
      const message = buildMessage({
        aiRun: {
          aiRunKey,
          reportId: aiRunKey,
          templateVersion: TEMPLATE_VERSION,
          scopeType: 'executive',
          generationStatus: 'generated',
          notificationEligible: true,
          previewMode: false,
          sentToGroup: false,
          dedupeKey,
          windowDays: 7,
          readinessStatus: 'report_available',
          severity: 'info',
          insightSummary: [deliveryOutputs.insight_summary, '', detail].join('\n').trim(),
          strengths: deliveryOutputs.strengths,
          weaknesses: deliveryOutputs.weaknesses,
          recommendations: deliveryOutputs.recommendations,
        },
        snapshot: {
          reportId: aiRunKey,
          reportSettingKey: 'weekly_7d_manual_format_correction',
          customerProfile: 'chemistry_k',
          periodStart: PERIOD_START,
          periodEnd: PERIOD_END,
        },
        settings: {
          enabled: true,
          aiEnabled: true,
          notificationEnabled: true,
          groupId: destination.chatId,
          destinationKeyHash: destination.destinationKeyHash,
        },
      });
      const messageBytes = new TextEncoder().encode(message.text).byteLength;
      const messageSha256 = await digest(message.text);
      const common = {
        periodStart: PERIOD_START,
        periodEnd: PERIOD_END,
        sourceMode: source.selectionPolicy,
        sourceReportCount: source.sourceReportIds.length,
        businessFactChannelCount: factualReport.businessFactChannelCount,
        renderedContentLimitPerOrganicChannel: 1,
        renderedAdLimitPerChannel: 3,
        deterministicOverview: true,
        qualityGatePassed: true,
        repairCode: repair.repairCode ?? null,
        messageBytes,
        messageSha256,
        destinationValidated: true,
        d1WriteCount: 0,
        larkBaseWriteCount: 0,
        queueAdmissionCount: 0,
      };

      if (body.mode === 'preview') {
        return json({
          ok: true,
          result: {
            mode: 'manual_exact_preview',
            ...common,
            messagePreview: message.text,
            messageSendCount: 0,
          },
        }, { status: 200, headers: noStoreHeaders() });
      }

      const existing = await findExactVisibleMessage({ client, destination, messageText: message.text });
      if (existing) {
        return json({
          ok: true,
          result: {
            mode: 'manual_exact_send',
            ...common,
            messageIdSha256: await digest(existing.messageId),
            messageSendCount: 0,
            sendDisposition: 'already_visible_exact_message',
          },
        }, { status: 200, headers: noStoreHeaders() });
      }

      const response = await client.requestBitableJson(
        `/open-apis/im/v1/messages?receive_id_type=chat_id&uuid=${encodeURIComponent(SEND_UUID)}`,
        {
          method: 'POST',
          body: {
            receive_id: destination.chatId,
            msg_type: 'text',
            content: JSON.stringify({ text: message.text }),
          },
        },
      );
      const messageId = requireTextCell(response?.data?.message_id, 'message_id');
      return json({
        ok: true,
        result: {
          mode: 'manual_exact_send',
          ...common,
          messageIdSha256: await digest(messageId),
          messageSendCount: 1,
          sendDisposition: 'sent_once',
        },
      }, { status: 200, headers: noStoreHeaders() });
    } catch (error) {
      const operational = sanitizeOperationalError(error);
      const status = operational.code === 'CUSTOMER_WEEKLY_FORMAT_CORRECTION_UNAUTHORIZED' ? 401 : 400;
      return json({
        ok: false,
        code: operational.code ?? 'CUSTOMER_WEEKLY_FORMAT_CORRECTION_FAILED',
        error: status === 401 ? 'Unauthorized' : operational.message,
        details: status === 401 ? {} : operational.details,
      }, { status, headers: noStoreHeaders() });
    }
  };
}

async function findExactVisibleMessage({ client, destination, messageText }) {
  const response = await client.requestBitableJson(
    `/open-apis/im/v1/messages?container_id_type=chat&container_id=${encodeURIComponent(destination.chatId)}&sort_type=ByCreateTimeDesc&page_size=50`,
    { method: 'GET' },
  );
  for (const item of response?.data?.items ?? []) {
    let text = '';
    try { text = String(JSON.parse(item?.body?.content ?? '{}')?.text ?? ''); } catch { text = ''; }
    if (text === messageText) {
      return Object.freeze({ messageId: requireTextCell(item.message_id, 'message_id') });
    }
  }
  return null;
}

function assertExactCustomerRuntime(env) {
  const runtime = loadCustomerRuntimeConfig(env);
  if (runtime.environment !== 'production'
      || runtime.profileKey !== 'chemistry_k'
      || runtime.customerKey !== 'chemistry_k'
      || runtime.infrastructureOwner !== 'customer'
      || env?.LARK_TABLE_MKT_AI_REPORT_RUNS !== AI_TABLE_ID
      || env?.MKT_NOTIFICATION_DESTINATION_CHAT_NAME !== DESTINATION_NAME
      || env?.MKT_NOTIFICATION_DESTINATION_KEY_HASH !== DESTINATION_KEY_HASH
      || !env?.MKT_STATE_DB || typeof env.MKT_STATE_DB.prepare !== 'function') {
    throw correctionError(
      'Correction runtime is not exact Customer PROD',
      'CUSTOMER_WEEKLY_FORMAT_CORRECTION_RUNTIME_INVALID',
    );
  }
}

async function requireAuthorization(request, env, digest) {
  const match = /^Bearer[ \t]+(.+)$/iu.exec(request.headers.get('authorization') ?? '');
  const supplied = match?.[1]?.trim() ?? '';
  const suppliedDigest = supplied ? await digest(supplied) : '';
  const expectedDigest = requireHash(
    env?.MKT_WEEKLY_FORMAT_CORRECTION_TOKEN_SHA256,
    'MKT_WEEKLY_FORMAT_CORRECTION_TOKEN_SHA256',
  );
  if (!match || !(await timingSafeEqualText(suppliedDigest, expectedDigest))) {
    throw correctionError('Correction authorization was rejected', 'CUSTOMER_WEEKLY_FORMAT_CORRECTION_UNAUTHORIZED');
  }
}

function scalar(value) {
  if (value === null || value === undefined) return null;
  if (Array.isArray(value)) return value.map(scalar).join('');
  if (typeof value === 'object') return scalar(value.text ?? value.name ?? value.value);
  const text = String(value).trim();
  return text || null;
}
function requireTextCell(value, label) {
  const text = scalar(value);
  if (!text) throw correctionError(`${label} is missing`, 'CUSTOMER_WEEKLY_FORMAT_CORRECTION_AI_SOURCE_INVALID');
  return text;
}
function dateOnlyValue(value) {
  const text = scalar(value);
  if (/^\d{4}-\d{2}-\d{2}$/u.test(String(text ?? ''))) return text;
  const epoch = Number(text);
  if (!Number.isFinite(epoch) || epoch <= 0) return null;
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date(epoch));
}
function requireHash(value, label) {
  const text = String(value ?? '').trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/u.test(text)) {
    throw correctionError(`${label} is invalid`, 'CUSTOMER_WEEKLY_FORMAT_CORRECTION_RUNTIME_INVALID');
  }
  return text;
}
function hashText(value) {
  return createHash('sha256').update(String(value)).digest('hex');
}
async function sha256(value) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(value)));
  return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}
function noStoreHeaders() {
  return { 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' };
}
function correctionError(message, code, details = {}) {
  const error = new Error(message);
  error.code = code;
  error.details = Object.freeze({ ...details });
  return error;
}
