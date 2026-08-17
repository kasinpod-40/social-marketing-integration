import { createHash } from 'node:crypto';

const VIEW_PROPERTY_SEGMENTS = Object.freeze([
  'filter',
  'visible_fields',
  'group',
  'sort',
  'timebar',
  'card',
]);
const EXPECTED_TABLE_COUNT = 33;
const MAX_BLOCK_DEPTH = 20;
const MAX_BLOCKS = 2_000;

/**
 * GET-only inventory for the customer Base consolidation full-parity gate.
 *
 * This intentionally does not decide that a target is safe to mutate. It first
 * proves which source/target resources can be read through current Base v3 APIs.
 * Any capability/read gap is surfaced instead of silently treating it as empty.
 */
export async function auditLarkBaseFullParity(input) {
  const sourceClient = requireAuditClient(input?.sourceClient, 'sourceClient');
  const targetClient = requireAuditClient(input?.targetClient, 'targetClient');
  const expectedTableNames = normalizeExpectedNames(input?.expectedTableNames);
  const expectedTableCount = input?.expectedTableCount ?? expectedTableNames.length ?? EXPECTED_TABLE_COUNT;

  const [source, target] = await Promise.all([
    captureBaseInventory({ client: sourceClient, label: 'source', expectedTableNames, expectedTableCount }),
    captureBaseInventory({ client: targetClient, label: 'target', expectedTableNames, expectedTableCount }),
  ]);

  const blockers = [];
  for (const inventory of [source, target]) {
    for (const failure of inventory.readFailures) {
      blockers.push(problem(
        'FULL_PARITY_READ_COVERAGE_INCOMPLETE',
        `${inventory.label} full-parity audit could not read ${failure.resource}`,
        { side: inventory.label, ...failure },
      ));
    }
  }

  for (const name of source.missingExpectedTables) {
    blockers.push(problem('FULL_PARITY_SOURCE_TABLE_MISSING', `Source Base is missing required table: ${name}`, { name }));
  }
  for (const name of target.missingExpectedTables) {
    blockers.push(problem('FULL_PARITY_TARGET_TABLE_MISSING', `Target Base is missing required table: ${name}`, { name }));
  }

  if (source.unexpectedTables.length > 0) {
    blockers.push(problem(
      'FULL_PARITY_SOURCE_TABLE_SET_UNEXPECTED',
      'Source Base table set differs from the 33-table contract',
      { unexpectedTables: source.unexpectedTables },
    ));
  }

  return deepFreeze({
    ok: blockers.length === 0,
    contractVersion: 'customer_base_full_parity_audit_v1',
    mode: 'read-only',
    remoteMutationCount: 0,
    fullParityDefinition: {
      generatedIdsMayDifferWithDeterministicRemap: true,
      dimensions: [
        'base block tree and folder placement',
        'tables and table names',
        'fields including type/ui-type/description/property/formatter',
        'records and all cell values including relation/formula-visible results',
        'views and view type',
        'view filter',
        'view visible-field order',
        'view group',
        'view sort',
        'view timebar',
        'view card',
        'forms and form questions',
        'dashboards, themes, blocks, layouts and data_config',
        'workflows, steps and enabled/disabled state',
        'advanced-permission roles and full role configuration',
      ],
    },
    source: summarizeInventory(source),
    target: summarizeInventory(target),
    blockers,
    writeGate: {
      provisionMissingBlocked: true,
      consolidationApplyBlocked: true,
      reason: 'Full-parity apply remains blocked until every readable source dimension has a clone/remap/verify contract and live GET-only audit coverage is complete.',
    },
  });
}

async function captureBaseInventory({ client, label, expectedTableNames, expectedTableCount }) {
  const readFailures = [];
  const tables = await safeRead(readFailures, 'tables', () => client.listTables(), []);
  const tableByName = new Map();
  const duplicateTableNames = [];
  for (const table of tables) {
    const name = text(table?.name);
    if (!name) continue;
    if (tableByName.has(name)) duplicateTableNames.push(name);
    else tableByName.set(name, table);
  }

  if (duplicateTableNames.length > 0) {
    readFailures.push({ resource: 'table-name-uniqueness', code: 'DUPLICATE_TABLE_NAME', names: duplicateTableNames });
  }

  const missingExpectedTables = expectedTableNames.filter((name) => !tableByName.has(name));
  const unexpectedTables = tables
    .map((table) => text(table?.name))
    .filter((name) => name && !expectedTableNames.includes(name));

  if (label === 'source' && tables.length !== expectedTableCount) {
    readFailures.push({
      resource: 'source-table-count',
      code: 'SOURCE_TABLE_COUNT_MISMATCH',
      expected: expectedTableCount,
      actual: tables.length,
    });
  }

  const blocks = await captureBlockTree(client, readFailures);
  const tableInventories = [];
  let totalFields = 0;
  let totalRecords = 0;
  let totalViews = 0;
  let totalForms = 0;
  let totalFormQuestions = 0;
  let totalRelations = 0;
  let totalFormulas = 0;
  let attachmentCells = 0;

  for (const table of tables) {
    const tableId = requireText(table?.tableId ?? table?.table_id ?? table?.id, 'tableId');
    const tableName = text(table?.name) ?? tableId;
    const prefix = `table:${tableName}`;
    const fields = await safeRead(readFailures, `${prefix}:fields`, () => client.listFields({ tableId }), []);
    const records = await safeRead(readFailures, `${prefix}:records`, () => client.listRecords({ tableId }), []);
    const views = await safeRead(readFailures, `${prefix}:views`, () => client.listViews({ tableId }), []);
    const fullViews = [];
    for (const view of views) {
      const viewId = requireText(view?.viewId ?? view?.view_id ?? view?.id, 'viewId');
      fullViews.push(await captureView(client, { tableId, viewId, summary: view, readFailures, prefix }));
    }
    const forms = await captureForms(client, { tableId, tableName, readFailures });

    totalFields += fields.length;
    totalRecords += records.length;
    totalViews += views.length;
    totalForms += forms.length;
    totalFormQuestions += forms.reduce((sum, form) => sum + form.questionCount, 0);
    totalRelations += fields.filter((field) => Number(field?.type) === 18).length;
    totalFormulas += fields.filter((field) => Number(field?.type) === 20).length;
    attachmentCells += records.reduce((sum, record) => sum + countAttachmentLikeValues(record?.fields), 0);

    tableInventories.push({
      name: tableName,
      fieldCount: fields.length,
      recordCount: records.length,
      viewCount: views.length,
      formCount: forms.length,
      formQuestionCount: forms.reduce((sum, form) => sum + form.questionCount, 0),
      relationFieldCount: fields.filter((field) => Number(field?.type) === 18).length,
      formulaFieldCount: fields.filter((field) => Number(field?.type) === 20).length,
      attachmentLikeCellCount: records.reduce((sum, record) => sum + countAttachmentLikeValues(record?.fields), 0),
      schemaDigestSha256: digest({ fields: canonicalizeForAudit(fields), views: canonicalizeForAudit(fullViews), forms: canonicalizeForAudit(forms) }),
      recordDigestSha256: digest(canonicalizeForAudit(records)),
    });
  }

  const dashboards = await captureDashboards(client, readFailures);
  const workflows = await captureWorkflows(client, readFailures);
  const roles = await captureRoles(client, readFailures);

  return {
    label,
    tableCount: tables.length,
    totalFields,
    totalRecords,
    totalViews,
    totalForms,
    totalFormQuestions,
    totalRelations,
    totalFormulas,
    attachmentCells,
    blockCount: blocks.length,
    folderCount: blocks.filter((block) => block.type === 'folder').length,
    dashboardCount: dashboards.length,
    dashboardBlockCount: dashboards.reduce((sum, dashboard) => sum + dashboard.blockCount, 0),
    workflowCount: workflows.length,
    roleCount: roles.length,
    missingExpectedTables,
    unexpectedTables,
    readFailures,
    tables: tableInventories,
    names: {
      dashboards: dashboards.map((item) => item.name).filter(Boolean),
      workflows: workflows.map((item) => item.name).filter(Boolean),
      roles: roles.map((item) => item.name).filter(Boolean),
    },
    digests: {
      blocks: digest(canonicalizeForAudit(blocks)),
      dashboards: digest(canonicalizeForAudit(dashboards)),
      workflows: digest(canonicalizeForAudit(workflows)),
      roles: digest(canonicalizeForAudit(roles)),
    },
  };
}

async function captureBlockTree(client, readFailures) {
  const result = [];
  const queue = [{ parentId: null, depth: 0 }];
  const seenParents = new Set();
  while (queue.length > 0) {
    const { parentId, depth } = queue.shift();
    const key = parentId ?? '<root>';
    if (seenParents.has(key)) continue;
    seenParents.add(key);
    if (depth > MAX_BLOCK_DEPTH || result.length > MAX_BLOCKS) {
      readFailures.push({ resource: 'base-block-tree', code: 'BLOCK_TREE_SAFETY_LIMIT' });
      break;
    }
    const response = await safeRead(
      readFailures,
      `base-blocks:${key}`,
      () => callV3(client, `/open-apis/base/v3/bases/${enc(client.appToken)}/blocks/list`, {
        method: 'POST',
        body: parentId ? { parent_id: parentId } : {},
      }),
      null,
    );
    if (!response) continue;
    const items = collection(response, ['blocks', 'items']);
    for (const block of items) {
      const normalized = {
        id: text(block?.id ?? block?.block_id),
        parentId: text(block?.parent_id) ?? parentId,
        name: text(block?.name),
        type: text(block?.type),
      };
      result.push(normalized);
      if (normalized.type === 'folder' && normalized.id) queue.push({ parentId: normalized.id, depth: depth + 1 });
    }
  }
  return result;
}

async function captureView(client, { tableId, viewId, summary, readFailures, prefix }) {
  const detail = await safeRead(
    readFailures,
    `${prefix}:view:${viewId}:detail`,
    () => callV3(client, `/open-apis/base/v3/bases/${enc(client.appToken)}/tables/${enc(tableId)}/views/${enc(viewId)}`, { method: 'GET' }),
    summary,
  );
  const properties = {};
  const propertyReadErrors = [];
  for (const segment of VIEW_PROPERTY_SEGMENTS) {
    try {
      properties[segment] = await callV3(
        client,
        `/open-apis/base/v3/bases/${enc(client.appToken)}/tables/${enc(tableId)}/views/${enc(viewId)}/${segment}`,
        { method: 'GET' },
      );
    } catch (error) {
      propertyReadErrors.push({ segment, code: errorCode(error) });
    }
  }
  return { detail, properties, propertyReadErrors };
}

async function captureForms(client, { tableId, tableName, readFailures }) {
  const response = await safeRead(
    readFailures,
    `table:${tableName}:forms`,
    () => paginateV3(client, `/open-apis/base/v3/bases/${enc(client.appToken)}/tables/${enc(tableId)}/forms`, ['forms', 'items']),
    [],
  );
  const result = [];
  for (const form of response) {
    const formId = text(form?.id ?? form?.form_id);
    if (!formId) continue;
    const detail = await safeRead(
      readFailures,
      `table:${tableName}:form:${formId}:detail`,
      () => callV3(client, `/open-apis/base/v3/bases/${enc(client.appToken)}/tables/${enc(tableId)}/forms/${enc(formId)}`, { method: 'GET' }),
      form,
    );
    const questionsResponse = await safeRead(
      readFailures,
      `table:${tableName}:form:${formId}:questions`,
      () => callV3(client, `/open-apis/base/v3/bases/${enc(client.appToken)}/tables/${enc(tableId)}/forms/${enc(formId)}/questions`, { method: 'GET' }),
      {},
    );
    const questions = collection(questionsResponse, ['questions', 'items']);
    result.push({
      id: formId,
      name: text(detail?.name ?? form?.name),
      detail,
      questionCount: questions.length,
      questions,
    });
  }
  return result;
}

async function captureDashboards(client, readFailures) {
  const dashboards = await safeRead(
    readFailures,
    'dashboards',
    () => paginateV3(client, `/open-apis/base/v3/bases/${enc(client.appToken)}/dashboards`, ['dashboards', 'items']),
    [],
  );
  const result = [];
  for (const dashboard of dashboards) {
    const dashboardId = text(dashboard?.id ?? dashboard?.dashboard_id);
    if (!dashboardId) continue;
    const detail = await safeRead(
      readFailures,
      `dashboard:${dashboardId}:detail`,
      () => callV3(client, `/open-apis/base/v3/bases/${enc(client.appToken)}/dashboards/${enc(dashboardId)}`, { method: 'GET' }),
      dashboard,
    );
    const blocks = await safeRead(
      readFailures,
      `dashboard:${dashboardId}:blocks`,
      () => paginateV3(client, `/open-apis/base/v3/bases/${enc(client.appToken)}/dashboards/${enc(dashboardId)}/blocks`, ['blocks', 'items']),
      [],
    );
    const fullBlocks = [];
    for (const block of blocks) {
      const blockId = text(block?.id ?? block?.block_id);
      if (!blockId) continue;
      fullBlocks.push(await safeRead(
        readFailures,
        `dashboard:${dashboardId}:block:${blockId}`,
        () => callV3(client, `/open-apis/base/v3/bases/${enc(client.appToken)}/dashboards/${enc(dashboardId)}/blocks/${enc(blockId)}`, { method: 'GET' }),
        block,
      ));
    }
    result.push({
      id: dashboardId,
      name: text(detail?.name ?? dashboard?.name),
      detail,
      blockCount: fullBlocks.length,
      blocks: fullBlocks,
    });
  }
  return result;
}

async function captureWorkflows(client, readFailures) {
  const workflows = await safeRead(
    readFailures,
    'workflows',
    () => paginateV3(client, `/open-apis/base/v3/bases/${enc(client.appToken)}/workflows`, ['workflows', 'items']),
    [],
  );
  const result = [];
  for (const workflow of workflows) {
    const workflowId = text(workflow?.id ?? workflow?.workflow_id);
    if (!workflowId) continue;
    const detail = await safeRead(
      readFailures,
      `workflow:${workflowId}:detail`,
      () => callV3(client, `/open-apis/base/v3/bases/${enc(client.appToken)}/workflows/${enc(workflowId)}`, { method: 'GET' }),
      workflow,
    );
    result.push({ id: workflowId, name: text(detail?.name ?? workflow?.name), detail });
  }
  return result;
}

async function captureRoles(client, readFailures) {
  const response = await safeRead(
    readFailures,
    'advanced-permission-roles',
    () => callV3(client, `/open-apis/base/v3/bases/${enc(client.appToken)}/roles`, { method: 'GET' }),
    {},
  );
  const roles = collection(response, ['roles', 'items']);
  const result = [];
  for (const role of roles) {
    const roleId = text(role?.id ?? role?.role_id);
    if (!roleId) continue;
    const detail = await safeRead(
      readFailures,
      `advanced-permission-role:${roleId}`,
      () => callV3(client, `/open-apis/base/v3/bases/${enc(client.appToken)}/roles/${enc(roleId)}`, { method: 'GET' }),
      role,
    );
    result.push({ id: roleId, name: text(detail?.name ?? role?.name), detail });
  }
  return result;
}

async function paginateV3(client, path, collectionKeys) {
  const result = [];
  let pageToken = '';
  const seen = new Set();
  for (let page = 0; page < 1_000; page += 1) {
    const params = new URLSearchParams({ page_size: '100' });
    if (pageToken) params.set('page_token', pageToken);
    const data = await callV3(client, `${path}?${params.toString()}`, { method: 'GET' });
    result.push(...collection(data, collectionKeys));
    const hasMore = Boolean(data?.has_more ?? data?.hasMore);
    const next = text(data?.page_token ?? data?.pageToken);
    if (!hasMore || !next) return result;
    if (seen.has(next)) throw codedError('FULL_PARITY_PAGINATION_LOOP', `Repeated page token while reading ${path}`);
    seen.add(next);
    pageToken = next;
  }
  throw codedError('FULL_PARITY_PAGINATION_LIMIT', `Pagination limit exceeded while reading ${path}`);
}

async function callV3(client, path, options) {
  const response = await client.requestBitableJson(path, options);
  return response?.data ?? response ?? {};
}

async function safeRead(readFailures, resource, operation, fallback) {
  try {
    return await operation();
  } catch (error) {
    readFailures.push({
      resource,
      code: errorCode(error),
      status: error?.details?.status ?? null,
      larkCode: error?.details?.larkCode ?? null,
    });
    return structuredClone(fallback);
  }
}

function summarizeInventory(inventory) {
  return {
    label: inventory.label,
    tables: inventory.tableCount,
    fields: inventory.totalFields,
    records: inventory.totalRecords,
    views: inventory.totalViews,
    forms: inventory.totalForms,
    formQuestions: inventory.totalFormQuestions,
    relationFields: inventory.totalRelations,
    formulaFields: inventory.totalFormulas,
    attachmentLikeCells: inventory.attachmentCells,
    blocks: inventory.blockCount,
    folders: inventory.folderCount,
    dashboards: inventory.dashboardCount,
    dashboardBlocks: inventory.dashboardBlockCount,
    workflows: inventory.workflowCount,
    advancedPermissionRoles: inventory.roleCount,
    missingExpectedTables: inventory.missingExpectedTables,
    unexpectedTables: inventory.unexpectedTables,
    readFailureCount: inventory.readFailures.length,
    readFailures: inventory.readFailures,
    tableDigests: inventory.tables,
    names: inventory.names,
    digests: inventory.digests,
  };
}

function canonicalizeForAudit(value) {
  if (Array.isArray(value)) return value.map(canonicalizeForAudit);
  if (!value || typeof value !== 'object') return value;
  const output = {};
  for (const key of Object.keys(value).sort()) {
    if (['created_time', 'createdTime', 'last_modified_time', 'lastModifiedTime', 'revision'].includes(key)) continue;
    output[key] = canonicalizeForAudit(value[key]);
  }
  return output;
}

function countAttachmentLikeValues(value) {
  if (Array.isArray(value)) return value.reduce((sum, item) => sum + countAttachmentLikeValues(item), 0);
  if (!value || typeof value !== 'object') return 0;
  let count = 0;
  for (const [key, nested] of Object.entries(value)) {
    if (['file_token', 'fileToken', 'attachment_token', 'attachmentToken'].includes(key) && text(nested)) count += 1;
    count += countAttachmentLikeValues(nested);
  }
  return count;
}

function collection(value, keys) {
  if (Array.isArray(value)) return value;
  for (const key of keys) {
    if (Array.isArray(value?.[key])) return value[key];
  }
  return [];
}

function digest(value) {
  return createHash('sha256').update(stableJson(value)).digest('hex');
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function normalizeExpectedNames(value) {
  if (!Array.isArray(value) || value.length === 0) throw new TypeError('expectedTableNames must be a non-empty array');
  const names = value.map((name) => requireText(name, 'expectedTableName'));
  if (new Set(names).size !== names.length) throw new TypeError('expectedTableNames must be unique');
  return names;
}

function requireAuditClient(client, name) {
  for (const method of ['listTables', 'listFields', 'listRecords', 'listViews', 'requestBitableJson']) {
    if (!client || typeof client[method] !== 'function') throw new TypeError(`${name} must implement ${method}()`);
  }
  requireText(client.appToken, `${name}.appToken`);
  return client;
}

function errorCode(error) {
  return text(error?.code) ?? text(error?.details?.code) ?? 'UNKNOWN_READ_ERROR';
}

function problem(code, message, details = {}) {
  return Object.freeze({ code, message, details: Object.freeze(structuredClone(details)) });
}

function codedError(code, message, details = {}) {
  const error = new Error(message);
  error.code = code;
  error.details = details;
  return error;
}

function text(value) {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

function requireText(value, name) {
  const normalized = text(value);
  if (!normalized) throw new TypeError(`${name} is required`);
  return normalized;
}

function enc(value) {
  return encodeURIComponent(requireText(value, 'path segment'));
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const nested of Object.values(value)) deepFreeze(nested);
  return value;
}
