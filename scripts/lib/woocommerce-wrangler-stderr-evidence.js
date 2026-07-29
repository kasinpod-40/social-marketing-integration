import { createHash } from 'node:crypto';

const MAX_LINES = 12;
const MAX_LINE_LENGTH = 500;
const MAX_TOTAL_LENGTH = 4_000;
const DIAGNOSTIC_LINE_PATTERN = /(?:validation|invalid|required|unsupported|not allowed|failed|error|code|alias|preview|binding|secret|worker|api|permission|limit|exceed|conflict)/iu;

/** Return bounded and strictly redacted diagnostic lines from Wrangler stderr. */
export function extractWooCommerceWranglerStderrEvidence(stderrInput) {
  const raw = String(stderrInput ?? '');
  const candidates = stripAnsi(raw)
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line !== '' && DIAGNOSTIC_LINE_PATTERN.test(line))
    .map(redactLine)
    .filter(Boolean);

  const unique = [];
  const seen = new Set();
  let totalLength = 0;
  for (const candidate of candidates) {
    const bounded = candidate.slice(0, MAX_LINE_LENGTH);
    if (seen.has(bounded)) continue;
    const nextLength = totalLength + bounded.length;
    if (unique.length >= MAX_LINES || nextLength > MAX_TOTAL_LENGTH) break;
    seen.add(bounded);
    unique.push(bounded);
    totalLength = nextLength;
  }

  return Object.freeze({
    stderrEvidenceLineCount: unique.length,
    stderrEvidenceLines: Object.freeze(unique),
    stderrSha256: sha256(raw),
    stderrEvidenceRedacted: true,
    rawStderrPersisted: false,
  });
}

function redactLine(value) {
  return String(value ?? '')
    .replace(/\b(authorization|token|secret|password|cookie|api[_-]?key|consumer[_-]?(?:key|secret))\b\s*[:=]\s*(?:Bearer\s+[A-Za-z0-9._~+/=-]+|"[^"]*"|'[^']*'|[^\s,;]+)/giu, '$1=[REDACTED]')
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/giu, 'Bearer [REDACTED]')
    .replace(/\bck_[A-Za-z0-9_-]+\b/giu, 'ck_[REDACTED]')
    .replace(/\bcs_[A-Za-z0-9_-]+\b/giu, 'cs_[REDACTED]')
    .replace(/https?:\/\/[^\s"'<>]+/giu, '[REDACTED_URL]')
    .replace(/\b[0-9a-f]{32}\b/giu, '[REDACTED_ACCOUNT_ID]')
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/giu, '[REDACTED_UUID]')
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/giu, '[REDACTED_EMAIL]')
    .replace(/(?:\/Users|\/home|\/private\/var\/folders|\/tmp)\/[^\s"'<>]+/gu, '[REDACTED_PATH]')
    .replace(/\b[A-Za-z0-9_-]{48,}\b/gu, '[REDACTED_LONG_VALUE]')
    .trim();
}

function stripAnsi(value) {
  return String(value ?? '').replace(/\u001B\[[0-?]*[ -/]*[@-~]/gu, '');
}

function sha256(value) {
  return createHash('sha256').update(String(value)).digest('hex');
}
