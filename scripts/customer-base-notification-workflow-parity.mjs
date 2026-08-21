import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { readDevVars } from './lib/dev-vars.js';
import { createLarkBaseExportSourceClient } from './lib/lark-base-export-source-client.js';
import { printJson } from './lib/lark-runtime.js';
import { createLarkBitableClientFromEnv } from '../packages/connectors/src/lark/lark-bitable.client.js';
import {
  CUSTOMER_BASE_NOTIFICATION_WORKFLOW_CONFIRMATION,
  applyCustomerBaseNotificationWorkflowParity,
  buildCustomerBaseNotificationWorkflowPlan,
} from './lib/customer-base-notification-workflow-parity.js';

const CURRENT_SOURCE_SHA256 = '9c24f5da1400d05ca0c070ab736e87c49e7ff4ea78e854a96d4e4c2c3ab267f7';
const TARGET_LABEL = '✨Marketing Content Calendar';

try {
  await main();
} catch (error) {
  console.error(JSON.stringify({
    ok: false,
    contractVersion: 'customer_base_notification_workflow_parity_v1',
    code: error?.code ?? 'CUSTOMER_BASE_NOTIFICATION_WORKFLOW_OPERATOR_FAILED',
    message: error?.message ?? String(error),
    details: safeDetails(error?.details ?? {}),
  }, null, 2));
  process.exitCode = 1;
}

async function main() {
  const mode = process.argv.includes('--apply') ? 'apply' : 'preview';
  const customerProdVarsFile = process.env.CUSTOMER_PROD_VARS_FILE ?? '.customer.prod.vars';
  const fileEnv = await readDevVars(customerProdVarsFile);
  const env = { ...fileEnv, ...process.env };
  const sourceFile = optionalText(env.LARK_CUSTOMER_CONSOLIDATION_SOURCE_EXPORT_FILE)
    ?? join(homedir(), 'Desktop', 'Social MKT Data Hub.base');
  const sourceSha256 = await sha256File(sourceFile);
  if (sourceSha256 !== CURRENT_SOURCE_SHA256) {
    throw codedError(
      'CUSTOMER_BASE_NOTIFICATION_WORKFLOW_SOURCE_SHA_MISMATCH',
      'Notification workflow operator requires the exact current Source export',
      { expected: CURRENT_SOURCE_SHA256, actual: sourceSha256, sourceFile },
    );
  }

  const sourceClient = await createLarkBaseExportSourceClient(sourceFile);
  const plan = await buildCustomerBaseNotificationWorkflowPlan({ sourceClient });
  const targetAppToken = requireText(
    env.LARK_CUSTOMER_CONSOLIDATION_TARGET_APP_TOKEN,
    'LARK_CUSTOMER_CONSOLIDATION_TARGET_APP_TOKEN',
  );
  const targetClient = createLarkBitableClientFromEnv({
    ...env,
    LARK_APP_TOKEN: targetAppToken,
  });
  const confirmation = mode === 'apply'
    ? requireText(
      env.CUSTOMER_BASE_NOTIFICATION_WORKFLOW_CONFIRMATION,
      'CUSTOMER_BASE_NOTIFICATION_WORKFLOW_CONFIRMATION',
    )
    : null;

  const result = await applyCustomerBaseNotificationWorkflowParity({
    plan,
    targetClient,
    mode,
    confirmation,
    onProgress: (event) => console.error(JSON.stringify({
      event: 'customer_base_notification_workflow_progress',
      ...event,
    })),
  });

  printJson({
    ...result,
    sourceAuthority: {
      file: sourceFile,
      sha256: sourceSha256,
      sourceWorkflowCount: plan.sourceWorkflowCount,
      sourceStatus: plan.sourceStatus,
      title: plan.title,
      trigger: plan.trigger,
      delayMinutes: plan.delayMinutes,
    },
    target: { label: TARGET_LABEL },
    safety: {
      workflowCreateCount: result.workflowCreateCount,
      workflowUpdateCount: result.workflowUpdateCount,
      workflowStatusChangeCount: result.workflowStatusChangeCount,
      workflowEnableCount: result.workflowEnableCount,
      notificationSendCount: result.notificationSendCount,
      aiCallCount: result.aiCallCount,
      recordMutationCount: result.recordMutationCount,
      tableMutationCount: result.tableMutationCount,
      fieldMutationCount: result.fieldMutationCount,
      dashboardMutationCount: result.dashboardMutationCount,
    },
    nextApplyCommand: mode === 'preview'
      ? `CUSTOMER_BASE_NOTIFICATION_WORKFLOW_CONFIRMATION=${CUSTOMER_BASE_NOTIFICATION_WORKFLOW_CONFIRMATION} node scripts/customer-base-notification-workflow-parity.mjs --apply`
      : null,
  });
}

async function sha256File(file) {
  return createHash('sha256').update(await readFile(file)).digest('hex');
}

function safeDetails(value) {
  if (!value || typeof value !== 'object') return {};
  return Object.fromEntries(
    Object.entries(value).filter(([key]) => !/(token|secret|password|authorization)/iu.test(key)),
  );
}

function optionalText(value) {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

function requireText(value, name) {
  const result = optionalText(value);
  if (!result) throw new TypeError(`${name} is required`);
  return result;
}

function codedError(code, message, details = {}) {
  const error = new Error(message);
  error.code = code;
  error.details = details;
  return error;
}
