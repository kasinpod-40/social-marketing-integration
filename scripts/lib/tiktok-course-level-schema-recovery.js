const SELECT_FIELD_TYPES = new Set([3, 4]);
const TEXT_FIELD_TYPE = 1;
const COURSE_LEVEL_FIELD = 'course_level';
const REQUIRED_COURSE_LEVEL_OPTION = 'ม.3';

export const TIKTOK_COURSE_LEVEL_RECOVERY_CONFIRMATION = Object.freeze({
  envName: 'CONFIRM_TIKTOK_COURSE_LEVEL_RECOVERY',
  value: 'APPLY_TIKTOK_COURSE_LEVEL_SCHEMA_AND_REDRIVE',
});

export const TIKTOK_COURSE_LEVEL_RECOVERY_INCIDENT = Object.freeze({
  admissionKey: 'tiktok-admission:f7f64c1a8c690376bf9f0fe2c89047666823261999a4dfe71a63bc1ecd1dc4dc',
  workKey: 'tiktok:watermark:f7f64c1a8c690376bf9f0fe2c89047666823261999a4dfe71a63bc1ecd1dc4dc',
  generation: 1785205275171,
  sourceWatermark: 'cdce99372e28f6a5f28702b63cec222cebac39832b483c7781be86a092c3707d',
  metricDate: '2026-07-27',
  sourceRecordCount: 2024,
  syncRunId: 'tiktok-post-lark:watermark:f7f64c1a8c690376bf9f0fe2c89047666823261999a4dfe71a63bc1ecd1dc4dc',
  errorCode: 'LARK_PREFLIGHT_FAILED',
  fieldName: COURSE_LEVEL_FIELD,
  optionName: REQUIRED_COURSE_LEVEL_OPTION,
});

/**
 * วางแผนเติม Select options จาก Dictionary แบบ additive เท่านั้น
 * โดยรักษา option id/color/name เดิมทั้งหมด เพราะ Lark Field Update เป็น full option replacement.
 */
export function buildTikTokClassificationSelectOptionPlan(input = {}) {
  const fields = requireArray(input.fields, 'fields');
  const rules = requireArray(input.rules, 'rules');
  const fieldsByName = indexFields(fields);
  const outputsByField = collectRuleOutputs(rules);
  const actions = [];

  for (const [fieldName, outputValues] of outputsByField) {
    const field = fieldsByName.get(fieldName);
    if (!field) {
      throw recoveryError(
        `TikTok classification destination field is missing: ${fieldName}`,
        'TIKTOK_COURSE_LEVEL_SCHEMA_FIELD_MISSING',
        { fieldName },
      );
    }

    const type = requirePositiveInteger(field.type, `${fieldName}.type`);
    if (type === TEXT_FIELD_TYPE) continue;
    if (!SELECT_FIELD_TYPES.has(type)) {
      throw recoveryError(
        `TikTok classification field has unsupported destination type: ${fieldName}`,
        'TIKTOK_COURSE_LEVEL_SCHEMA_FIELD_TYPE_INVALID',
        { fieldName, type },
      );
    }

    const existingOptions = normalizeExistingOptions(field, fieldName);
    const existingNames = new Set(existingOptions.map((option) => option.name));
    const missingOptions = outputValues.filter((value) => !existingNames.has(value));
    if (missingOptions.length === 0) continue;

    actions.push(Object.freeze({
      action: 'update_select_options',
      fieldId: requireText(field.fieldId, `${fieldName}.fieldId`),
      fieldName,
      type,
      uiType: optionalText(field.uiType),
      description: optionalText(field.description),
      missingOptions: Object.freeze([...missingOptions]),
      field: Object.freeze({
        fieldName,
        type,
        ...(optionalText(field.uiType) ? { uiType: field.uiType.trim() } : {}),
        ...(optionalText(field.description) ? { description: field.description.trim() } : {}),
        property: Object.freeze({
          ...(isPlainObject(field.property) ? structuredClone(field.property) : {}),
          options: Object.freeze([
            ...existingOptions.map((option) => Object.freeze(structuredClone(option))),
            ...missingOptions.map((name) => Object.freeze({ name })),
          ]),
        }),
      }),
    }));
  }

  const courseLevel = fieldsByName.get(COURSE_LEVEL_FIELD);
  if (!courseLevel || Number(courseLevel.type) !== 4) {
    throw recoveryError(
      'MKT_Content.course_level must remain a MultiSelect field',
      'TIKTOK_COURSE_LEVEL_SCHEMA_FIELD_TYPE_INVALID',
      { fieldName: COURSE_LEVEL_FIELD, type: courseLevel?.type ?? null },
    );
  }
  const requiredCourseLevels = outputsByField.get(COURSE_LEVEL_FIELD) ?? [];
  if (!requiredCourseLevels.includes(REQUIRED_COURSE_LEVEL_OPTION)) {
    throw recoveryError(
      'Active TikTok Organic Dictionary no longer contains the incident course_level output',
      'TIKTOK_COURSE_LEVEL_DICTIONARY_INCIDENT_RULE_MISSING',
      { fieldName: COURSE_LEVEL_FIELD },
    );
  }

  const courseLevelAction = actions.find((action) => action.fieldName === COURSE_LEVEL_FIELD);
  const finalCourseLevelNames = courseLevelAction
    ? courseLevelAction.field.property.options.map((option) => option.name)
    : normalizeExistingOptions(courseLevel, COURSE_LEVEL_FIELD).map((option) => option.name);
  if (!finalCourseLevelNames.includes(REQUIRED_COURSE_LEVEL_OPTION)) {
    throw recoveryError(
      'TikTok course_level recovery plan did not materialize the required option',
      'TIKTOK_COURSE_LEVEL_SCHEMA_PLAN_INVALID',
      { fieldName: COURSE_LEVEL_FIELD },
    );
  }

  return Object.freeze({
    alreadyReady: actions.length === 0,
    actionCount: actions.length,
    actions: Object.freeze(actions),
    requiredCourseLevelOption: REQUIRED_COURSE_LEVEL_OPTION,
    affectedFields: Object.freeze(actions.map((action) => action.fieldName)),
    missingOptions: Object.freeze(actions.flatMap((action) => (
      action.missingOptions.map((optionName) => Object.freeze({
        fieldName: action.fieldName,
        optionName,
      }))
    ))),
  });
}

export function buildTikTokCourseLevelIncidentReadSql(input = {}) {
  const incident = normalizeIncident(input.incident ?? TIKTOK_COURSE_LEVEL_RECOVERY_INCIDENT);
  const checkedAt = requireNonNegativeInteger(input.checkedAt ?? Date.now(), 'checkedAt');
  return compactSql(`
    SELECT
      a.admission_key,
      a.work_key,
      a.generation,
      a.source_watermark,
      a.metric_date,
      a.source_record_count,
      a.status AS admission_status,
      a.sync_run_id,
      a.error_code AS admission_error_code,
      r.status AS sync_status,
      r.error_code AS sync_error_code,
      r.records_written,
      w.generation AS work_generation,
      w.lifecycle_status AS work_lifecycle_status,
      (SELECT COUNT(*) FROM sync_generation_fences AS f
        WHERE f.work_key = a.work_key AND f.generation = a.generation) AS matching_fence_count,
      (SELECT COUNT(*) FROM sync_locks AS l
        WHERE l.owner_id = a.sync_run_id AND l.expires_at > ${checkedAt}) AS active_lock_count
    FROM tiktok_source_admissions AS a
    LEFT JOIN sync_runs AS r ON r.sync_run_id = a.sync_run_id
    LEFT JOIN sync_work_runs AS w ON w.work_key = a.work_key
    WHERE a.admission_key = '${sqlText(incident.admissionKey)}'
    LIMIT 1;
  `);
}

export function buildTikTokCourseLevelIncidentResetSql(input = {}) {
  const incident = normalizeIncident(input.incident ?? TIKTOK_COURSE_LEVEL_RECOVERY_INCIDENT);
  const updatedAt = requireNonNegativeInteger(input.updatedAt ?? Date.now(), 'updatedAt');
  return compactSql(`
    UPDATE tiktok_source_admissions
    SET status = 'failed_retryable', error_code = NULL, updated_at = ${updatedAt}
    WHERE admission_key = '${sqlText(incident.admissionKey)}'
      AND work_key = '${sqlText(incident.workKey)}'
      AND generation = ${incident.generation}
      AND source_watermark = '${sqlText(incident.sourceWatermark)}'
      AND metric_date = '${sqlText(incident.metricDate)}'
      AND source_record_count = ${incident.sourceRecordCount}
      AND sync_run_id = '${sqlText(incident.syncRunId)}'
      AND status = 'failed_permanent'
      AND error_code = '${sqlText(incident.errorCode)}'
      AND EXISTS (
        SELECT 1 FROM sync_runs AS r
        WHERE r.sync_run_id = '${sqlText(incident.syncRunId)}'
          AND r.status = 'failed'
          AND r.error_code = '${sqlText(incident.errorCode)}'
          AND r.records_written = 0
      )
      AND EXISTS (
        SELECT 1 FROM sync_work_runs AS w
        WHERE w.work_key = '${sqlText(incident.workKey)}'
          AND w.generation = ${incident.generation}
          AND w.lifecycle_status = 'active'
      )
      AND EXISTS (
        SELECT 1 FROM sync_generation_fences AS f
        WHERE f.work_key = '${sqlText(incident.workKey)}'
          AND f.generation = ${incident.generation}
      )
      AND NOT EXISTS (
        SELECT 1 FROM sync_locks AS l
        WHERE l.owner_id = '${sqlText(incident.syncRunId)}'
          AND l.expires_at > ${updatedAt}
      )
    RETURNING
      admission_key,
      work_key,
      generation,
      source_watermark,
      metric_date,
      source_record_count,
      status AS admission_status,
      sync_run_id,
      error_code AS admission_error_code;
  `);
}

export function validateTikTokCourseLevelIncidentState(row, input = {}) {
  const incident = normalizeIncident(input.incident ?? TIKTOK_COURSE_LEVEL_RECOVERY_INCIDENT);
  const value = requireObject(row, 'incident row');
  const exactPairs = [
    ['admission_key', incident.admissionKey],
    ['work_key', incident.workKey],
    ['generation', incident.generation],
    ['source_watermark', incident.sourceWatermark],
    ['metric_date', incident.metricDate],
    ['source_record_count', incident.sourceRecordCount],
    ['sync_run_id', incident.syncRunId],
  ];
  const mismatch = exactPairs.find(([field, expected]) => normalizeComparable(value[field]) !== expected);
  if (mismatch) {
    throw recoveryError(
      'TikTok recovery incident identity does not match the reviewed operation',
      'TIKTOK_COURSE_LEVEL_INCIDENT_IDENTITY_MISMATCH',
      { fieldName: mismatch[0] },
    );
  }

  const status = requireText(value.admission_status, 'admission_status');
  if (!['failed_permanent', 'failed_retryable'].includes(status)) {
    throw recoveryError(
      'TikTok recovery admission is not in a recoverable state',
      'TIKTOK_COURSE_LEVEL_INCIDENT_STATE_INVALID',
      { admissionStatus: status },
    );
  }
  if (status === 'failed_permanent') {
    if (value.admission_error_code !== incident.errorCode
      || value.sync_status !== 'failed'
      || value.sync_error_code !== incident.errorCode
      || Number(value.records_written) !== 0) {
      throw recoveryError(
        'TikTok failed-permanent evidence is not the reviewed preflight-only incident',
        'TIKTOK_COURSE_LEVEL_INCIDENT_EVIDENCE_INVALID',
      );
    }
  }
  if (Number(value.work_generation) !== incident.generation
    || value.work_lifecycle_status !== 'active'
    || Number(value.matching_fence_count) < 1
    || Number(value.active_lock_count) !== 0) {
    throw recoveryError(
      'TikTok recovery Work/Fence/Lock guards are not satisfied',
      'TIKTOK_COURSE_LEVEL_INCIDENT_GUARD_FAILED',
      {
        workLifecycleStatus: value.work_lifecycle_status ?? null,
        matchingFenceCount: Number(value.matching_fence_count ?? 0),
        activeLockCount: Number(value.active_lock_count ?? 0),
      },
    );
  }
  return Object.freeze({
    status,
    resetRequired: status === 'failed_permanent',
    admissionKey: incident.admissionKey,
    workKey: incident.workKey,
    generation: incident.generation,
  });
}

export function validateTikTokCourseLevelIncidentResetRow(row, input = {}) {
  const incident = normalizeIncident(input.incident ?? TIKTOK_COURSE_LEVEL_RECOVERY_INCIDENT);
  const value = requireObject(row, 'reset row');
  if (value.admission_key !== incident.admissionKey
    || value.work_key !== incident.workKey
    || Number(value.generation) !== incident.generation
    || value.source_watermark !== incident.sourceWatermark
    || value.metric_date !== incident.metricDate
    || Number(value.source_record_count) !== incident.sourceRecordCount
    || value.sync_run_id !== incident.syncRunId
    || value.admission_status !== 'failed_retryable'
    || value.admission_error_code !== null) {
    throw recoveryError(
      'TikTok admission reset result does not match the reviewed exact-redrive contract',
      'TIKTOK_COURSE_LEVEL_INCIDENT_RESET_INVALID',
    );
  }
  return Object.freeze({
    admissionKey: incident.admissionKey,
    status: 'failed_retryable',
    exactRedrivePrepared: true,
  });
}

function collectRuleOutputs(rules) {
  const result = new Map();
  for (const rule of rules) {
    const targetField = requireText(rule?.target_field, 'rule.target_field');
    const outputValue = requireText(rule?.output_value, 'rule.output_value');
    const values = result.get(targetField) ?? [];
    if (!values.includes(outputValue)) values.push(outputValue);
    result.set(targetField, values);
  }
  return result;
}

function indexFields(fields) {
  const result = new Map();
  for (const field of fields) {
    const name = requireText(field?.fieldName, 'field.fieldName');
    if (result.has(name)) {
      throw recoveryError(
        `Duplicate Lark destination field metadata: ${name}`,
        'TIKTOK_COURSE_LEVEL_SCHEMA_FIELD_DUPLICATE',
        { fieldName: name },
      );
    }
    result.set(name, field);
  }
  return result;
}

function normalizeExistingOptions(field, fieldName) {
  const source = field?.property?.options;
  if (!Array.isArray(source)) {
    throw recoveryError(
      `Lark select field has no readable options array: ${fieldName}`,
      'TIKTOK_COURSE_LEVEL_SCHEMA_OPTIONS_INVALID',
      { fieldName },
    );
  }
  const options = source.map((option, index) => {
    if (!isPlainObject(option)) {
      throw recoveryError(
        `Lark select option is invalid: ${fieldName}`,
        'TIKTOK_COURSE_LEVEL_SCHEMA_OPTIONS_INVALID',
        { fieldName, optionIndex: index },
      );
    }
    return Object.freeze({ ...structuredClone(option), name: requireText(option.name, `${fieldName}.option.name`) });
  });
  const names = options.map((option) => option.name);
  if (new Set(names).size !== names.length) {
    throw recoveryError(
      `Lark select field contains duplicate option names: ${fieldName}`,
      'TIKTOK_COURSE_LEVEL_SCHEMA_OPTION_DUPLICATE',
      { fieldName },
    );
  }
  return Object.freeze(options);
}

function normalizeIncident(value) {
  const incident = requireObject(value, 'incident');
  return Object.freeze({
    admissionKey: requireText(incident.admissionKey, 'incident.admissionKey'),
    workKey: requireText(incident.workKey, 'incident.workKey'),
    generation: requireNonNegativeInteger(incident.generation, 'incident.generation'),
    sourceWatermark: requireText(incident.sourceWatermark, 'incident.sourceWatermark'),
    metricDate: requireDate(incident.metricDate, 'incident.metricDate'),
    sourceRecordCount: requireNonNegativeInteger(incident.sourceRecordCount, 'incident.sourceRecordCount'),
    syncRunId: requireText(incident.syncRunId, 'incident.syncRunId'),
    errorCode: requireText(incident.errorCode, 'incident.errorCode'),
  });
}

function normalizeComparable(value) {
  if (typeof value === 'number') return value;
  if (typeof value === 'string' && /^\d+$/u.test(value)) return Number(value);
  return value;
}

function compactSql(value) {
  return String(value).replace(/\s+/gu, ' ').trim();
}

function sqlText(value) {
  return String(value).replaceAll("'", "''");
}

function requireDate(value, label) {
  const text = requireText(value, label);
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(text) || Number.isNaN(Date.parse(`${text}T00:00:00Z`))) {
    throw new TypeError(`${label} must be YYYY-MM-DD`);
  }
  return text;
}

function requirePositiveInteger(value, label) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number <= 0) throw new TypeError(`${label} must be a positive integer`);
  return number;
}

function requireNonNegativeInteger(value, label) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0) throw new TypeError(`${label} must be a non-negative integer`);
  return number;
}

function requireArray(value, label) {
  if (!Array.isArray(value)) throw new TypeError(`${label} must be an array`);
  return value;
}

function requireObject(value, label) {
  if (!isPlainObject(value)) throw new TypeError(`${label} must be an object`);
  return value;
}

function requireText(value, label) {
  if (typeof value !== 'string' || value.trim() === '') throw new TypeError(`${label} must be non-empty text`);
  return value.trim();
}

function optionalText(value) {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function recoveryError(message, code, details = {}) {
  const error = new Error(message);
  error.name = 'TikTokCourseLevelSchemaRecoveryError';
  error.code = code;
  error.details = details;
  return error;
}
