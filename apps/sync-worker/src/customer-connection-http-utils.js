const MAX_BODY_BYTES = 16 * 1024;
const MAX_CONFIRMATION_BODY_BYTES = 1024;

/** Security headers ร่วมสำหรับทุก customer-facing OAuth browser response */
export function connectionSecurityHeaders(extra = {}) {
  return {
    'cache-control': 'no-store',
    'content-security-policy': "default-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
    'cross-origin-opener-policy': 'same-origin',
    'permissions-policy': 'camera=(), microphone=(), geolocation=()',
    'referrer-policy': 'no-referrer',
    'x-content-type-options': 'nosniff',
    ...extra,
  };
}

export async function requireConnectionConfirmation(request) {
  const contentType = request.headers.get('content-type') ?? '';
  if (!contentType.toLowerCase().startsWith('application/x-www-form-urlencoded')) {
    throw connectionRequestError('CONNECTION_CONFIRMATION_CONTENT_TYPE_INVALID');
  }
  const declaredLength = Number(request.headers.get('content-length') ?? 0);
  if (Number.isFinite(declaredLength) && declaredLength > MAX_CONFIRMATION_BODY_BYTES) {
    throw connectionRequestError('CONNECTION_CONFIRMATION_TOO_LARGE');
  }
  const text = await readBoundedText(
    request,
    MAX_CONFIRMATION_BODY_BYTES,
    'CONNECTION_CONFIRMATION_TOO_LARGE',
  );
  const form = new URLSearchParams(text);
  if (
    [...form.keys()].some((key) => key !== 'confirm')
    || form.getAll('confirm').length !== 1
    || form.get('confirm') !== 'connect'
  ) {
    throw connectionRequestError('CONNECTION_CONFIRMATION_INVALID');
  }
}

export function connectionConfirmationPage(input = {}) {
  const connectorLabel = requireConnectionText(input.connectorLabel, 'connectorLabel');
  const attemptsRemaining = requireNonNegativeInteger(
    input.preview?.attemptsRemaining,
    'attemptsRemaining',
  );
  const expiresAt = requireIsoTimestamp(input.preview?.expiresAt, 'expiresAt');
  const retryAvailableAt = input.preview?.retryAvailableAt
    ? requireIsoTimestamp(input.preview.retryAvailableAt, 'retryAvailableAt')
    : null;
  const canStart = input.preview?.canStart === true;
  const action = canStart
    ? `
      <form method="post">
        <input type="hidden" name="confirm" value="connect">
        <button type="submit">ดำเนินการต่อด้วย Google</button>
      </form>`
    : `<p>มีการเชื่อมต่อที่กำลังดำเนินการอยู่ กรุณาลองใหม่หลัง ${escapeHtml(retryAvailableAt)} น.</p>`;
  const html = `<!doctype html>
<html lang="th">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex,nofollow">
  <title>ยืนยันการเชื่อมต่อ ${escapeHtml(connectorLabel)}</title>
</head>
<body>
  <main>
    <h1>ยืนยันการเชื่อมต่อ ${escapeHtml(connectorLabel)}</h1>
    <p>หน้านี้ยังไม่เริ่ม OAuth จนกว่าคุณจะกดปุ่มยืนยัน</p>
    <p>เริ่มใหม่ได้อีก ${attemptsRemaining} ครั้งภายในอายุลิงก์</p>
    <p>ลิงก์หมดอายุ: ${escapeHtml(expiresAt)}</p>
    ${action}
  </main>
</body>
</html>`;
  return new Response(html, {
    status: 200,
    headers: connectionSecurityHeaders({
      'content-type': 'text/html; charset=utf-8',
    }),
  });
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
  const text = await readBoundedText(
    request,
    MAX_BODY_BYTES,
    'CONNECTION_REQUEST_TOO_LARGE',
  );
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

function requireNonNegativeInteger(value, fieldName) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0) {
    throw new TypeError(`${fieldName} must be a non-negative integer`);
  }
  return number;
}

function requireIsoTimestamp(value, fieldName) {
  const text = requireConnectionText(value, fieldName);
  if (Number.isNaN(Date.parse(text))) throw new TypeError(`${fieldName} must be an ISO timestamp`);
  return text;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

async function readBoundedText(request, maximumBytes, errorCode) {
  if (!request.body) return '';
  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let totalBytes = 0;
  let text = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    totalBytes += value.byteLength;
    if (totalBytes > maximumBytes) {
      await reader.cancel();
      throw connectionRequestError(errorCode);
    }
    text += decoder.decode(value, { stream: true });
  }
  return text + decoder.decode();
}
