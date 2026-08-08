import { permanentError, transientError } from '../../../shared/src/errors/runtime-error.js';

const SHA256_HEX = /^[a-f0-9]{64}$/u;
const LEGACY_TEMPLATE_VERSION = 'executive_report_notification_v1';
const BUSINESS_FIRST_TEMPLATE_VERSION = 'executive_report_notification_v2';
const WEEKLY_7D_AI_TEMPLATE_VERSION = 'executive_weekly_7d_notification_v1';
const MAX_MESSAGE_BYTES = 24_000;

/**
 * Delivers one executive report notification through an atomic D1 claim.
 *
 * D1 is authoritative. Lark Notification Log is an idempotent mirror only.
 * A replay of a sent claim may repair the mirror, but can never send the chat message again.
 */
export async function deliverLarkExecutiveNotification(input = {}) {
  const store = requireMethod(input.store, 'claim', 'store');
  requireMethod(input.store, 'markSending', 'store');
  requireMethod(input.store, 'markSent', 'store');
  requireMethod(input.store, 'markBlockedUnknown', 'store');
  const transport = requireMethod(input.transport, 'sendTextToChat', 'transport');
  const mirrorDelivery = typeof input.mirrorDelivery === 'function' ? input.mirrorDelivery : null;
  const request = normalizeRequest(input.request);
  const ownerId = requireText(input.ownerId, 'ownerId');
  const now = typeof input.now === 'function' ? input.now : () => Date.now();
  const templateVersion = resolveDeliveryTemplateVersion(request);

  const message = buildExecutiveMessage(request, templateVersion);
  const payload = Object.freeze({
    templateVersion,
    destination: Object.freeze({
      destinationKeyHash: request.settings.destinationKeyHash,
      rawDestinationPersisted: false,
    }),
    report: Object.freeze({
      aiRunKey: request.aiRun.aiRunKey,
      reportId: request.aiRun.reportId,
      reportSettingKey: request.snapshot.reportSettingKey,
      customerProfile: request.snapshot.customerProfile,
      windowDays: request.aiRun.windowDays,
      periodStart: request.snapshot.periodStart,
      periodEnd: request.snapshot.periodEnd,
      severity: request.aiRun.severity,
      readinessStatus: request.aiRun.readinessStatus,
    }),
    message,
  });
  const payloadText = stableStringify(payload);
  const payloadBytes = new TextEncoder().encode(payloadText).byteLength;
  if (payloadBytes > MAX_MESSAGE_BYTES) {
    throw permanentError('Lark notification payload exceeds the reviewed bound', {
      code: 'LARK_NOTIFICATION_PAYLOAD_TOO_LARGE',
      details: { payloadBytes, maximumBytes: MAX_MESSAGE_BYTES },
    });
  }
  const payloadChecksum = await sha256Hex(payloadText);
  const notificationAttemptKey = `${request.aiRun.aiRunKey}::${request.aiRun.dedupeKey}`;

  const claim = await input.store.claim({
    notificationAttemptKey,
    aiRunKey: request.aiRun.aiRunKey,
    dedupeKey: request.aiRun.dedupeKey,
    reportId: request.aiRun.reportId,
    reportSettingKey: request.snapshot.reportSettingKey,
    customerProfile: request.snapshot.customerProfile,
    destinationKeyHash: request.settings.destinationKeyHash,
    templateVersion,
    payloadChecksum,
    ownerId,
    leaseMs: input.claimLeaseMs ?? 60_000,
    claimedAt: now(),
  });

  if (!claim.acquired) {
    if (claim.disposition === 'already_sent' && claim.delivery.mirrorStatus !== 'mirrored') {
      return repairMirror({
        store: input.store,
        mirrorDelivery,
        delivery: claim.delivery,
        request,
        payloadChecksum,
        notificationAttemptKey,
        now,
      });
    }
    return Object.freeze({
      ok: true,
      status: claim.disposition === 'already_sent' ? 'deduped_sent' : 'deduped_no_send',
      notificationAttemptKey,
      messageSendCount: 0,
      mirrorWriteCount: 0,
      deliveryStatus: claim.delivery.status,
      production: 'BLOCKED_UNTIL_SEPARATE_ACTIVATION',
    });
  }

  await input.store.markSending({
    notificationAttemptKey,
    ownerId,
    attemptedAt: now(),
  });

  let response;
  try {
    response = await transport.sendTextToChat({
      chatId: request.settings.groupId,
      text: message.text,
    });
  } catch (cause) {
    await input.store.markBlockedUnknown({
      notificationAttemptKey,
      ownerId,
      errorCode: 'LARK_NOTIFICATION_DELIVERY_OUTCOME_UNKNOWN',
      errorMessage: cause instanceof Error ? cause.message : String(cause),
    });
    throw permanentError('Lark notification delivery outcome is unknown; automatic resend is forbidden', {
      code: 'LARK_NOTIFICATION_DELIVERY_OUTCOME_UNKNOWN',
      cause,
      details: { notificationAttemptKey },
    });
  }

  const messageIdHash = response?.messageId
    ? await sha256Hex(requireText(response.messageId, 'transport.messageId'))
    : null;
  const delivery = await input.store.markSent({
    notificationAttemptKey,
    ownerId,
    sentAt: now(),
    messageIdHash,
  });

  if (!mirrorDelivery) {
    return Object.freeze({
      ok: true,
      status: 'sent_mirror_pending',
      notificationAttemptKey,
      messageSendCount: 1,
      mirrorWriteCount: 0,
      deliveryStatus: delivery.status,
      production: 'BLOCKED_UNTIL_SEPARATE_ACTIVATION',
    });
  }

  return mirrorSentDelivery({
    store: input.store,
    mirrorDelivery,
    delivery,
    request,
    payloadChecksum,
    notificationAttemptKey,
    now,
    messageSendCount: 1,
  });
}

export function buildLarkExecutiveNotificationMessage(input = {}) {
  const request = normalizeRequest(input);
  return buildExecutiveMessage(request, resolveDeliveryTemplateVersion(request));
}

async function repairMirror(input) {
  if (!input.mirrorDelivery) {
    return Object.freeze({
      ok: true,
      status: 'deduped_sent_mirror_pending',
      notificationAttemptKey: input.notificationAttemptKey,
      messageSendCount: 0,
      mirrorWriteCount: 0,
      deliveryStatus: input.delivery.status,
      production: 'BLOCKED_UNTIL_SEPARATE_ACTIVATION',
    });
  }
  return mirrorSentDelivery({ ...input, messageSendCount: 0 });
}

async function mirrorSentDelivery(input) {
  const row = buildNotificationLogRow({
    delivery: input.delivery,
    request: input.request,
    payloadChecksum: input.payloadChecksum,
    notificationAttemptKey: input.notificationAttemptKey,
  });
  try {
    await input.mirrorDelivery(row);
    await input.store.markMirrored({
      notificationAttemptKey: input.notificationAttemptKey,
      mirroredAt: input.now(),
    });
  } catch (cause) {
    try {
      await input.store.markMirrorFailed({
        notificationAttemptKey: input.notificationAttemptKey,
        errorCode: 'LARK_NOTIFICATION_LOG_MIRROR_FAILED',
        errorMessage: cause instanceof Error ? cause.message : String(cause),
      });
    } catch {
      // The D1 sent row remains authoritative even when both mirror writes fail.
    }
    throw transientError('Lark notification was sent but Notification Log mirror is pending', {
      code: 'LARK_NOTIFICATION_LOG_MIRROR_FAILED',
      cause,
      details: { notificationAttemptKey: input.notificationAttemptKey },
    });
  }
  return Object.freeze({
    ok: true,
    status: input.messageSendCount === 1 ? 'sent_and_mirrored' : 'deduped_sent_mirror_repaired',
    notificationAttemptKey: input.notificationAttemptKey,
    messageSendCount: input.messageSendCount,
    mirrorWriteCount: 1,
    deliveryStatus: 'sent',
    production: 'BLOCKED_UNTIL_SEPARATE_ACTIVATION',
  });
}

function buildNotificationLogRow(input) {
  return Object.freeze({
    notification_attempt_key: input.notificationAttemptKey,
    ai_run_key: input.request.aiRun.aiRunKey,
    dedupe_key: input.request.aiRun.dedupeKey,
    destination_key_hash: input.request.settings.destinationKeyHash,
    window_days: String(input.request.aiRun.windowDays),
    period_start: input.request.snapshot.periodStart,
    period_end: input.request.snapshot.periodEnd,
    severity: input.request.aiRun.severity,
    payload_checksum: input.payloadChecksum,
    attempt_status: 'sent',
    attempted_at: input.delivery.attemptedAt,
    sent_at: input.delivery.sentAt,
    failure_code: null,
    redacted_failure_message: null,
    preview_mode: false,
  });
}

function normalizeRequest(value) {
  const source = requireObject(value, 'request');
  const aiRun = requireObject(source.aiRun, 'request.aiRun');
  const snapshot = requireObject(source.snapshot, 'request.snapshot');
  const settings = requireObject(source.settings, 'request.settings');
  const normalized = Object.freeze({
    aiRun: Object.freeze({
      aiRunKey: requireIdentity(aiRun.aiRunKey ?? aiRun.ai_run_key, 'aiRunKey'),
      reportId: requireIdentity(aiRun.reportId ?? aiRun.report_id, 'reportId'),
      templateVersion: optionalText(aiRun.templateVersion ?? aiRun.template_version),
      scopeType: requireText(aiRun.scopeType ?? aiRun.scope_type, 'scopeType'),
      generationStatus: requireText(aiRun.generationStatus ?? aiRun.generation_status, 'generationStatus'),
      notificationEligible: requireBoolean(aiRun.notificationEligible ?? aiRun.notification_eligible, 'notificationEligible'),
      previewMode: requireBoolean(aiRun.previewMode ?? aiRun.preview_mode, 'previewMode'),
      sentToGroup: requireBoolean(aiRun.sentToGroup ?? aiRun.sent_to_group, 'sentToGroup'),
      dedupeKey: requireHash(aiRun.dedupeKey ?? aiRun.dedupe_key, 'dedupeKey'),
      windowDays: requireWindow(aiRun.windowDays ?? aiRun.window_days),
      readinessStatus: requireText(aiRun.readinessStatus ?? aiRun.readiness_status, 'readinessStatus'),
      severity: requireSeverity(aiRun.severity),
      insightSummary: requireText(aiRun.insightSummary ?? aiRun.insight_summary, 'insightSummary'),
      strengths: requireText(aiRun.strengths, 'strengths'),
      weaknesses: requireText(aiRun.weaknesses, 'weaknesses'),
      recommendations: requireText(aiRun.recommendations, 'recommendations'),
    }),
    snapshot: Object.freeze({
      reportId: requireIdentity(snapshot.reportId ?? snapshot.report_id, 'snapshot.reportId'),
      reportSettingKey: requireIdentity(snapshot.reportSettingKey ?? snapshot.report_setting_key, 'reportSettingKey'),
      customerProfile: requireIdentity(snapshot.customerProfile ?? snapshot.customer_profile, 'customerProfile'),
      periodStart: requireDate(snapshot.periodStart ?? snapshot.period_start, 'periodStart'),
      periodEnd: requireDate(snapshot.periodEnd ?? snapshot.period_end, 'periodEnd'),
    }),
    settings: Object.freeze({
      enabled: requireBoolean(settings.enabled, 'settings.enabled'),
      aiEnabled: requireBoolean(settings.aiEnabled ?? settings.ai_enabled, 'settings.aiEnabled'),
      notificationEnabled: requireBoolean(
        settings.notificationEnabled ?? settings.notification_enabled,
        'settings.notificationEnabled',
      ),
      groupId: requireText(settings.groupId ?? settings.group_id, 'settings.groupId'),
      destinationKeyHash: requireHash(
        settings.destinationKeyHash ?? settings.destination_key_hash,
        'settings.destinationKeyHash',
      ),
    }),
  });
  if (normalized.aiRun.scopeType !== 'executive') fail('LARK_NOTIFICATION_SCOPE_NOT_EXECUTIVE');
  if (normalized.aiRun.generationStatus !== 'generated') fail('LARK_NOTIFICATION_AI_NOT_GENERATED');
  if (!['report_available', 'report_partial'].includes(normalized.aiRun.readinessStatus)) {
    fail('LARK_NOTIFICATION_REPORT_NOT_SENDABLE');
  }
  if (!normalized.aiRun.notificationEligible) fail('LARK_NOTIFICATION_NOT_ELIGIBLE');
  if (normalized.aiRun.previewMode) fail('LARK_NOTIFICATION_PREVIEW_FORBIDDEN');
  if (normalized.aiRun.sentToGroup) fail('LARK_NOTIFICATION_ALREADY_MARKED_SENT');
  if (normalized.snapshot.reportId !== normalized.aiRun.reportId) fail('LARK_NOTIFICATION_REPORT_ID_MISMATCH');
  if (normalized.snapshot.periodStart > normalized.snapshot.periodEnd) fail('LARK_NOTIFICATION_PERIOD_INVALID');
  if (!normalized.settings.enabled
    || !normalized.settings.aiEnabled
    || !normalized.settings.notificationEnabled) {
    fail('LARK_NOTIFICATION_SETTINGS_DISABLED');
  }
  return normalized;
}

function resolveDeliveryTemplateVersion(request) {
  return request.aiRun.templateVersion === WEEKLY_7D_AI_TEMPLATE_VERSION
    ? BUSINESS_FIRST_TEMPLATE_VERSION
    : LEGACY_TEMPLATE_VERSION;
}

function buildExecutiveMessage(request, templateVersion) {
  if (templateVersion === BUSINESS_FIRST_TEMPLATE_VERSION) {
    return buildBusinessFirstExecutiveMessage(request);
  }
  return buildLegacyExecutiveMessage(request);
}

function buildBusinessFirstExecutiveMessage(request) {
  const weekly = request.aiRun.windowDays === 7;
  const title = weekly
    ? '📊 Social MKT Weekly Executive Report — 7D'
    : `📊 Social MKT Executive Report — ${request.aiRun.windowDays}D`;
  const text = [
    title,
    `ช่วง ${request.snapshot.periodStart} ถึง ${request.snapshot.periodEnd}`,
    '',
    weekly ? 'ภาพรวมสัปดาห์นี้' : 'ภาพรวม',
    request.aiRun.insightSummary,
    '',
    weekly ? '🏆 สิ่งที่เด่นที่สุดประจำสัปดาห์' : '🏆 สิ่งที่เด่นที่สุด',
    request.aiRun.strengths,
    '',
    '⚠️ สิ่งที่ต้องจับตา',
    request.aiRun.weaknesses,
    '',
    weekly ? '🎯 สิ่งที่ควรทำสัปดาห์หน้า' : '🎯 สิ่งที่ควรทำต่อ',
    request.aiRun.recommendations,
  ].join('\n');
  return Object.freeze({
    format: 'plain_text',
    language: 'th',
    title,
    text,
  });
}

function buildLegacyExecutiveMessage(request) {
  const text = [
    `📊 Social MKT Executive Report — ${request.aiRun.windowDays}D`,
    `ช่วง: ${request.snapshot.periodStart} ถึง ${request.snapshot.periodEnd}`,
    `ระดับ: ${request.aiRun.severity}`,
    `สถานะข้อมูล: ${request.aiRun.readinessStatus}`,
    '',
    'สรุป',
    request.aiRun.insightSummary,
    '',
    'จุดแข็ง',
    request.aiRun.strengths,
    '',
    'จุดที่ต้องระวัง',
    request.aiRun.weaknesses,
    '',
    'ข้อเสนอแนะ',
    request.aiRun.recommendations,
    '',
    'สร้างจาก Central Report Metrics ที่ผ่านการตรวจสอบ',
  ].join('\n');
  return Object.freeze({
    format: 'plain_text',
    language: 'th',
    title: `📊 Social MKT Executive Report — ${request.aiRun.windowDays}D`,
    text,
  });
}

function stableStringify(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
}
async function sha256Hex(value) {
  if (!globalThis.crypto?.subtle) throw new Error('Web Crypto SHA-256 is required');
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}
function requireMethod(value, method, name) {
  if (typeof value?.[method] !== 'function') throw new TypeError(`${name}.${method} is required`);
  return value;
}
function requireObject(value, name) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${name} must be an object`);
  return value;
}
function optionalText(value) {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text || null;
}
function requireText(value, name) {
  if (typeof value !== 'string' || value.trim() === '') throw new TypeError(`${name} is required`);
  return value.trim();
}
function requireIdentity(value, name) {
  const text = requireText(value, name);
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/u.test(text)) throw new TypeError(`${name} must be a stable identity`);
  return text;
}
function requireBoolean(value, name) {
  if (typeof value !== 'boolean') throw new TypeError(`${name} must be Boolean`);
  return value;
}
function requireHash(value, name) {
  const text = requireText(value, name);
  if (!SHA256_HEX.test(text)) throw new TypeError(`${name} must be lowercase SHA-256 hex`);
  return text;
}
function requireWindow(value) {
  const number = Number(value);
  if (![1, 3, 7, 30].includes(number)) throw new TypeError('windowDays must be 1, 3, 7 or 30');
  return number;
}
function requireSeverity(value) {
  const text = requireText(value, 'severity');
  if (!['info', 'warning', 'critical'].includes(text)) throw new TypeError('severity is unsupported');
  return text;
}
function requireDate(value, name) {
  const text = requireText(value, name);
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(text) || Number.isNaN(Date.parse(`${text}T00:00:00.000Z`))) {
    throw new TypeError(`${name} must be YYYY-MM-DD`);
  }
  return text;
}
function fail(code) {
  throw permanentError(code, { code });
}
