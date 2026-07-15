import { YOUTUBE_LARK_BLUEPRINT } from './youtube-organic-blueprint.js';
import { LARK_TABLE_ENV } from './lark-table-config.js';
import { permanentError } from '../../shared/src/errors/runtime-error.js';

export const YOUTUBE_LARK_SCHEMA_VERSION = 'youtube-organic-lark-schema-v1';

const TABLE_PRESENTATION = Object.freeze({
  rawYouTubeChannels: Object.freeze({
    createName: 'RAW_YouTube_Channels',
    aliases: Object.freeze(['RAW_YouTube_Channels', '🧪 RAW_YouTube_Channels']),
    defaultViewName: '📋 All Channels',
  }),
  rawYouTubeVideos: Object.freeze({
    createName: 'RAW_YouTube_Videos',
    aliases: Object.freeze(['RAW_YouTube_Videos', '🧪 RAW_YouTube_Videos']),
    defaultViewName: '📋 All Videos',
  }),
  rawYouTubeAnalyticsDaily: Object.freeze({
    createName: 'RAW_YouTube_Analytics_Daily',
    aliases: Object.freeze(['RAW_YouTube_Analytics_Daily', '🧪 RAW_YouTube_Analytics_Daily']),
    defaultViewName: '📋 All Analytics',
  }),
});

/** Contract สำหรับ Preview/Apply สาม YouTube RAW tables โดย derive จาก Blueprint ชุดเดียว */
export const YOUTUBE_LARK_SCHEMA = deepFreeze(YOUTUBE_LARK_BLUEPRINT.map((table) => {
  const presentation = TABLE_PRESENTATION[table.key];
  if (!presentation) {
    throw permanentError(`Missing YouTube Lark presentation for ${table.key}`, {
      code: 'YOUTUBE_LARK_SCHEMA_INVALID',
      details: { tableKey: table.key },
    });
  }
  const envName = LARK_TABLE_ENV[table.key];
  if (!envName) {
    throw permanentError(`Missing YouTube Lark environment mapping for ${table.key}`, {
      code: 'YOUTUBE_LARK_SCHEMA_INVALID',
      details: { tableKey: table.key },
    });
  }

  return {
    key: table.key,
    createName: presentation.createName,
    aliases: presentation.aliases,
    envName,
    defaultViewName: presentation.defaultViewName,
    logicalName: table.tableName,
    fields: [...table.fields]
      .sort((left, right) => left.order - right.order)
      .map(toInstallerField),
  };
}));

/** ตรวจ Schema ที่ derive จาก Blueprint เพื่อจับ Field order/Primary/Select contract ก่อนเรียก Lark */
export function validateYouTubeLarkSchema(schema = YOUTUBE_LARK_SCHEMA) {
  if (!Array.isArray(schema) || schema.length !== 3) {
    throw permanentError('YouTube Lark schema must contain exactly three RAW tables', {
      code: 'YOUTUBE_LARK_SCHEMA_INVALID',
    });
  }

  const tableKeys = new Set();
  for (const table of schema) {
    if (tableKeys.has(table.key)) throw invalid(`Duplicate YouTube table key: ${table.key}`);
    tableKeys.add(table.key);
    if (!Array.isArray(table.fields) || table.fields.length === 0) {
      throw invalid(`YouTube table ${table.key} has no fields`);
    }
    const primaryFields = table.fields.filter((field) => field.primary === true);
    if (primaryFields.length !== 1 || table.fields[0].primary !== true) {
      throw invalid(`YouTube table ${table.key} must have exactly one Primary field as the first field`);
    }
    const names = new Set();
    for (const field of table.fields) {
      if (names.has(field.fieldName)) throw invalid(`Duplicate field ${table.key}.${field.fieldName}`);
      names.add(field.fieldName);
    }
  }
  return true;
}

function toInstallerField(field) {
  const property = field.type === 3
    ? { options: field.options.map((name, index) => ({ name, color: index % 8 })) }
    : undefined;
  return {
    fieldName: field.fieldName,
    type: field.type,
    uiType: readUiType(field.type),
    primary: field.primary === true,
    description: [field.semantics, field.importNote].filter(Boolean).join(' — '),
    ...(property ? { property } : {}),
  };
}

function readUiType(type) {
  return ({ 1: 'Text', 2: 'Number', 3: 'SingleSelect', 5: 'DateTime', 7: 'Checkbox', 15: 'URL' })[type]
    ?? `LarkType${type}`;
}

function invalid(message) {
  return permanentError(message, { code: 'YOUTUBE_LARK_SCHEMA_INVALID' });
}

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}
