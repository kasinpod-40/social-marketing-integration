import { JOB_TYPES } from '../../../packages/application/src/jobs/job-catalog.js';
import { deliverLarkExecutiveNotification } from '../../../packages/application/src/notifications/deliver-lark-executive-notification.js';
import { readLarkNotificationRuntimeConfig } from '../../../packages/config/src/lark-notification-runtime-config.js';
import {
  createLarkNotificationStateMirror,
  loadLarkNotificationDeliveryRequest,
} from '../../../packages/connectors/src/lark/lark-notification-delivery-source.js';
import { permanentError } from '../../../packages/shared/src/errors/runtime-error.js';
import { processJobWithWooCommerceEndToEnd } from './woocommerce-active-job-router.js';

export function selectLarkNotificationRoute(input = {}) {
  return input.job?.body?.type === JOB_TYPES.LARK_NOTIFICATION_SEND
    ? 'lark_notification'
    : 'fallback';
}

export function createLarkNotificationActiveJobRouter(input = {}) {
  const processFallback = input.processFallback ?? processJobWithWooCommerceEndToEnd;
  const loadRequest = input.loadRequest ?? loadLarkNotificationDeliveryRequest;
  const deliver = input.deliver ?? deliverLarkExecutiveNotification;
  const readConfig = input.readConfig ?? readLarkNotificationRuntimeConfig;

  return async function processJobWithLarkNotification(jobInput) {
    if (selectLarkNotificationRoute(jobInput) !== 'lark_notification') {
      return processFallback(jobInput);
    }
    const config = readConfig(jobInput.env);
    if (!config.flags.runtimeEnabled || !config.flags.sendEnabled) {
      throw permanentError('Lark notification delivery is disabled', {
        code: 'LARK_NOTIFICATION_RUNTIME_DISABLED',
      });
    }
    const aiRunKey = requireText(jobInput.job?.body?.aiRunKey, 'job.aiRunKey');
    const infrastructure = jobInput.getInfrastructure();
    const request = await loadRequest({
      repository: infrastructure.repository,
      tables: config.tables,
      aiRunKey,
      expectedDestinationKeyHash: config.destinationKeyHash,
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
