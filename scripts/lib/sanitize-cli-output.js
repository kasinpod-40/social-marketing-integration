export function sanitizeCliOutput(value, { maxLength = 8_192 } = {}) {
  const text = String(value ?? '')
    .replace(/(authorization\s*[:=]\s*bearer\s+)[^\s]+/giu, '$1[REDACTED]')
    .replace(/((?:api|access|auth|refresh|client)[_-]?token\s*[:=]\s*)[^\s]+/giu, '$1[REDACTED]')
    .replace(/((?:secret|password)\s*[:=]\s*)[^\s]+/giu, '$1[REDACTED]')
    .trim();
  return text ? text.slice(-maxLength) : null;
}
