const MAX_BODY_BYTES = 16 * 1024;

/** Security headers ร่วมสำหรับทุก customer-facing OAuth browser response */
export function connectionSecurityHeaders(extra = {}) {
  return {
    'cache-control': 'no-store',
    'content-security-policy': "default-src 'none'; frame-ancestors 'none'",
    'referrer-policy': 'no-referrer',
    'x-content-type-options': 'nosniff',
    ...extra,
  };
}

export async function readBoundedConnectionJson(request) {
  const contentType = request.headers.get('content-type') ?? '';
  if (!contentType.toLowerCase().startsWith('application/json')) {
    throw connectionRequestError('CONNECTION_REQUEST_CONTENT_TYPE_INVALID');
  }
  const declaredLength = Number(request.headers.get('content-length') ?? 0);
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
    throw connectionRequestError('CONNECTION_REQUEST_TOO_LARGE');
  }
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > MAX_BODY_BYTES) {
    throw connectionRequestError('CONNECTION_REQUEST_TOO_LARGE');
  }
  try {
    const value = JSON.parse(text);
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError();
    return value;
  } catch {
    throw connectionRequestError('CONNECTION_REQUEST_JSON_INVALID');
  }
}

export function requireConnectionQuery(url, name) {
  return requireConnectionText(url.searchParams.get(name), name);
}

export function requireConnectionText(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw connectionRequestError(
      `CONNECTION_REQUEST_${String(fieldName).toUpperCase()}_INVALID`,
    );
  }
  return value.trim();
}

export function connectionRequestError(code) {
  const error = new Error('Customer connection request is invalid');
  error.code = code;
  return error;
}
