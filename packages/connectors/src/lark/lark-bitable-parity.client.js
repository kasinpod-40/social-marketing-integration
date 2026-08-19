/**
 * Adds migration-only Base parity capabilities on top of the shared Lark Bitable client.
 *
 * This is a decorator over the existing authenticated/retried request transport, not a
 * second HTTP client. Only request contracts explicitly documented by Lark/Feishu are
 * allowed here. Unsupported View UI properties and unsupported Base-resource fields
 * remain fail-closed in the parity planner.
 */
export function withLarkBaseParityCapabilities(client) {
  requireTransport(client);
  const wrapped = Object.create(client);
  let formulaTypePromise = null;

  wrapped.getBaseFormulaType = async () => {
    if (!formulaTypePromise) {
      formulaTypePromise = client.requestBitableJson(appPath(client.appToken), { method: 'GET' })
        .then((response) => {
          const app = response?.data?.app ?? response?.data ?? {};
          const raw = app?.formula_type ?? app?.formulaType;
          if (raw === null || raw === undefined || raw === '') {
            throw new TypeError('Lark Base metadata formula_type must be an integer');
          }
          const formulaType = Number(raw);
          if (!Number.isInteger(formulaType)) {
            throw new TypeError('Lark Base metadata formula_type must be an integer');
          }
          return formulaType;
        })
        .catch((error) => {
          formulaTypePromise = null;
          throw error;
        });
    }
    return formulaTypePromise;
  };

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

  wrapped.listAdvancedPermissionRoles = async () => {
    const items = [];
    let pageToken = null;
    do {
      const query = new URLSearchParams({ page_size: '30' });
      if (pageToken) query.set('page_token', pageToken);
      const response = await client.requestBitableJson(
        `${legacyRolePath(client.appToken)}?${query.toString()}`,
        { method: 'GET' },
      );
      const data = response?.data ?? {};
      const pageItems = Array.isArray(data?.items) ? data.items : [];
      items.push(...pageItems.map(normalizeAdvancedPermissionRole));
      pageToken = data?.has_more === true ? optionalText(data?.page_token) : null;
    } while (pageToken);
    return Object.freeze(items);
  };

  wrapped.createAdvancedPermissionRole = async (input) => {
    const roleName = requireText(input?.roleName, 'roleName');
    const tableRoles = requireArray(input?.tableRoles, 'tableRoles').map((entry, index) => ({
      table_id: requireText(entry?.tableId, `tableRoles[${index}].tableId`),
      table_perm: requireFiniteNumber(entry?.tablePerm, `tableRoles[${index}].tablePerm`),
    }));
    const body = {
      role_name: roleName,
      table_roles: tableRoles,
    };
    const response = await client.requestBitableJson(modernRolePath(client.appToken), {
      method: 'POST',
      body,
    });
    const role = response?.data?.role ?? response?.data ?? {};
    return Object.freeze({
      roleId: optionalText(role?.role_id ?? role?.roleId),
      roleName: optionalText(role?.role_name ?? role?.roleName) ?? roleName,
      responseCode: Number(response?.code ?? 0),
    });
  };

  return wrapped;
}

function normalizeAdvancedPermissionRole(role) {
  const tableRoles = Array.isArray(role?.table_roles) ? role.table_roles : [];
  return Object.freeze({
    roleId: requireText(role?.role_id ?? role?.roleId, 'roleId'),
    roleName: requireText(role?.role_name ?? role?.roleName, 'roleName'),
    tableRoles: Object.freeze(tableRoles.map((entry, index) => Object.freeze({
      tableId: requireText(entry?.table_id ?? entry?.tableId, `tableRoles[${index}].tableId`),
      tableName: optionalText(entry?.table_name ?? entry?.tableName),
      tablePerm: requireFiniteNumber(entry?.table_perm ?? entry?.tablePerm, `tableRoles[${index}].tablePerm`),
    }))),
  });
}

function appPath(appToken) {
  return `/open-apis/bitable/v1/apps/${encodeURIComponent(requireText(appToken, 'appToken'))}`;
}

function viewPath(appToken, tableId, viewId) {
  return `/open-apis/bitable/v1/apps/${encodeURIComponent(requireText(appToken, 'appToken'))}`
    + `/tables/${encodeURIComponent(tableId)}/views/${encodeURIComponent(viewId)}`;
}

function legacyRolePath(appToken) {
  return `/open-apis/bitable/v1/apps/${encodeURIComponent(requireText(appToken, 'appToken'))}/roles`;
}

function modernRolePath(appToken) {
  return `/open-apis/base/v2/apps/${encodeURIComponent(requireText(appToken, 'appToken'))}/roles`;
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

function requireArray(value, name) {
  if (!Array.isArray(value)) throw new TypeError(`${name} must be an array`);
  return value;
}

function requireFiniteNumber(value, name) {
  const number = Number(value);
  if (!Number.isFinite(number)) throw new TypeError(`${name} must be a finite number`);
  return number;
}
