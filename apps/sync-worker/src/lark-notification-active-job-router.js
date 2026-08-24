import {
  JOB_TRIGGERS,
  JOB_TYPES,
} from '../../../packages/application/src/jobs/job-catalog.js';
import { deliverLarkExecutiveNotification } from '../../../packages/application/src/notifications/deliver-lark-executive-notification.js';
import {
  LARK_NOTIFICATION_RUNTIME_MODES,
  readLarkNotificationRuntimeConfig,
} from '../../../packages/config/src/lark-notification-runtime-config.js';
import {
  loadLarkNotificationDeliveryRequest,
} from '../../../packages/connectors/src/lark/lark-notification-delivery-source.js';
import {
  createLarkNotificationStateMirror,
} from '../../../packages/connectors/src/lark/lark-notification-state-mirror.js';
import { permanentError } from '../../../packages/shared/src/errors/runtime-error.js';
import { processJobWithChatwootEndToEnd } from './chatwoot-active-job-router.js';
import {
  processAutomaticWeeklyExecutiveNotification,
} from './lark-weekly-executive-auto.js';

export function selectLarkNotificationRoute(input = {}) {
  if (input.job?.body?.type !== JOB_TYPES.LARK_NOTIFICATION_SEND) return 'fallback';
  return input.job?.body?.automaticWeekly === true
    ? 'lark_weekly_executive_auto'
    : 'lark_notification';
}

export function createLarkNotificationActiveJobRouter(input = {}) {
  const processFallback = input.processFallback ?? processJobWithChatwootEndToEnd;
  const processAutomaticWeekly = input.processAutomaticWeekly
    ?? processAutomaticWeeklyExecutiveNotification;
  const loadRequest = input.loadRequest ?? loadLarkNotificationDeliveryRequest;
  const deliver = input.deliver ?? deliverLarkExecutiveNotification;
  const readConfig = input.readConfig ?? readLarkNotificationRuntimeConfig;

  return async function processJobWithLarkNotification(jobInput) {
    const route = selectLarkNotificationRoute(jobInput);
    if (route === 'fallback') return processFallback(jobInput);

    const config = readConfig(jobInput.env);
    if (!config.flags.runtimeEnabled || !config.flags.sendEnabled) {
      throw permanentError('Lark notification delivery is disabled', {
        code: 'LARK_NOTIFICATION_RUNTIME_DISABLED',
      });
    }
    if (route === 'lark_weekly_executive_auto') {
      if (!config.flags.mirrorEnabled) {
        throw permanentError('Automatic Weekly Notification requires Lark mirror enabled', {
          code: 'LARK_NOTIFICATION_RUNTIME_DISABLED',
        });
      }
      return processAutomaticWeekly({ ...jobInput, config });
    }

    const aiRunKey = requireText(jobInput.job?.body?.aiRunKey, 'job.aiRunKey');
    assertNotificationAdmission({
      mode: config.mode,
      trigger: jobInput.job?.body?.trigger,
      aiRunKey,
    });
    const infrastructure = jobInput.getInfrastructure();
    const request = await loadRequest({
      repository: infrastructure.repository,
      client: infrastructure.getLarkBitableClient(),
      tables: config.tables,
      aiRunKey,
      expectedCustomerProfile: config.customerProfile,
      expectedDestinationKeyHash: config.destinationKeyHash,
      expectedDestinationName: config.destinationChatName,
    });
    const mirrorDelivery = config.flags.mirrorEnabled
      ? createLarkNotificationStateMirror({
        repository: infrastructure.repository,
        syncEngine: infrastructure.syncEngine,
        notificationLogTableId: config.tables.notificationLog,
        aiRunsTableId: config.tables.aiRuns,
      })
      : null;
    return deliver({
      request,
      ownerId: buildOwnerId(jobInput),
      claimLeaseMs: config.claimLeaseMs,
      store: infrastructure.getLarkNotificationDeliveryStore(),
      transport: infrastructure.getLarkMessageClient(),
      mirrorDelivery,
    });
  };
}

export const processJobWithLarkNotification = createLarkNotificationActiveJobRouter();

function assertNotificationAdmission(input) {
  const trigger = requireText(input.trigger, 'job.trigger');
  if (input.mode === LARK_NOTIFICATION_RUNTIME_MODES.CONTROLLED_UAT) {
    if (trigger !== JOB_TRIGGERS.LARK_NOTIFICATION_CONTROLLED_UAT
        || !input.aiRunKey.startsWith('notification-uat:')) {
      throwAdmissionError(input.mode);
    }
    return;
  }
  if (input.mode === LARK_NOTIFICATION_RUNTIME_MODES.RUNTIME) {
    if (trigger !== JOB_TRIGGERS.LARK_NOTIFICATION_RUNTIME
        || input.aiRunKey.startsWith('notification-uat:')) {
      throwAdmissionError(input.mode);
    }
    return;
  }
  throwAdmissionError(input.mode);
}

function throwAdmissionError(mode) {
  throw permanentError('Lark notification job is not admitted by the active runtime mode', {
    code: 'LARK_NOTIFICATION_TRIGGER_FORBIDDEN',
    details: { runtimeMode: mode ?? null },
  });
}

function buildOwnerId(input) {
  const operationId = optionalText(input.operation?.operationId);
  const messageId = optionalText(input.message?.id);
  return requireText(operationId ?? messageId, 'notification owner identity');
}
function optionalText(value) {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text || null;
}
function requireText(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw permanentError(`${fieldName} is required`, {
      code: 'LARK_NOTIFICATION_JOB_INVALID',
      details: { fieldName },
    });
  }
  return value.trim();
}
