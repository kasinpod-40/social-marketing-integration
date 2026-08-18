/**
 * Adds migration-only Base parity capabilities on top of the shared Lark Bitable client.
 *
 * This is a decorator over the existing authenticated/retried request transport, not a
 * second HTTP client. Only request contracts explicitly documented by Lark/Feishu are
 * allowed here. Unsupported View UI properties remain fail-closed in the parity planner.
 */
export function withLarkBaseParityCapabilities(client) {
  requireTransport(client);
  const wrapped = Object.create(client);

  wrapped.getViewHierarchy = async (input) => {
    const tableId = requireText(input?.tableId, 'tableId');
    const viewId = requireText(input?.viewId, 'viewId');
    const response = await client.requestBitableJson(viewPath(client.appToken, tableId, viewId), {
      method: 'GET',
    });
    const view = response?.data?.view ?? response?.data ?? {};
    const property = view?.property && typeof view.property === 'object' ? view.property : {};
    const hierarchy = property?.hierarchy_config ?? property?.hierarchyConfig ?? null;
    return Object.freeze({
      fieldId: optionalText(hierarchy?.field_id ?? hierarchy?.fieldId),
    });
  };

  wrapped.updateViewHierarchy = async (input) => {
    const tableId = requireText(input?.tableId, 'tableId');
    const viewId = requireText(input?.viewId, 'viewId');
    const fieldId = requireText(input?.fieldId, 'fieldId');
    const viewName = optionalText(input?.viewName);
    const body = {
      ...(viewName ? { view_name: viewName } : {}),
      property: {
        hierarchy_config: {
          field_id: fieldId,
        },
      },
    };
    const response = await client.requestBitableJson(viewPath(client.appToken, tableId, viewId), {
      method: 'PATCH',
      body,
    });
    return Object.freeze({
      tableId,
      viewId,
      fieldId,
      responseCode: Number(response?.code ?? 0),
    });
  };

  return wrapped;
}

function viewPath(appToken, tableId, viewId) {
  return `/open-apis/bitable/v1/apps/${encodeURIComponent(requireText(appToken, 'appToken'))}`
    + `/tables/${encodeURIComponent(tableId)}/views/${encodeURIComponent(viewId)}`;
}

function requireTransport(client) {
  if (!client || typeof client.requestBitableJson !== 'function') {
    throw new TypeError('client must implement requestBitableJson()');
  }
  requireText(client.appToken, 'client.appToken');
  return client;
}

function optionalText(value) {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

function requireText(value, name) {
  const normalized = optionalText(value);
  if (!normalized) throw new TypeError(`${name} is required`);
  return normalized;
}
