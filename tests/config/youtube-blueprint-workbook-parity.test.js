import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  YOUTUBE_DESTINATION_MAPPING,
  YOUTUBE_LARK_BLUEPRINT,
  YOUTUBE_ORGANIC_SOURCE_CONTRACT,
} from '../../packages/config/src/youtube-organic-blueprint.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const workbookPath = resolve(root, 'docs/Social_MKT_Data_Hub_Multi_Channel_Blueprint_v0.10.2.xlsx');
const TYPE_NAMES = new Map([[1, 'Text'], [2, 'Number'], [3, 'SingleSelect'], [5, 'DateTime'], [7, 'Checkbox'], [15, 'URL']]);

test('YouTube Workbook field contract matches source metadata for all 42 fields', () => {
  const fieldsRows = readSheet('YouTube Fields').slice(5).filter((row) => String(row[0] ?? '').startsWith('RAW_YouTube'));
  const optionRows = readSheet('Select Options').slice(5).filter((row) => String(row[0] ?? '').startsWith('RAW_YouTube'));
  const workbookOptions = new Map();
  for (const row of optionRows) {
    const key = `${row[0]}:${row[1]}`;
    const values = workbookOptions.get(key) ?? [];
    values.push(row[2]);
    workbookOptions.set(key, values);
  }

  const sourceFields = YOUTUBE_LARK_BLUEPRINT.flatMap((table) => table.fields.map((field) => ({
    tableName: table.tableName,
    ...field,
  })));
  assert.equal(fieldsRows.length, 42);
  assert.equal(sourceFields.length, 42);

  for (const row of fieldsRows) {
    const [tableName, order, fieldName, larkType, required, keyRole, nullable, sourcePath, semantics, , importNote] = row;
    const source = sourceFields.find((entry) => entry.tableName === tableName && entry.fieldName === fieldName);
    assert.ok(source, `Missing source field ${tableName}.${fieldName}`);
    assert.equal(source.order, Number(order), `${tableName}.${fieldName} order`);
    assert.equal(TYPE_NAMES.get(source.type), larkType, `${tableName}.${fieldName} type`);
    assert.equal(source.required, required === 'Yes', `${tableName}.${fieldName} required`);
    assert.equal(source.nullable, nullable === 'Yes', `${tableName}.${fieldName} nullable`);
    assert.equal(source.keyRole, keyRole, `${tableName}.${fieldName} key role`);
    assert.equal(source.sourcePath, sourcePath, `${tableName}.${fieldName} source path`);
    assert.equal(source.semantics, semantics, `${tableName}.${fieldName} semantics`);
    assert.equal(source.importNote, importNote, `${tableName}.${fieldName} import note`);
    assert.deepEqual(source.options, workbookOptions.get(`${tableName}:${fieldName}`) ?? [], `${tableName}.${fieldName} options`);
  }
});

test('YouTube Workbook contains deterministic Analytics and non-fabricated missing-row semantics', () => {
  const rows = readSheet('Keys & Metrics');
  const byName = new Map(rows.slice(5).map((row) => [row[1], row]));
  assert.equal(byName.get('content_daily_key')?.[2], 'youtube:{configured_account_key}:{video_id}:{metric_date}');
  assert.match(String(byName.get('sort_and_pagination')?.[2]), /sort=day,video/u);
  assert.match(String(byName.get('empty_or_unobserved_pair')?.[5]), /not a warning/u);
  assert.match(String(byName.get('previously_observed_row_missing')?.[5]), /previously observed row disappears/u);
  assert.deepEqual(YOUTUBE_ORGANIC_SOURCE_CONTRACT.analyticsApi.query.sort, ['day', 'video']);
});

test('YouTube Workbook maps every declared canonical destination field explicitly', () => {
  const rows = readSheet('YouTube Mapping').slice(5);
  for (const destination of ['MKT_Accounts', 'MKT_Content', 'MKT_Content_Daily']) {
    const workbookFields = new Set(rows.filter((row) => row[2] === destination).map((row) => row[3]));
    const sourceFields = Object.keys(YOUTUBE_DESTINATION_MAPPING[destination].fieldMap);
    assert.deepEqual([...workbookFields].sort(), sourceFields.sort(), `${destination} field map`);
  }
  assert.ok(rows.some((row) => row[0] === 'RAW_YouTube_Analytics_Daily' && row[2] === 'None'));
});

function readSheet(sheetName) {
  const workbookXml = unzipText('xl/workbook.xml');
  const relsXml = unzipText('xl/_rels/workbook.xml.rels');
  const sheetMatch = [...workbookXml.matchAll(/<x:sheet\b([^>]*)\/>/gu)]
    .map((match) => parseAttributes(match[1]))
    .find((attrs) => attrs.name === sheetName);
  if (!sheetMatch) throw new Error(`Workbook sheet not found: ${sheetName}`);
  const relMatch = [...relsXml.matchAll(/<Relationship\b([^>]*)\/>/gu)]
    .map((match) => parseAttributes(match[1]))
    .find((attrs) => attrs.Id === sheetMatch['r:id']);
  if (!relMatch) throw new Error(`Workbook relationship not found: ${sheetName}`);
  const target = String(relMatch.Target).replace(/^\//u, '');
  return parseSheetXml(unzipText(target));
}

function parseSheetXml(xml) {
  const rows = [];
  for (const rowMatch of xml.matchAll(/<x:row\b[^>]*r="(\d+)"[^>]*>([\s\S]*?)<\/x:row>/gu)) {
    const rowNumber = Number(rowMatch[1]);
    const values = [];
    const cellPattern = /<x:c\b([^>]*?)(?:\s*\/\s*>|>([\s\S]*?)<\/x:c>)/gu;
    for (const cellMatch of rowMatch[2].matchAll(cellPattern)) {
      const attrs = parseAttributes(cellMatch[1]);
      const column = columnIndex(String(attrs.r).replace(/\d+/gu, ''));
      values[column] = parseCellValue(attrs, cellMatch[2] ?? '');
    }
    rows[rowNumber - 1] = values;
  }
  return rows.map((row) => row ?? []);
}

function parseCellValue(attrs, inner) {
  const valueMatch = inner.match(/<x:v>([\s\S]*?)<\/x:v>/u);
  if (!valueMatch) return null;
  const value = decodeXml(valueMatch[1]);
  if (attrs.t === 'b') return value === '1';
  if (attrs.t === 'str' || attrs.t === 'inlineStr') return value;
  const number = Number(value);
  return Number.isFinite(number) ? number : value;
}

function parseAttributes(text) {
  return Object.fromEntries([...String(text).matchAll(/([\w:]+)="([^"]*)"/gu)]
    .map((match) => [match[1], decodeXml(match[2])]));
}

function columnIndex(letters) {
  let result = 0;
  for (const char of letters) result = (result * 26) + (char.charCodeAt(0) - 64);
  return result - 1;
}

function decodeXml(value) {
  return String(value)
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&apos;', "'")
    .replaceAll('&amp;', '&');
}

function unzipText(entry) {
  return execFileSync('unzip', ['-p', workbookPath, entry], { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 });
}
