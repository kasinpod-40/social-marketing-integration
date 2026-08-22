const LARK_NO_OPERATION_PRODUCED = 800070003;

/**
 * Wraps the existing Target client only for the documented Base v3 visible_fields
 * write lane. Lark can return 800070003 ("no operation produced") for a PUT.
 * That response is accepted only when an immediate GET proves the requested
 * ordered visible-field list is already exact. Otherwise the original safety
 * contract remains fail-closed and the caller's rollback path runs normally.
 */
export function createVisibleFieldOrderNoOperationGuard(targetClient, steps = []) {
  if (!targetClient || typeof targetClient.requestBitableJson !== 'function') {
    throw new TypeError('targetClient.requestBitableJson() is required');
  }

  const contextByPath = new Map();
  for (const step of steps) {
    const tableId = optionalText(step?.targetTableId);
    const viewId = optionalText(step?.targetViewId);
    if (!tableId || !viewId) continue;
    contextByPath.set(
      visibleFieldsPath(targetClient.appToken, tableId, viewId),
      Object.freeze({
        tableName: optionalText(step?.tableName),
        viewName: optionalText(step?.viewName),
      }),
    );
  }

  const stats = {
    verifiedNoOperationCount: 0,
  };

  const guardedRequest = async (path, options = {}) => {
    try {
      return await targetClient.requestBitableJson(path, options);
    } catch (error) {
      if (!isVisibleFieldNoOperation(error, path, options)) throw error;

      const expected = normalizeVisibleFields(options?.body?.visible_fields, 'requested visible_fields');
      const readback = await targetClient.requestBitableJson(path, { method: 'GET' });
      const actual = normalizeVisibleFieldsResponse(readback?.data);

      if (sameOrderedList(actual, expected)) {
        stats.verifiedNoOperationCount += 1;
        return {
          code: 0,
          data: actual,
          verifiedNoOperation: true,
        };
      }

      const context = contextByPath.get(path) ?? {};
      throw codedError(
        'VISIBLE_FIELD_ORDER_LARK_NO_OPERATION_NOT_APPLIED',
        `Lark returned no operation produced and readback still differs${context.tableName && context.viewName ? `: ${context.tableName}.${context.viewName}` : ''}`,
        {
          tableName: context.tableName ?? null,
          viewName: context.viewName ?? null,
          larkCode: Number(error?.details?.larkCode ?? LARK_NO_OPERATION_PRODUCED),
          expectedVisibleFields: expected,
          actualVisibleFields: actual,
        },
      );
    }
  };

  const client = new Proxy(targetClient, {
    get(target, property, receiver) {
      if (property === 'requestBitableJson') return guardedRequest;
      const value = Reflect.get(target, property, receiver);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });

  return Object.freeze({ client, stats });
}

function isVisibleFieldNoOperation(error, path, options) {
  return error?.code === 'LARK_PERMANENT_API_ERROR'
    && Number(error?.details?.larkCode) === LARK_NO_OPERATION_PRODUCED
    && options?.method === 'PUT'
    && typeof path === 'string'
    && path.endsWith('/visible_fields')
    && Array.isArray(options?.body?.visible_fields);
}

function normalizeVisibleFieldsResponse(value) {
  const raw = Array.isArray(value)
    ? value
    : Array.isArray(value?.visible_fields)
      ? value.visible_fields
      : Array.isArray(value?.visibleFields)
        ? value.visibleFields
        : null;
  if (!raw) throw new TypeError('Base v3 visible_fields readback must contain an array');
  return normalizeVisibleFields(raw, 'Base v3 visible_fields readback');
}

function normalizeVisibleFields(value, name) {
  if (!Array.isArray(value)) throw new TypeError(`${name} must be an array`);
  const normalized = value.map((item, index) => requireText(item, `${name}[${index}]`));
  if (new Set(normalized).size !== normalized.length) {
    throw new TypeError(`${name} must not contain duplicates`);
  }
  return normalized;
}

function sameOrderedList(left, right) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function visibleFieldsPath(appToken, tableId, viewId) {
  return `/open-apis/base/v3/bases/${encodeURIComponent(requireText(appToken, 'target appToken'))}/tables/${encodeURIComponent(tableId)}/views/${encodeURIComponent(viewId)}/visible_fields`;
}

function optionalText(value) {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

function requireText(value, name) {
  const normalized = optionalText(value);
  if (!normalized) throw new TypeError(`${name} is required`);
  return normalized;
}

function codedError(code, message, details = {}) {
  const error = new Error(message);
  error.code = code;
  error.details = details;
  return error;
}
