export function validateNormalizedContent(content) {
  const required = ['platform', 'accountId', 'externalContentId'];
  const missing = required.filter((key) => !content?.[key]);

  if (missing.length > 0) {
    return { ok: false, errors: missing.map((key) => `${key} is required`) };
  }

  return { ok: true, errors: [] };
}
