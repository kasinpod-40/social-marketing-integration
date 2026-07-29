const DEFAULT_PAGE_SIZE = 500;
const DEFAULT_MAX_PAGES = 100;

/**
 * Read-only client สำหรับ Native Dashboard inventory.
 * ใช้ Auth/Retry/Rate-limit queue จาก LarkBitableClient เดิม และไม่เปิด Dashboard mutation path.
 */
export class LarkDashboardClient {
  constructor(input = {}) {
    this.client = requireBitableClient(input.client);
    this.appToken = requireText(input.appToken ?? this.client.appToken, 'appToken');
    this.pageSize = positiveInteger(input.pageSize ?? DEFAULT_PAGE_SIZE, 'pageSize');
    this.maxPages = positiveInteger(input.maxPages ?? DEFAULT_MAX_PAGES, 'maxPages');
  }

  async listDashboards() {
    const dashboards = [];
    const seenTokens = new Set();
    let pageToken = null;

    for (let page = 1; page <= this.maxPages; page += 1) {
      const params = new URLSearchParams({ page_size: String(this.pageSize) });
      if (pageToken) params.set('page_token', pageToken);
      const response = await this.client.requestBitableJson(
        `/open-apis/bitable/v1/apps/${encodeURIComponent(this.appToken)}/dashboards?${params.toString()}`,
        { method: 'GET' },
      );
      const data = response?.data ?? {};
      const items = Array.isArray(data.dashboards)
        ? data.dashboards
        : Array.isArray(data.items) ? data.items : [];
      dashboards.push(...items.map(normalizeDashboard));

      if (data.has_more !== true) return Object.freeze(dashboards);
      const nextToken = normalizeOptionalText(data.page_token);
      if (!nextToken) {
        throw new Error('Lark dashboard pagination returned has_more=true without page_token');
      }
      if (seenTokens.has(nextToken)) {
        throw new Error(`Lark dashboard pagination returned repeated page_token: ${nextToken}`);
      }
      seenTokens.add(nextToken);
      pageToken = nextToken;
    }

    throw new Error(`Lark dashboard pagination exceeded ${this.maxPages} pages`);
  }
}

function normalizeDashboard(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('Lark dashboard response item must be an object');
  }
  return Object.freeze({
    blockId: requireText(value.block_id ?? value.blockId, 'dashboard.blockId'),
    name: requireText(value.name, 'dashboard.name'),
  });
}
function requireBitableClient(value) {
  if (typeof value?.requestBitableJson !== 'function') {
    throw new TypeError('LarkDashboardClient requires LarkBitableClient.requestBitableJson');
  }
  return value;
}
function positiveInteger(value, fieldName) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number <= 0) throw new TypeError(`${fieldName} must be positive`);
  return number;
}
function normalizeOptionalText(value) {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}
function requireText(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') throw new TypeError(`${fieldName} is required`);
  return value.trim();
}
