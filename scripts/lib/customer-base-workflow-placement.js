export async function inspectOrApplyCustomerBaseWorkflowPlacement({
  targetClient,
  workflowId = null,
  mode = 'preview',
  folderName = 'Setup Phase | Social MKT Data Hub',
}) {
  requireTargetClient(targetClient);
  if (!['preview', 'apply'].includes(mode)) throw new TypeError('mode must be preview or apply');

  const topology = await listBaseBlocks(targetClient);
  const folder = resolveUniqueNamedBlock(topology, folderName);
  const folderId = requireText(folder?.block_id ?? folder?.id, 'target folder block id');

  if (!workflowId) {
    return freeze({
      ok: true,
      status: 'CUSTOMER_BASE_WORKFLOW_PLACEMENT_READY_AFTER_CREATE',
      folderName,
      workflowId: null,
      placementMatches: false,
      workflowPlacementMutationCount: 0,
    });
  }

  const id = requireText(workflowId, 'workflowId');
  const nav = topology.find((item) => blockId(item) === id);
  if (!nav) {
    throw codedError(
      'CUSTOMER_BASE_WORKFLOW_PLACEMENT_BLOCK_MISSING',
      'Workflow is missing from Base Block topology',
      { workflowId: id },
    );
  }

  if (optionalText(nav.parent_id) === folderId) {
    return freeze({
      ok: true,
      status: 'CUSTOMER_BASE_WORKFLOW_PLACEMENT_PASS',
      folderName,
      workflowId: id,
      placementMatches: true,
      workflowPlacementMutationCount: 0,
    });
  }

  if (mode === 'preview') {
    return freeze({
      ok: true,
      status: 'CUSTOMER_BASE_WORKFLOW_PLACEMENT_MOVE_READY',
      folderName,
      workflowId: id,
      placementMatches: false,
      workflowPlacementMutationCount: 0,
    });
  }

  await targetClient.requestBitableJson(
    `/open-apis/base/v3/bases/${encodeURIComponent(targetClient.appToken)}/blocks/${encodeURIComponent(id)}/move`,
    { method: 'POST', body: { parent_id: folderId } },
  );

  const readback = await listBaseBlocks(targetClient);
  const moved = readback.find((item) => blockId(item) === id);
  if (!moved || optionalText(moved.parent_id) !== folderId) {
    throw codedError(
      'CUSTOMER_BASE_WORKFLOW_PLACEMENT_READBACK_MISMATCH',
      'Workflow folder move did not read back under approved Target folder',
      { workflowId: id },
    );
  }

  return freeze({
    ok: true,
    status: 'CUSTOMER_BASE_WORKFLOW_PLACEMENT_PASS_MOVED',
    folderName,
    workflowId: id,
    placementMatches: true,
    workflowPlacementMutationCount: 1,
  });
}

async function listBaseBlocks(client) {
  const response = await client.requestBitableJson(
    `/open-apis/base/v3/bases/${encodeURIComponent(client.appToken)}/blocks/list`,
    { method: 'POST', body: {} },
  );
  return collection(response?.data ?? response ?? {}, ['blocks', 'items']);
}

function resolveUniqueNamedBlock(blocks, name) {
  const matches = blocks.filter((item) => optionalText(item?.name) === name);
  if (matches.length !== 1) {
    throw codedError(
      'CUSTOMER_BASE_WORKFLOW_PLACEMENT_FOLDER_RESOLUTION_FAILED',
      'Approved Target folder must resolve exactly once',
      { name, matches: matches.length },
    );
  }
  return matches[0];
}

function blockId(value) {
  return optionalText(value?.block_id ?? value?.id) ?? '';
}

function collection(data, keys) {
  for (const key of keys) if (Array.isArray(data?.[key])) return data[key];
  return [];
}

function requireTargetClient(client) {
  if (!client || typeof client.requestBitableJson !== 'function') {
    throw new TypeError('targetClient must be shared LarkBitableClient');
  }
  requireText(client.appToken, 'targetClient.appToken');
}

function optionalText(value) {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

function requireText(value, name) {
  const text = optionalText(String(value ?? ''));
  if (!text) throw new TypeError(`${name} is required`);
  return text;
}

function codedError(code, message, details = {}) {
  const error = new Error(message);
  error.code = code;
  error.details = details;
  return error;
}

function freeze(value) {
  return Object.freeze(value);
}
