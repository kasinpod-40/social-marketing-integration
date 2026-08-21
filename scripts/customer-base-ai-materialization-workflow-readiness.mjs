import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createLarkBaseExportSourceClient } from './lib/lark-base-export-source-client.js';
import { createWorkflowExportReferenceAliasSourceClient } from './lib/customer-base-workflow-export-reference-source-client.js';
import { printJson } from './lib/lark-runtime.js';
import { buildCustomerBaseAiMaterializationWorkflowReadiness } from './lib/customer-base-ai-materialization-workflow-readiness.js';

const CURRENT_SOURCE_SHA256 = '9c24f5da1400d05ca0c070ab736e87c49e7ff4ea78e854a96d4e4c2c3ab267f7';

try {
  await main();
} catch (error) {
  console.error(JSON.stringify({
    ok: false,
    contractVersion: 'customer_base_ai_materialization_workflow_readiness_v1',
    code: error?.code ?? 'CUSTOMER_BASE_AI_WORKFLOW_READINESS_FAILED',
    message: error?.message ?? String(error),
    details: safeDetails(error?.details ?? {}),
  }, null, 2));
  process.exitCode = 1;
}

async function main() {
  if (process.argv.includes('--apply')) {
    throw codedError(
      'CUSTOMER_BASE_AI_WORKFLOW_APPLY_BLOCKED',
      'AI Materialization workflow readiness operator is intentionally read-only while null-clear semantics remain undocumented',
    );
  }

  const sourceFile = optionalText(process.env.LARK_CUSTOMER_CONSOLIDATION_SOURCE_EXPORT_FILE)
    ?? join(homedir(), 'Desktop', 'Social MKT Data Hub.base');
  const sourceSha256 = await sha256File(sourceFile);
  if (sourceSha256 !== CURRENT_SOURCE_SHA256) {
    throw codedError(
      'CUSTOMER_BASE_AI_WORKFLOW_SOURCE_SHA_MISMATCH',
      'AI workflow readiness requires the exact current Source export',
      { expected: CURRENT_SOURCE_SHA256, actual: sourceSha256, sourceFile },
    );
  }

  const rawSourceClient = await createLarkBaseExportSourceClient(sourceFile);
  const sourceClient = await createWorkflowExportReferenceAliasSourceClient(rawSourceClient);
  const result = await buildCustomerBaseAiMaterializationWorkflowReadiness({ sourceClient });
  printJson({
    ...result,
    sourceAuthority: {
      file: sourceFile,
      sha256: sourceSha256,
      workflowExportReferenceAliases: sourceClient.getWorkflowExportReferenceAliasDiagnostics(),
    },
    safety: {
      applyAllowed: false,
      remoteRequestCount: result.remoteRequestCount,
      remoteMutationCount: result.remoteMutationCount,
      workflowCreateCount: result.workflowCreateCount,
      workflowUpdateCount: result.workflowUpdateCount,
      workflowStatusChangeCount: result.workflowStatusChangeCount,
      aiCallCount: result.aiCallCount,
      recordMutationCount: result.recordMutationCount,
    },
  });
}

async function sha256File(file) {
  return createHash('sha256').update(await readFile(file)).digest('hex');
}
function safeDetails(value) {
  if (!value || typeof value !== 'object') return {};
  return Object.fromEntries(Object.entries(value).filter(([key]) => !/(token|secret|password|authorization)/iu.test(key)));
}
function optionalText(value) {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}
function codedError(code, message, details = {}) {
  const error = new Error(message);
  error.code = code;
  error.details = details;
  return error;
}
