import { permanentError } from '../../../shared/src/errors/runtime-error.js';
import { createStableFingerprint } from '../../../shared/src/hash/stable-fingerprint.js';
import { dateOnlyInTimeZoneToEpochMilliseconds } from '../../../shared/src/date/date-time.js';

export const CUSTOMER_META_K2_LARK_IMPORT_MODE_ENV = 'MKT_CUSTOMER_META_K2_LARK_IMPORT_MODE';
export const CUSTOMER_META_K2_LARK_IMPORT_MODE = 'IMPORT_EXACT_K2_RECENT_MONTH_SNAPSHOT';
export const CUSTOMER_META_K2_SNAPSHOT_ID =
  'meta-chemistry_k2-recent-month-seed-20260724-20260823-a92e89d9cff8';
export const CUSTOMER_META_K2_SOURCE_ACCOUNT_ID = '505898710119851';
export const CUSTOMER_META_K2_BATCH_SIZE = 50;

const PERIOD = Object.freeze({ since: '2026-07-24', until: '2026-08-23' });
const SOURCE_TIME_ZONE = 'Asia/Bangkok';
const DAILY_STABLE_KEY_PATTERN = new RegExp(
  `^meta_ads:${CUSTOMER_META_K2_SOURCE_ACCOUNT_ID}:ad:([^:]+):(\\d{4}-\\d{2}-\\d{2})$`,
  'u',
);
const COMMON_REQUIRED_FIELDS = Object.freeze(['account_id', 'platform']);
const TABLE_CONTRACTS = Object.freeze({
  mktAdsCreatives: freezeTableContract({
    keyField: 'ads_creative_key',
    totalRows: 99,
    fields: [
      'account_id',
      'ads_creative_key',
      'creative_name',
      'creative_type',
      'external_creative_id',
      'platform',
    ],
    batchFingerprints: [
      '8824c295c9d0d8e941f469e8217a42bf23a6ebf52c3683ac183bbe83cd3c85d8',
      'cbab46fc194f6782dd4aedbec14f1ef8653c98f218a55241000237f0b5629364',
    ],
  }),
  mktAdsDaily: freezeTableContract({
    keyField: 'ads_daily_key',
    totalRows: 1809,
    fields: [
      'account_id',
      'ad_channel',
      'ads_daily_key',
      'clicks',
      'cpc',
      'cpm',
      'ctr',
      'currency',
      'entity_type',
      'external_ad_group_id',
      'external_ad_id',
      'external_campaign_id',
      'external_entity_id',
      'impressions',
      'metric_date',
      'platform',
      'reach',
      'spend',
      'spend_micros',
    ],
    batchFingerprints: [
      'a85a29bd83a98387e1d5dc17d66899efc8dc950658d5291ba30cbc5b99fbb176',
      'b55a6f0b2b2f66757d02cf42ff9fa8a05f26feb76c2a592c654a1a7aa404f3b8',
      '2ccaa64e54d64adc056ba273adc8f3b07c67a4214cedc337e954e61e22f70823',
      '54a0013397b2edd531fedc1f53cfed673b6af5c2f898d924dafc88afe016d664',
      '1b2dc3bb342de5994c60b850d7dc51cc89a57ef78d2a73fb92bdacb781dade83',
      '01344204e8f7472d8983daf94c8f8625d522c65b5fd457220a2262643fec673a',
      '9476c735ab93c5c09913be1fcfecd14096770f5a06cab5af18bf46a4136aa56b',
      'ea6ef372681b6ea933720c09537f385feabba1b9db188b8c31bee6f3bc92fb95',
      '9ad1f079c6b7a1f27881282e6440d74c7d9546a2ed9b1915ce16633ad5ce27b1',
      '267a007a4a7626627ec5be26af62e419272260ab115f074556a02a638a007b47',
      '849a17bd4a45ff7047028a19c365804d3266f28159050985f7f988c655e83cf9',
      'd3146810ce5693632d2789637836af516befafe7ec708149dc1653abfe53c51c',
      'd241af38f8059442abc9a9d2935ca310a35ed61b964d69a52678562f504f1908',
      '52f32acc03f50846d72cd8a446e2c700171a6684fc518d2abafd0be31a646c3b',
      '99c62b4a155912dbf09273f0535b619eca915840dd80c208312bcea1e8b305f7',
      'd9248919f83d7833a52632d3c17e91210eca772ad194aa153a222bb7cedffa05',
      'fa951c8b4fc1c059efced9260790a33d5c1a02e19faef8d9dccd022b9281281b',
      '7e4492ded13ed9bc32861a6b0f07f681247b96f7c6145e782294a03f39367660',
      '5438eb6af0f41967872476a44b297cdeba352cbbf0ce75e5aa8e12ed5001260e',
      '5e39b784fddaa6d68d3d131da08ec57672d0dbc06e6d89b337afda8244bb003d',
      'dc075b1fd389dff5651f67bae2acb825a4282f322d0d44754c0a85d49c412ae9',
      'd6f0f45e1edeb273e5decccac2ba0c9e80f4cd902b426d4152e67194a4e6a8e9',
      'f2cd4382768433f4536ce86e90d8e16e9d173d810e1700563d409b4cc07f7bdc',
      'cddca8322cb86b3db7a80d666b6b45b559567aa55d071876d351a846932040c7',
      'a0ae2260073866aee367a894aa08a6b843bb607ae2a5b56b91d8bffebaa10a8d',
      '3e7f7be65ca6bdd2f5975c24ae909838abd3924b97677c236f070edbe998dc2d',
      '46dede87e2d043ce543e975411bb27679b64f4356fe5cac4bdbc04b3b3740ef0',
      'e0cd05e77c32eab024b03dd43833b1f11f711ba21391b991fcb95556641caa3f',
      'c04c211a9169d5bbe191c781e63d42ba41c6f7c19ae5c6120ba7377e2c4bbe15',
      '606d57ccacc4cf59c997cd0568461208a66cefd11c1b7770f698740da1e9cf55',
      '7ae290a56299452c59f72bdd1fcae631f5f7c9c7a4467e4c366200aa69049911',
      '21686746b82f1824d39987f64c6bd23e04b16f4bfa1a675c06a525c1d4434f51',
      '7539e73017f14215a68806b7a0befc5f8f5433bf0122098728c8f6037b7f4309',
      'e2f6b9d0657972915aa6c88fa54e8f90f55d55b115a87e180a05b30d927616ee',
      'c77e1ac1640e85a0778dc7917f731df2c08475ad73af3b2cee93ca47d350fb7d',
      '3b370ee8af41fbec6a39f9b58e93e65ca58a994f35df1e7b3cc821f62ecb3655',
      '3a5f843a6254336ed15e620cb479c028ddf7f21e6cb75930fb3274ebb75c1b0a',
    ],
  }),
});

/**
 * เขียน snapshot K2 ที่ผ่าน Provider/checkpoint proof แล้วเข้า Customer Lark ทีละ bounded batch.
 * Fingerprint manifest ทำให้ Queue รับเฉพาะ payload ชุดที่ตรวจแล้ว ไม่ใช่ generic Lark writer.
 */
export async function importCustomerMetaK2LarkSnapshot(input = {}) {
  const body = requireObject(input.body, 'body');
  const repository = requireObject(input.repository, 'repository');
  const syncEngine = requireMethods(input.syncEngine, ['planByKey', 'executePlan'], 'syncEngine');
  const tables = requireObject(input.tables, 'tables');
  const fingerprint = input.createFingerprint ?? createStableFingerprint;

  requireExact(body.snapshotId, CUSTOMER_META_K2_SNAPSHOT_ID, 'snapshotId');
  requireExact(body.sourceAccountId, CUSTOMER_META_K2_SOURCE_ACCOUNT_ID, 'sourceAccountId');
  const tableKey = requireText(body.tableKey, 'tableKey');
  const contract = TABLE_CONTRACTS[tableKey];
  if (!contract) throw invalid('Customer Meta K2 snapshot table is outside the exact allowlist', { tableKey });

  const batchIndex = boundedInteger(body.batchIndex, 'batchIndex', 0, contract.batchCount - 1);
  requireExactInteger(body.batchCount, contract.batchCount, 'batchCount');
  requireExactInteger(body.totalRows, contract.totalRows, 'totalRows');
  const rows = requireArray(body.rows, 'rows');
  const expectedRows = batchIndex === contract.batchCount - 1
    ? contract.totalRows - (batchIndex * CUSTOMER_META_K2_BATCH_SIZE)
    : CUSTOMER_META_K2_BATCH_SIZE;
  requireExactInteger(rows.length, expectedRows, 'rows.length');
  if (JSON.stringify(rows).length > 64 * 1024) {
    throw invalid('Customer Meta K2 snapshot batch exceeds the payload ceiling', { tableKey, batchIndex });
  }
  validateRows(rows, contract, tableKey);

  const expectedFingerprint = contract.batchFingerprints[batchIndex];
  requireExact(body.batchFingerprint, expectedFingerprint, 'batchFingerprint');
  const observedFingerprint = await fingerprint(rows);
  requireExact(observedFingerprint, expectedFingerprint, 'observedFingerprint');

  const tableId = requireText(tables[tableKey], `tables.${tableKey}`);
  const plan = await syncEngine.planByKey({
    repository,
    tableId,
    keyField: contract.keyField,
    rows,
  });
  if (Number(plan?.duplicateInputRows ?? 0) !== 0) {
    throw invalid('Customer Meta K2 snapshot contains duplicate stable keys', { tableKey, batchIndex });
  }
  const result = await syncEngine.executePlan(plan);
  const reconciliation = normalizeResult(result, rows.length, tableKey, batchIndex);
  return Object.freeze({
    ok: true,
    mode: 'customer_meta_k2_exact_snapshot_import',
    operationId: body.operationId ?? null,
    sourceSummary: Object.freeze({
      snapshotId: CUSTOMER_META_K2_SNAPSHOT_ID,
      sourceAccountId: CUSTOMER_META_K2_SOURCE_ACCOUNT_ID,
      period: PERIOD,
      tableKey,
      batchIndex,
      batchCount: contract.batchCount,
      totalRows: contract.totalRows,
      batchRows: rows.length,
      batchFingerprint: expectedFingerprint,
    }),
    reconciliation: Object.freeze([reconciliation]),
  });
}

export function listCustomerMetaK2LarkImportContracts() {
  return TABLE_CONTRACTS;
}

/** ใช้ projection เดียวกับ reviewed Dev seed ก่อนแบ่ง batch และคำนวณ fingerprint. */
export function projectCustomerMetaK2RowsForLark(tableKey, rowsInput) {
  const rows = requireArray(rowsInput, 'rows');
  if (tableKey !== 'mktAdsDaily') return Object.freeze([...rows]);
  return Object.freeze(rows.map((row) => {
    if (!Object.hasOwn(row, 'ad_channel')
      || row.ad_channel === 'facebook_ads'
      || row.ad_channel === 'instagram_ads') return row;
    const projected = { ...row };
    delete projected.ad_channel;
    return Object.freeze(projected);
  }));
}

function validateRows(rows, contract, tableKey) {
  const allowedFields = new Set(contract.fields);
  const keys = new Set();
  for (const row of rows) {
    requireObject(row, `${tableKey} row`);
    for (const fieldName of Object.keys(row)) {
      if (!allowedFields.has(fieldName)) {
        throw invalid('Customer Meta K2 snapshot row contains a field outside the allowlist', {
          tableKey,
          fieldName,
        });
      }
    }
    for (const fieldName of [...COMMON_REQUIRED_FIELDS, contract.keyField]) {
      requireText(row[fieldName], `${tableKey}.${fieldName}`);
    }
    requireExact(row.account_id, CUSTOMER_META_K2_SOURCE_ACCOUNT_ID, 'row.account_id');
    requireExact(row.platform, 'meta_ads', 'row.platform');
    const stableKey = requireText(row[contract.keyField], contract.keyField);
    if (keys.has(stableKey)) throw invalid('Customer Meta K2 snapshot batch repeats a stable key', { tableKey });
    keys.add(stableKey);

    if (tableKey === 'mktAdsCreatives') {
      const creativeId = requireText(row.external_creative_id, 'external_creative_id');
      requireExact(
        stableKey,
        `meta_ads:${CUSTOMER_META_K2_SOURCE_ACCOUNT_ID}:creative:${creativeId}`,
        contract.keyField,
      );
    } else {
      const stableKeyMatch = DAILY_STABLE_KEY_PATTERN.exec(stableKey);
      if (!stableKeyMatch) {
        throw invalid('Customer Meta K2 Daily row has an invalid stable key', { stableKey });
      }
      const [, stableExternalEntityId, metricDate] = stableKeyMatch;
      if (metricDate < PERIOD.since || metricDate > PERIOD.until) {
        throw invalid('Customer Meta K2 Daily row escapes the reviewed period', { metricDate });
      }
      requireExact(row.entity_type, 'ad', 'row.entity_type');
      const externalEntityId = requireText(row.external_entity_id, 'external_entity_id');
      requireExact(externalEntityId, stableExternalEntityId, 'row.external_entity_id');
      const expectedMetricDate = dateOnlyInTimeZoneToEpochMilliseconds(
        metricDate,
        SOURCE_TIME_ZONE,
        { label: 'Customer Meta K2 metric date' },
      );
      if (typeof row.metric_date !== 'number' || !Number.isSafeInteger(row.metric_date)) {
        throw invalid('Customer Meta K2 Daily metric_date must be epoch milliseconds');
      }
      requireExact(row.metric_date, expectedMetricDate, 'row.metric_date');
    }
  }
}

function normalizeResult(result, expected, tableKey, batchIndex) {
  const created = nonNegativeInteger(result?.created ?? 0, 'created');
  const updated = nonNegativeInteger(result?.updated ?? 0, 'updated');
  const skipped = nonNegativeInteger(result?.skipped ?? 0, 'skipped');
  const duplicateInputRows = nonNegativeInteger(
    result?.duplicateInputRows ?? 0,
    'duplicateInputRows',
  );
  if (created + updated + skipped !== expected || duplicateInputRows !== 0) {
    throw invalid('Customer Meta K2 Lark batch reconciliation is incomplete', {
      tableKey,
      batchIndex,
      expected,
      created,
      updated,
      skipped,
      duplicateInputRows,
    });
  }
  return Object.freeze({
    tableKey,
    batchIndex,
    expected,
    created,
    updated,
    skipped,
    duplicateInputRows,
  });
}

function freezeTableContract(input) {
  const totalRows = input.totalRows;
  const batchCount = Math.ceil(totalRows / CUSTOMER_META_K2_BATCH_SIZE);
  if (input.batchFingerprints.length !== batchCount) throw new Error('Invalid Meta K2 manifest');
  return Object.freeze({
    keyField: input.keyField,
    totalRows,
    batchCount,
    fields: Object.freeze([...input.fields]),
    batchFingerprints: Object.freeze([...input.batchFingerprints]),
  });
}

function requireMethods(value, methods, fieldName) {
  const object = requireObject(value, fieldName);
  for (const method of methods) {
    if (typeof object[method] !== 'function') throw new TypeError(`${fieldName}.${method} is required`);
  }
  return object;
}

function requireObject(value, fieldName) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${fieldName} must be an object`);
  }
  return value;
}

function requireArray(value, fieldName) {
  if (!Array.isArray(value)) throw new TypeError(`${fieldName} must be an array`);
  return value;
}

function requireText(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') throw invalid(`${fieldName} is required`);
  return value.trim();
}

function requireExact(value, expected, fieldName) {
  if (value !== expected) throw invalid(`Customer Meta K2 snapshot requires exact ${fieldName}`, { fieldName });
}

function requireExactInteger(value, expected, fieldName) {
  if (Number(value) !== expected || !Number.isSafeInteger(Number(value))) {
    throw invalid(`Customer Meta K2 snapshot requires exact ${fieldName}`, { fieldName });
  }
}

function boundedInteger(value, fieldName, minimum, maximum) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < minimum || number > maximum) {
    throw invalid(`Customer Meta K2 snapshot has invalid ${fieldName}`, { fieldName });
  }
  return number;
}

function nonNegativeInteger(value, fieldName) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0) throw invalid(`Invalid ${fieldName}`);
  return number;
}

function invalid(message, details = {}) {
  return permanentError(message, {
    code: 'CUSTOMER_META_K2_LARK_IMPORT_INVALID',
    details,
  });
}
