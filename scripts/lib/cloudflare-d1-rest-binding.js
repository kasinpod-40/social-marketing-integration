const API_ROOT = 'https://api.cloudflare.com/client/v4';

/**
 * D1 binding-compatible adapter for reviewed local operators. Heavy transforms stay on the
 * operator machine while every SQL write still goes through Cloudflare's parameterized D1 API.
 */
export class CloudflareD1RestBinding {
  constructor(input = {}) {
    this.accountId = requireText(input.accountId, 'accountId');
    this.databaseId = requireText(input.databaseId, 'databaseId');
    this.tokenProvider = requireFunction(input.tokenProvider, 'tokenProvider');
    this.fetchImpl = input.fetchImpl ?? globalThis.fetch?.bind(globalThis);
    if (typeof this.fetchImpl !== 'function') throw new TypeError('fetchImpl is required');
  }

  prepare(sql) {
    return new RestPreparedStatement(this, requireText(sql, 'sql'));
  }

  async batch(statements) {
    if (!Array.isArray(statements) || statements.length === 0) {
      throw new TypeError('batch statements are required');
    }
    const batch = statements.map((statement) => {
      if (!(statement instanceof RestPreparedStatement) || statement.binding !== this) {
        throw new TypeError('batch statement belongs to another D1 binding');
      }
      return { sql: statement.sql, params: statement.params };
    });
    return this.executeBatch(batch);
  }

  async executeBatch(batch) {
    const path = `/accounts/${encodeURIComponent(this.accountId)}`
      + `/d1/database/${encodeURIComponent(this.databaseId)}/raw`;
    let lastError = null;
    for (let attempt = 1; attempt <= 5; attempt += 1) {
      const token = await this.tokenProvider(attempt > 1 && lastError?.status === 401);
      const response = await this.fetchImpl(`${API_ROOT}${path}`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${requireText(token, 'token')}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ batch }),
        signal: AbortSignal.timeout(60_000),
      });
      const body = await response.json().catch(() => null);
      if (response.ok && body?.success === true) {
        const blocks = Array.isArray(body.result) ? body.result : [body.result];
        return blocks.map(normalizeBlock);
      }
      lastError = new Error(`Cloudflare D1 API failed with HTTP ${response.status}`);
      lastError.status = response.status;
      lastError.code = 'CLOUDFLARE_D1_REST_FAILED';
      lastError.details = { errorCode: body?.errors?.[0]?.code ?? null };
      if (![401, 408, 409, 429, 500, 502, 503, 504].includes(response.status) || attempt === 5) {
        throw lastError;
      }
      await new Promise((resolve) => setTimeout(resolve, 1_000 * attempt));
    }
    throw lastError;
  }
}

class RestPreparedStatement {
  constructor(binding, sql, params = []) {
    this.binding = binding;
    this.sql = sql;
    this.params = params;
  }

  bind(...params) {
    return new RestPreparedStatement(this.binding, this.sql, structuredClone(params));
  }

  async run() {
    return (await this.binding.executeBatch([{ sql: this.sql, params: this.params }]))[0];
  }

  async all() {
    return (await this.binding.executeBatch([{ sql: this.sql, params: this.params }]))[0];
  }

  async first(column) {
    const result = await this.all();
    const row = result.results[0] ?? null;
    return column === undefined || row === null ? row : row[column];
  }
}

function normalizeBlock(block) {
  const raw = block?.results;
  let results;
  if (Array.isArray(raw)) results = raw;
  else if (Array.isArray(raw?.columns) && Array.isArray(raw?.rows)) {
    results = raw.rows.map((row) => Object.fromEntries(raw.columns.map((column, index) => [column, row[index]])));
  } else results = [];
  return Object.freeze({
    success: block?.success !== false,
    results: Object.freeze(results.map((row) => Object.freeze({ ...row }))),
    meta: Object.freeze({ ...(block?.meta ?? {}) }),
  });
}

function requireText(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') throw new TypeError(`${fieldName} is required`);
  return value.trim();
}

function requireFunction(value, fieldName) {
  if (typeof value !== 'function') throw new TypeError(`${fieldName} is required`);
  return value;
}
