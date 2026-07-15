/** ตรวจค่าตัวอย่างที่ห้ามใช้เป็น Runtime configuration จริง */
export function isPlaceholderConfigValue(value) {
  if (typeof value !== 'string') return false;
  const normalized = value.trim().toLowerCase();
  if (!normalized) return false;
  return normalized.startsWith('replace-with-')
    || normalized.startsWith('replace_with_')
    || normalized.startsWith('your-')
    || normalized.startsWith('your_')
    || normalized.startsWith('<')
    || normalized === 'todo'
    || normalized === 'changeme'
    || normalized.includes('placeholder')
    || /^0{8}-/u.test(normalized);
}

/** อ่าน String configuration พร้อมปฏิเสธ Placeholder ก่อนเรียก External API */
export function requireConfiguredText(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new TypeError(`Missing ${fieldName}`);
  }
  const normalized = value.trim();
  if (isPlaceholderConfigValue(normalized)) {
    const error = new Error(`${fieldName} still contains a placeholder value`);
    error.code = 'MKT_RUNTIME_CONFIG_PLACEHOLDER';
    error.retryable = false;
    error.details = Object.freeze({ fieldName });
    throw error;
  }
  return normalized;
}
