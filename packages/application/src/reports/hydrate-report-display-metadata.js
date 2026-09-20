import { readLarkText } from '../../../connectors/src/shared/lark-cell-value.js';
import { createAdsEntityKey } from '../../../domain/src/entities/ads.js';

const MAX_METADATA_RECORDS = 50_000;

/**
 * D1 remains the ranking and metric authority. Lark is read only for the bounded
 * display metadata of Content identities that D1 already selected.
 */
export async function hydrateReportTopContentMetadata(input = {}) {
  const repository = requireRepository(input.repository);
  const tableId = requireText(input.tableId, 'tableId');
  const rows = requireRows(input.rows);
  const keys = normalizeKeys(rows.map((row) => row?.content_key), 'content_key');
  if (keys.length === 0) return Object.freeze([...rows]);

  const metadataByKey = await readUniqueMetadata({
    repository,
    tableId,
    keyField: 'content_key',
    keys,
    readMetadata(fields) {
      return Object.freeze({
        caption: readLarkText(fields.caption, { allowNull: true, label: 'caption' }),
        content_url: readLarkText(fields.content_url, { allowNull: true, label: 'content_url' }),
        thumbnail_url: readLarkText(fields.thumbnail_url, { allowNull: true, label: 'thumbnail_url' }),
      });
    },
  });

  const missingRows = rows.filter((row) => !metadataByKey.has(row.content_key));
  const metadataByExternalId = missingRows.length > 0
    ? await readContentMetadataByExternalId({
      repository,
      tableId,
      rows: missingRows,
    })
    : new Map();

  return Object.freeze(rows.map((row) => {
    const metadata = metadataByKey.get(row.content_key)
      ?? metadataByExternalId.get(contentExternalIdentity(row));
    return metadata ? Object.freeze({
      ...row,
      caption: metadata.caption ?? row.caption ?? contentDisplayLabel(row),
      content_url: metadata.content_url ?? row.content_url ?? null,
      thumbnail_url: metadata.thumbnail_url ?? row.thumbnail_url ?? null,
    }) : Object.freeze({
      ...row,
      caption: row.caption ?? contentDisplayLabel(row),
    });
  }));
}

function contentDisplayLabel(row) {
  const platform = optionalText(row?.platform)?.toLowerCase() ?? 'content';
  const externalId = optionalText(row?.external_content_id);
  const shortId = externalId?.split('_').at(-1) ?? null;
  const label = ({
    facebook: 'โพสต์ Facebook',
    instagram: 'โพสต์ Instagram',
    tiktok: 'วิดีโอ TikTok',
    youtube: 'วิดีโอ YouTube',
  })[platform] ?? 'คอนเทนต์';
  return `${label}${shortId ? ` #${shortId}` : ''} (ไม่มีข้อความ)`;
}

async function readContentMetadataByExternalId(input) {
  const externalIds = normalizeKeys(
    input.rows.map((row) => row?.external_content_id),
    'external_content_id',
  );
  if (externalIds.length === 0) return new Map();
  const records = await input.repository.listByFieldValues(
    input.tableId,
    'external_content_id',
    externalIds,
  );
  const allowed = new Set(input.rows.map(contentExternalIdentity));
  const metadataByIdentity = new Map();
  for (const record of records) {
    const fields = record?.fields ?? {};
    const identity = contentExternalIdentity({
      platform: readLarkText(fields.platform, { allowNull: true, label: 'platform' }),
      external_content_id: readLarkText(fields.external_content_id, {
        allowNull: true,
        label: 'external_content_id',
      }),
    });
    if (!allowed.has(identity)) continue;
    if (metadataByIdentity.has(identity)) {
      throw new Error(`Duplicate Lark display metadata identity: ${identity}`);
    }
    metadataByIdentity.set(identity, Object.freeze({
      caption: readLarkText(fields.caption, { allowNull: true, label: 'caption' }),
      content_url: readLarkText(fields.content_url, { allowNull: true, label: 'content_url' }),
      thumbnail_url: readLarkText(fields.thumbnail_url, { allowNull: true, label: 'thumbnail_url' }),
    }));
  }
  return metadataByIdentity;
}

function contentExternalIdentity(row) {
  const platform = optionalText(row?.platform);
  const externalContentId = optionalText(row?.external_content_id);
  return platform && externalContentId ? `${platform.toLowerCase()}::${externalContentId}` : '';
}

/** Read canonical Ad names only for D1-ranked Ad identities. */
export async function hydrateReportTopAdsMetadata(input = {}) {
  const repository = requireRepository(input.repository);
  const tableId = requireText(input.tableId, 'tableId');
  const platform = requireText(input.platform, 'platform');
  const accountId = requireText(input.accountId, 'accountId');
  const rows = requireRows(input.rows);
  const keyByAdId = new Map();
  for (const row of rows) {
    const externalAdId = optionalText(row?.external_ad_id);
    if (!externalAdId) continue;
    keyByAdId.set(externalAdId, createAdsEntityKey({
      platform,
      accountId,
      entityType: 'ad',
      externalEntityId: externalAdId,
    }));
  }
  const keys = normalizeKeys([...keyByAdId.values()], 'ads_ad_key');
  if (keys.length === 0) return Object.freeze([...rows]);

  const metadataByKey = await readUniqueMetadata({
    repository,
    tableId,
    keyField: 'ads_ad_key',
    keys,
    readMetadata(fields) {
      return Object.freeze({
        ad_name: readLarkText(fields.ad_name, { allowNull: true, label: 'ad_name' }),
      });
    },
  });

  return Object.freeze(rows.map((row) => {
    const key = keyByAdId.get(row.external_ad_id);
    const metadata = key ? metadataByKey.get(key) : null;
    return metadata?.ad_name ? Object.freeze({ ...row, ad_name: metadata.ad_name }) : row;
  }));
}

async function readUniqueMetadata(input) {
  const records = await input.repository.listByFieldValues(
    input.tableId,
    input.keyField,
    input.keys,
  );
  const allowed = new Set(input.keys);
  const metadataByKey = new Map();
  for (const record of records) {
    const fields = record?.fields ?? {};
    const key = readLarkText(fields[input.keyField], {
      allowNull: true,
      label: input.keyField,
    });
    if (!key || !allowed.has(key)) continue;
    if (metadataByKey.has(key)) {
      throw new Error(`Duplicate Lark display metadata identity: ${input.keyField}=${key}`);
    }
    metadataByKey.set(key, input.readMetadata(fields));
  }
  return metadataByKey;
}

function normalizeKeys(values, fieldName) {
  const keys = [...new Set(values.map(optionalText).filter(Boolean))].sort();
  if (keys.length > MAX_METADATA_RECORDS) {
    throw new RangeError(`Report display metadata supports at most ${MAX_METADATA_RECORDS} ${fieldName} values`);
  }
  return Object.freeze(keys);
}
function requireRepository(value) {
  if (typeof value?.listByFieldValues !== 'function') {
    throw new TypeError('Report display metadata requires repository.listByFieldValues');
  }
  return value;
}
function requireRows(value) {
  if (!Array.isArray(value)) throw new TypeError('Report display metadata requires rows');
  if (value.length > MAX_METADATA_RECORDS) {
    throw new RangeError(`Report display metadata supports at most ${MAX_METADATA_RECORDS} rows`);
  }
  return value;
}
function requireText(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new TypeError(`Report display metadata requires ${fieldName}`);
  }
  return value.trim();
}
function optionalText(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}
