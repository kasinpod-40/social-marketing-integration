import { readLarkText } from '../../../connectors/src/shared/lark-cell-value.js';

const MAX_METADATA_RECORDS = 100;

/**
 * D1 remains metric/history authority. Lark is consulted only for bounded display metadata
 * belonging to the top-ranked Content identities selected by the D1 calculation.
 */
export async function hydrateTikTokReportContentMetadata(input = {}) {
  const repository = requireRepository(input.repository);
  const tableId = requireText(input.tableId, 'tableId');
  const contents = requireArray(input.contents, 'contents');
  const externalContentIds = normalizeIds(input.externalContentIds);
  if (externalContentIds.length === 0) return Object.freeze([...contents]);

  const records = await repository.listByFieldValues(
    tableId,
    'external_content_id',
    externalContentIds,
  );
  const metadataById = new Map();
  for (const record of records) {
    const fields = record?.fields ?? {};
    const externalContentId = readLarkText(fields.external_content_id, {
      allowNull: true,
      label: 'external_content_id',
    });
    if (!externalContentId || !externalContentIds.includes(externalContentId)) continue;
    if (metadataById.has(externalContentId)) {
      throw new Error(`Duplicate TikTok metadata cache identity: ${externalContentId}`);
    }
    metadataById.set(externalContentId, Object.freeze({
      caption: readLarkText(fields.caption, { allowNull: true, label: 'caption' }),
      contentUrl: readLarkText(fields.content_url, { allowNull: true, label: 'content_url' }),
      thumbnailUrl: readLarkText(fields.thumbnail_url, { allowNull: true, label: 'thumbnail_url' }),
    }));
  }

  return Object.freeze(contents.map((content) => {
    const metadata = metadataById.get(content.externalContentId);
    return metadata ? Object.freeze({ ...content, ...metadata }) : content;
  }));
}

function normalizeIds(value) {
  if (!Array.isArray(value)) throw new TypeError('TikTok metadata hydration requires externalContentIds');
  const ids = [...new Set(value.map((item) => requireText(item, 'externalContentId')))];
  if (ids.length > MAX_METADATA_RECORDS) {
    throw new RangeError(`TikTok metadata hydration supports at most ${MAX_METADATA_RECORDS} records`);
  }
  return Object.freeze(ids.sort());
}

function requireRepository(value) {
  if (typeof value?.listByFieldValues !== 'function') {
    throw new TypeError('TikTok metadata hydration requires repository.listByFieldValues');
  }
  return value;
}

function requireArray(value, fieldName) {
  if (!Array.isArray(value)) throw new TypeError(`TikTok metadata hydration requires ${fieldName}`);
  return value;
}

function requireText(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new TypeError(`TikTok metadata hydration requires ${fieldName}`);
  }
  return value.trim();
}
