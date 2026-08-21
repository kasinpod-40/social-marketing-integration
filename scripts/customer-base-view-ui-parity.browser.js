import { bitable } from '/lark-base-js-sdk.mjs';

void fetch('/client-event?stage=browser-module-loaded', { cache: 'no-store' }).catch(() => {});

const REQUIRED_TARGET_ANCHORS = Object.freeze([
  '🎵 RAW_TikTok_Creator_Videos',
  '(VDO) Content Creator',
  '(Graphic) Content Creator',
  'คำถามจาก Sale & Support',
]);

const output = document.querySelector('#output');
const status = document.querySelector('#status');
const applyButton = document.querySelector('#apply');
const inspectButton = document.querySelector('#inspect');

let planPromise = null;

inspectButton?.addEventListener('click', () => run({ execute: false }));
applyButton?.addEventListener('click', () => run({ execute: true }));

async function run({ execute }) {
  setBusy(true);
  clearOutput();
  try {
    const plan = await loadPlan();
    setStatus(execute ? 'กำลัง preflight ก่อนจัด View…' : 'กำลังตรวจ View…');
    const context = await preflight(plan);
    if (execute) {
      setStatus('Preflight ผ่าน กำลังจัด sort / group…');
      await applySupportedParity(context);
    }
    setStatus('กำลังตรวจ readback…');
    const verification = await verify(context);
    const summary = buildSummary(plan, verification, { execute });
    printSummary(summary);
    setStatus(summary.ok
      ? (execute ? 'Sort / Group parity ผ่านแล้ว' : 'ตรวจผ่าน')
      : 'ยังมี Sort / Group parity ที่ต้องจัด/ตรวจต่อ');
  } catch (error) {
    const summary = {
      ok: false,
      stage: 'customer-base-view-ui-parity',
      status: 'ERROR',
      code: error?.code ?? 'CUSTOMER_BASE_VIEW_UI_PARITY_FAILED',
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
  if (planTableNames.size !== 32) throw codedError('VIEW_UI_PLAN_TABLE_NAMES_INVALID', 'Plan Table names must be unique');
  for (const tableName of planTableNames) {
    if (!tableMetaByName.has(tableName)) {
      throw codedError('VIEW_UI_TARGET_CLONE_TABLE_MISSING', `Target clone Table is missing: ${tableName}`);
    }
  }

  const tables = [];
  for (const tablePlan of plan.tables) {
    const table = await base.getTableByName(tablePlan.tableName);
    const fieldMetas = await table.getFieldMetaList();
    const fieldByName = uniqueByName(fieldMetas, `Field in ${tablePlan.tableName}`);
    const viewMetas = await table.getViewMetaList();
    const viewByName = uniqueByName(viewMetas, `View in ${tablePlan.tableName}`);
    const views = [];

    for (const viewPlan of tablePlan.views) {
      const viewMeta = viewByName.get(viewPlan.viewName);
      if (!viewMeta) {
        throw codedError('VIEW_UI_TARGET_VIEW_MISSING', `Target View is missing: ${tablePlan.tableName}.${viewPlan.viewName}`);
      }
      const view = await table.getViewById(requireId(viewMeta, `View ${tablePlan.tableName}.${viewPlan.viewName}`));
      requireMethods(view, ['getFieldMetaList', 'getVisibleFieldIdList', 'getSortInfo', 'deleteSort', 'addSort', 'applySetting'], `${tablePlan.tableName}.${viewPlan.viewName}`);
      if ((viewPlan.mutate?.group ?? []).length > 0 || typeof view.getGroupInfo === 'function') {
        requireMethods(view, ['getGroupInfo', 'deleteGroup', 'addGroup'], `${tablePlan.tableName}.${viewPlan.viewName}`);
      }

      const referencedFieldNames = new Set([
        ...(viewPlan.verifyOnly?.fieldOrder ?? []),
        ...(viewPlan.verifyOnly?.hiddenFieldNames ?? []),
        ...(viewPlan.mutate?.sort ?? []).map((item) => item.fieldName),
        ...(viewPlan.mutate?.group ?? []).map((item) => item.fieldName),
      ]);
      for (const fieldName of referencedFieldNames) {
        if (!fieldByName.has(fieldName)) {
          throw codedError('VIEW_UI_TARGET_FIELD_MISSING', `Target Field is missing: ${tablePlan.tableName}.${fieldName}`);
        }
      }

      const expectedHiddenIds = new Set((viewPlan.verifyOnly?.hiddenFieldNames ?? [])
        .map((name) => requireId(fieldByName.get(name), `${tablePlan.tableName}.${name}`)));
      const allFieldIds = fieldMetas.map((meta) => requireId(meta, `${tablePlan.tableName} field`));
      const expectedVisibleIds = allFieldIds.filter((id) => !expectedHiddenIds.has(id)).sort();
      const actualVisibleIds = [...await view.getVisibleFieldIdList()].sort();
      if (!sameJson(expectedVisibleIds, actualVisibleIds)) {
        throw codedError(
          'VIEW_UI_AUTOMATIC_HIDDEN_STATE_DRIFT',
          `Hidden-field state changed after automatic PASS: ${tablePlan.tableName}.${viewPlan.viewName}`,
        );
      }

      views.push({
        tableName: tablePlan.tableName,
        viewName: viewPlan.viewName,
        view,
        fieldByName,
        plan: viewPlan,
      });
    }
    tables.push({ tableName: tablePlan.tableName, views });
  }

  return { plan, tables };
}

async function applySupportedParity(context) {
  for (const table of context.tables) {
    setStatus(`กำลังจัด ${table.tableName}…`);
    for (const item of table.views) {
      let needsApplySetting = false;
      const expectedSort = remapRules(item.plan.mutate?.sort ?? [], item.fieldByName, item.tableName);
      const currentSort = normalizeSdkRules(await item.view.getSortInfo());
      if (!sameJson(currentSort, expectedSort)) {
        for (const rule of await item.view.getSortInfo()) {
          await requireMutation(item.view.deleteSort(rule), `deleteSort ${item.tableName}.${item.viewName}`);
        }
        if (expectedSort.length > 0) {
          await requireMutation(item.view.addSort(expectedSort), `addSort ${item.tableName}.${item.viewName}`);
        }
        needsApplySetting = true;
      }

      if (typeof item.view.getGroupInfo === 'function') {
        const expectedGroup = remapRules(item.plan.mutate?.group ?? [], item.fieldByName, item.tableName);
        const currentGroup = normalizeSdkRules(await item.view.getGroupInfo());
        if (!sameJson(currentGroup, expectedGroup)) {
          for (const rule of await item.view.getGroupInfo()) {
            await requireMutation(item.view.deleteGroup(rule), `deleteGroup ${item.tableName}.${item.viewName}`);
          }
          if (expectedGroup.length > 0) {
            await requireMutation(item.view.addGroup(expectedGroup), `addGroup ${item.tableName}.${item.viewName}`);
          }
          needsApplySetting = true;
        }
      } else if ((item.plan.mutate?.group ?? []).length > 0) {
        throw codedError('VIEW_UI_GROUP_CAPABILITY_MISSING', `Group API missing: ${item.tableName}.${item.viewName}`);
      }

      if (needsApplySetting) {
        await requireMutation(item.view.applySetting(), `applySetting ${item.tableName}.${item.viewName}`);
      }
    }
  }
}

async function verify(context) {
  const mismatches = [];
  let fieldOrderMismatchViews = 0;
  let hiddenMismatchViews = 0;
  let sortMismatchViews = 0;
  let groupMismatchViews = 0;

  for (const table of context.tables) {
    for (const item of table.views) {
      const viewFieldMetas = await item.view.getFieldMetaList();
      const actualFieldOrder = viewFieldMetas.map((meta) => requireName(meta, `${item.tableName}.${item.viewName} field`));
      const expectedFieldOrder = item.plan.verifyOnly?.fieldOrder ?? [];
      if (expectedFieldOrder.length > 0 && !sameJson(actualFieldOrder, expectedFieldOrder)) {
        fieldOrderMismatchViews += 1;
        mismatches.push({ dimension: 'fieldOrder', tableName: item.tableName, viewName: item.viewName });
      }

      const viewFieldByName = uniqueByName(viewFieldMetas, `View field in ${item.tableName}.${item.viewName}`);
      const expectedHiddenIds = new Set((item.plan.verifyOnly?.hiddenFieldNames ?? [])
        .map((name) => requireId(viewFieldByName.get(name), `${item.tableName}.${name}`)));
      const expectedVisibleIds = viewFieldMetas
        .map((meta) => requireId(meta, `${item.tableName} field`))
        .filter((id) => !expectedHiddenIds.has(id))
        .sort();
      const actualVisibleIds = [...await item.view.getVisibleFieldIdList()].sort();
      if (!sameJson(expectedVisibleIds, actualVisibleIds)) {
        hiddenMismatchViews += 1;
        mismatches.push({ dimension: 'hiddenFields', tableName: item.tableName, viewName: item.viewName });
      }

      const expectedSort = remapRules(item.plan.mutate?.sort ?? [], viewFieldByName, item.tableName);
      const actualSort = normalizeSdkRules(await item.view.getSortInfo());
      if (!sameJson(actualSort, expectedSort)) {
        sortMismatchViews += 1;
        mismatches.push({ dimension: 'sort', tableName: item.tableName, viewName: item.viewName });
      }

      if (typeof item.view.getGroupInfo === 'function') {
        const expectedGroup = remapRules(item.plan.mutate?.group ?? [], viewFieldByName, item.tableName);
        const actualGroup = normalizeSdkRules(await item.view.getGroupInfo());
        if (!sameJson(actualGroup, expectedGroup)) {
          groupMismatchViews += 1;
          mismatches.push({ dimension: 'group', tableName: item.tableName, viewName: item.viewName });
        }
      }
    }
  }

  return {
    fieldOrderMismatchViews,
    hiddenMismatchViews,
    sortMismatchViews,
    groupMismatchViews,
    mismatchPreview: mismatches.slice(0, 10),
  };
}

function buildSummary(plan, verification, { execute }) {
  const supportedOk = verification.hiddenMismatchViews === 0
    && verification.sortMismatchViews === 0
    && verification.groupMismatchViews === 0;
  return {
    ok: supportedOk,
    stage: 'customer-base-view-ui-parity',
    status: supportedOk ? 'SUPPORTED_UI_PASS' : 'FAIL',
    mode: execute ? 'base-js-sdk-write-and-readback' : 'base-js-sdk-read-only',
    supportedUi: {
      hiddenVerifyMismatchViews: verification.hiddenMismatchViews,
      sortMismatchViews: verification.sortMismatchViews,
      groupMismatchViews: verification.groupMismatchViews,
    },
    ignoredCosmetic: {
      columnWidthViews: plan.summary.columnWidthViews,
      columnWidthAssignments: plan.summary.columnWidthAssignments,
      rowHeightViews: plan.summary.rowHeightViews,
      reason: 'non-authoritative presentation only',
    },
    remainingManual: {
      fieldOrderMismatchViews: verification.fieldOrderMismatchViews,
      frozenColumnViews: plan.summary.frozenColumnManualViews,
    },
    mismatchPreview: verification.mismatchPreview,
    tableMutationCount: 0,
    fieldMutationCount: 0,
    recordMutationCount: 0,
  };
}

function remapRules(rules, fieldByName, tableName) {
  return rules.map((rule) => ({
    fieldId: requireId(fieldByName.get(rule.fieldName), `${tableName}.${rule.fieldName}`),
    desc: Boolean(rule.desc),
  }));
}

function normalizeSdkRules(value) {
  if (!Array.isArray(value)) return [];
  return value.map((rule) => ({
    fieldId: String(rule?.fieldId ?? rule?.field_id ?? ''),
    desc: Boolean(rule?.desc ?? rule?.isDesc ?? false),
  }));
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
