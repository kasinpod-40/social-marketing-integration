import {
  bitable,
  FieldType,
  FilterConjunction,
  FilterDuration,
  FilterOperator,
} from '/lark-base-js-sdk.mjs';

void fetch('/client-event?stage=browser-module-loaded', { cache: 'no-store' }).catch(() => {});

const REQUIRED_TARGET_ANCHORS = Object.freeze([
  '🎵 RAW_TikTok_Creator_Videos',
  '(VDO) Content Creator',
  '(Graphic) Content Creator',
  'คำถามจาก Sale & Support',
]);
const TARGET_TABLE = '📈 MKT_Ads_Daily';
const TARGET_VIEW = '📈 Google Ads Daily 30D';
const PLATFORM_FIELD = 'platform';
const DATE_FIELD = 'metric_date';
const PLATFORM_OPTION = 'google_ads';

const card = document.querySelector('.card');
if (card) {
  card.innerHTML = `
    <strong>งานที่เหลือ: Dynamic Date Filter 30D เพียงจุดเดียว</strong>
    <p><code>📈 MKT_Ads_Daily → 📈 Google Ads Daily 30D</code></p>
    <p>ต้องเป็น AND: <code>platform is google_ads</code> + <code>metric_date is TheLastMonth</code></p>
    <p class="warn">Sort / Group / Hidden ผ่านแล้วและ runner นี้จะไม่เรียก API เหล่านั้นอีก</p>
    <button id="apply">ตั้ง Dynamic Date Filter</button>
    <button id="inspect">ตรวจ Filter อย่างเดียว</button>
  `;
}

const output = document.querySelector('#output');
const status = document.querySelector('#status');
const applyButton = document.querySelector('#apply');
const inspectButton = document.querySelector('#inspect');

let planPromise = null;

if (status) status.textContent = 'พร้อมตรวจ Dynamic Date Filter 30D';
inspectButton?.addEventListener('click', () => run({ execute: false }));
applyButton?.addEventListener('click', () => run({ execute: true }));

async function run({ execute }) {
  setBusy(true);
  clearOutput();
  try {
    const plan = await loadPlan();
    setStatus(execute ? 'กำลัง preflight Dynamic Date Filter…' : 'กำลังตรวจ Dynamic Date Filter…');
    const context = await preflight(plan);
    const before = await inspectFilter(context);
    let mutationApplied = false;

    if (execute && !sameJson(before.semantic, expectedSemanticFilter())) {
      if (!before.empty) {
        throw codedError(
          'DYNAMIC_DATE_FILTER_EXISTING_STATE_CONFLICT',
          `${TARGET_TABLE}.${TARGET_VIEW} already contains a non-empty filter that differs from Source; refusing to overwrite it`,
        );
      }

      setStatus('Preflight ผ่าน กำลังตั้ง TheLastMonth…');
      await requireMutation(context.view.addFilterCondition([
        {
          fieldId: context.platformFieldId,
          fieldType: FieldType.SingleSelect,
          operator: FilterOperator.Is,
          value: context.googleAdsOptionId,
        },
        {
          fieldId: context.dateFieldId,
          fieldType: FieldType.DateTime,
          operator: FilterOperator.Is,
          value: FilterDuration.TheLastMonth,
        },
      ]), `addFilterCondition ${TARGET_TABLE}.${TARGET_VIEW}`);
      await requireMutation(
        context.view.setFilterConjunction(FilterConjunction.And),
        `setFilterConjunction ${TARGET_TABLE}.${TARGET_VIEW}`,
      );
      await context.view.applySetting();
      mutationApplied = true;
    }

    setStatus('กำลังตรวจ readback Dynamic Date Filter…');
    const after = await inspectFilter(context);
    const ok = sameJson(after.semantic, expectedSemanticFilter());
    const summary = {
      ok,
      stage: 'customer-base-dynamic-date-filter-parity',
      status: ok ? 'DYNAMIC_DATE_FILTER_PASS' : 'FAIL',
      mode: execute ? 'base-js-sdk-write-and-readback' : 'base-js-sdk-read-only',
      target: {
        tableName: TARGET_TABLE,
        viewName: TARGET_VIEW,
      },
      expected: expectedSemanticFilter(),
      before: before.semantic,
      after: after.semantic,
      mutationApplied,
      viewMutationCount: mutationApplied ? 1 : 0,
      tableMutationCount: 0,
      fieldMutationCount: 0,
      recordMutationCount: 0,
    };
    printSummary(summary);
    setStatus(ok
      ? (mutationApplied ? 'Dynamic Date Filter 30D ผ่านแล้ว' : 'Dynamic Date Filter 30D ตรงอยู่แล้ว')
      : 'Dynamic Date Filter 30D ยังไม่ตรง Source');
  } catch (error) {
    const summary = {
      ok: false,
      stage: 'customer-base-dynamic-date-filter-parity',
      status: 'ERROR',
      code: error?.code ?? 'CUSTOMER_BASE_DYNAMIC_DATE_FILTER_FAILED',
      message: error?.message ?? String(error),
      tableMutationCount: 0,
      fieldMutationCount: 0,
      recordMutationCount: 0,
    };
    printSummary(summary);
    setStatus('หยุดแบบ fail-closed');
  } finally {
    setBusy(false);
  }
}

async function loadPlan() {
  if (!planPromise) {
    planPromise = fetch('/plan.json', { cache: 'no-store' })
      .then(async (response) => {
        if (!response.ok) throw codedError('VIEW_UI_PLAN_FETCH_FAILED', `plan.json HTTP ${response.status}`);
        return response.json();
      })
      .then((plan) => {
        if (plan?.contractVersion !== 'customer_base_view_js_sdk_parity_plan_v1') {
          throw codedError('VIEW_UI_PLAN_CONTRACT_MISMATCH', 'Unexpected View UI plan contract');
        }
        if (plan?.summary?.tableCount !== 32 || plan?.summary?.viewCount !== 110) {
          throw codedError('VIEW_UI_PLAN_SCOPE_MISMATCH', 'View UI plan must contain exactly 32 Tables / 110 Views');
        }
        return plan;
      });
  }
  return planPromise;
}

async function preflight(plan) {
  const base = bitable.base;
  if (!await base.isEditable()) {
    throw codedError('VIEW_UI_TARGET_NOT_EDITABLE', 'Current Base is not editable by this user');
  }

  const tableMetas = await base.getTableMetaList();
  const tableMetaByName = uniqueByName(tableMetas, 'Target table');
  for (const anchor of REQUIRED_TARGET_ANCHORS) {
    if (!tableMetaByName.has(anchor)) {
      throw codedError('VIEW_UI_TARGET_IDENTITY_MISMATCH', `Target identity anchor is missing: ${anchor}`);
    }
  }

  const planTableNames = new Set(plan.tables.map((table) => table.tableName));
  if (planTableNames.size !== 32) {
    throw codedError('VIEW_UI_PLAN_TABLE_NAMES_INVALID', 'Plan Table names must be unique');
  }
  for (const tableName of planTableNames) {
    if (!tableMetaByName.has(tableName)) {
      throw codedError('VIEW_UI_TARGET_CLONE_TABLE_MISSING', `Target clone Table is missing: ${tableName}`);
    }
  }

  const table = await base.getTableByName(TARGET_TABLE);
  const fieldMetas = await table.getFieldMetaList();
  const fieldByName = uniqueByName(fieldMetas, `Field in ${TARGET_TABLE}`);
  const platformMeta = fieldByName.get(PLATFORM_FIELD);
  const dateMeta = fieldByName.get(DATE_FIELD);
  requireFieldType(platformMeta, FieldType.SingleSelect, `${TARGET_TABLE}.${PLATFORM_FIELD}`);
  requireFieldType(dateMeta, FieldType.DateTime, `${TARGET_TABLE}.${DATE_FIELD}`);

  const platformFieldId = requireId(platformMeta, `${TARGET_TABLE}.${PLATFORM_FIELD}`);
  const dateFieldId = requireId(dateMeta, `${TARGET_TABLE}.${DATE_FIELD}`);
  const googleOptions = (platformMeta?.property?.options ?? [])
    .filter((option) => requireName(option, `${TARGET_TABLE}.${PLATFORM_FIELD} option`) === PLATFORM_OPTION);
  if (googleOptions.length !== 1) {
    throw codedError(
      'DYNAMIC_DATE_FILTER_PLATFORM_OPTION_MISMATCH',
      `${TARGET_TABLE}.${PLATFORM_FIELD} must contain exactly one ${PLATFORM_OPTION} option`,
    );
  }
  const googleAdsOptionId = requireId(googleOptions[0], `${TARGET_TABLE}.${PLATFORM_FIELD}.${PLATFORM_OPTION}`);

  const viewMetas = await table.getViewMetaList();
  const viewByName = uniqueByName(viewMetas, `View in ${TARGET_TABLE}`);
  const viewMeta = viewByName.get(TARGET_VIEW);
  if (!viewMeta) {
    throw codedError('DYNAMIC_DATE_FILTER_VIEW_MISSING', `Target View is missing: ${TARGET_TABLE}.${TARGET_VIEW}`);
  }
  const view = await table.getViewById(requireId(viewMeta, `${TARGET_TABLE}.${TARGET_VIEW}`));
  requireMethods(
    view,
    ['getFilterInfo', 'addFilterCondition', 'setFilterConjunction', 'applySetting'],
    `${TARGET_TABLE}.${TARGET_VIEW}`,
  );

  return {
    view,
    platformFieldId,
    dateFieldId,
    googleAdsOptionId,
  };
}

async function inspectFilter(context) {
  const raw = await context.view.getFilterInfo();
  const conditions = Array.isArray(raw?.conditions)
    ? raw.conditions.map((condition) => semanticCondition(condition, context)).sort(compareSemanticCondition)
    : [];
  return {
    empty: raw === null || conditions.length === 0,
    semantic: {
      conjunction: raw?.conjunction ?? FilterConjunction.And,
      conditions,
    },
  };
}

function semanticCondition(condition, context) {
  const fieldId = String(condition?.fieldId ?? condition?.field_id ?? '');
  const operator = String(condition?.operator ?? '');
  if (fieldId === context.platformFieldId) {
    return {
      fieldName: PLATFORM_FIELD,
      operator,
      value: semanticPlatformValue(condition?.value, context.googleAdsOptionId),
    };
  }
  if (fieldId === context.dateFieldId) {
    return {
      fieldName: DATE_FIELD,
      operator,
      value: unwrapSingleValue(condition?.value),
    };
  }
  return {
    fieldName: `__unknown_field__:${fieldId}`,
    operator,
    value: condition?.value ?? null,
  };
}

function semanticPlatformValue(value, googleAdsOptionId) {
  const unwrapped = unwrapSingleValue(value);
  if (unwrapped === googleAdsOptionId || unwrapped === PLATFORM_OPTION) return PLATFORM_OPTION;
  return unwrapped;
}

function unwrapSingleValue(value) {
  if (Array.isArray(value) && value.length === 1) return value[0];
  return value ?? null;
}

function expectedSemanticFilter() {
  return {
    conjunction: FilterConjunction.And,
    conditions: [
      { fieldName: DATE_FIELD, operator: FilterOperator.Is, value: FilterDuration.TheLastMonth },
      { fieldName: PLATFORM_FIELD, operator: FilterOperator.Is, value: PLATFORM_OPTION },
    ].sort(compareSemanticCondition),
  };
}

function compareSemanticCondition(left, right) {
  return JSON.stringify(left).localeCompare(JSON.stringify(right));
}

function uniqueByName(items, label) {
  if (!Array.isArray(items)) throw codedError('VIEW_UI_METADATA_INVALID', `${label} list is not an array`);
  const result = new Map();
  for (const item of items) {
    const name = requireName(item, label);
    if (result.has(name)) throw codedError('VIEW_UI_DUPLICATE_NAME', `Duplicate ${label}: ${name}`);
    result.set(name, item);
  }
  return result;
}

function requireName(value, label) {
  const name = typeof value?.name === 'string' ? value.name.trim() : '';
  if (!name) throw codedError('VIEW_UI_METADATA_NAME_MISSING', `${label} name is missing`);
  return name;
}

function requireId(value, label) {
  const id = typeof value?.id === 'string'
    ? value.id.trim()
    : (typeof value?.fieldId === 'string' ? value.fieldId.trim() : '');
  if (!id) throw codedError('VIEW_UI_METADATA_ID_MISSING', `${label} id is missing`);
  return id;
}

function requireFieldType(value, expectedType, label) {
  if (Number(value?.type) !== Number(expectedType)) {
    throw codedError('DYNAMIC_DATE_FILTER_FIELD_TYPE_MISMATCH', `${label} has unexpected field type`);
  }
}

function requireMethods(value, methods, label) {
  for (const method of methods) {
    if (typeof value?.[method] !== 'function') {
      throw codedError('VIEW_UI_SDK_CAPABILITY_MISSING', `Base JS SDK method ${method}() is unavailable for ${label}`);
    }
  }
}

async function requireMutation(resultPromise, label) {
  const result = await resultPromise;
  if (result === false) throw codedError('VIEW_UI_SDK_MUTATION_REJECTED', `${label} returned false`);
  return result;
}

function codedError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function sameJson(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function setBusy(value) {
  if (applyButton) applyButton.disabled = value;
  if (inspectButton) inspectButton.disabled = value;
}

function setStatus(value) {
  if (status) status.textContent = value;
}

function clearOutput() {
  if (output) output.textContent = '';
}

function printSummary(value) {
  const text = `=== COPY THIS SUMMARY JSON ===\n${JSON.stringify(value, null, 2)}`;
  if (output) output.textContent = text;
  console.log(text);
}
