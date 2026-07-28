import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildTikTokClassificationSelectOptionPlan,
  buildTikTokCourseLevelIncidentReadSql,
  buildTikTokCourseLevelIncidentResetSql,
  TIKTOK_COURSE_LEVEL_RECOVERY_INCIDENT,
  validateTikTokCourseLevelIncidentResetRow,
  validateTikTokCourseLevelIncidentState,
} from '../../scripts/lib/tiktok-course-level-schema-recovery.js';

function fields(overrides = {}) {
  return [
    {
      fieldId: 'fld-course-name',
      fieldName: 'course_name',
      type: 1,
      uiType: 'Text',
      property: null,
    },
    {
      fieldId: 'fld-course-level',
      fieldName: 'course_level',
      type: 4,
      uiType: 'MultiSelect',
      property: {
        options: [
          { id: 'opt-m4', name: 'ม.4', color: 1 },
          { id: 'opt-m5', name: 'ม.5', color: 2 },
          { id: 'opt-m6', name: 'ม.6', color: 3 },
        ],
      },
      ...overrides.courseLevel,
    },
    {
      fieldId: 'fld-content-theme',
      fieldName: 'content_theme',
      type: 3,
      uiType: 'SingleSelect',
      property: {
        options: [{ id: 'opt-faq', name: 'FAQ', color: 5 }],
      },
    },
  ];
}

function rules() {
  return [
    { target_field: 'course_name', output_value: 'เคมี ม.3' },
    { target_field: 'course_level', output_value: 'ม.3' },
    { target_field: 'course_level', output_value: 'ม.4' },
    { target_field: 'content_theme', output_value: 'FAQ' },
    { target_field: 'content_theme', output_value: 'สรุปเนื้อหา' },
  ];
}

function incidentRow(overrides = {}) {
  const incident = TIKTOK_COURSE_LEVEL_RECOVERY_INCIDENT;
  return {
    admission_key: incident.admissionKey,
    work_key: incident.workKey,
    generation: incident.generation,
    source_watermark: incident.sourceWatermark,
    metric_date: incident.metricDate,
    source_record_count: incident.sourceRecordCount,
    admission_status: 'failed_permanent',
    sync_run_id: incident.syncRunId,
    admission_error_code: incident.errorCode,
    sync_status: 'failed',
    sync_error_code: incident.errorCode,
    records_written: 0,
    work_generation: incident.generation,
    work_lifecycle_status: 'active',
    matching_fence_count: 1,
    active_lock_count: 0,
    ...overrides,
  };
}

test('schema plan preserves every existing option identity and appends only missing dictionary values', () => {
  const plan = buildTikTokClassificationSelectOptionPlan({ fields: fields(), rules: rules() });
  assert.equal(plan.alreadyReady, false);
  assert.equal(plan.actionCount, 2);

  const courseLevel = plan.actions.find((action) => action.fieldName === 'course_level');
  assert.deepEqual(courseLevel.missingOptions, ['ม.3']);
  assert.deepEqual(courseLevel.field.property.options, [
    { id: 'opt-m4', name: 'ม.4', color: 1 },
    { id: 'opt-m5', name: 'ม.5', color: 2 },
    { id: 'opt-m6', name: 'ม.6', color: 3 },
    { name: 'ม.3' },
  ]);

  const theme = plan.actions.find((action) => action.fieldName === 'content_theme');
  assert.deepEqual(theme.field.property.options, [
    { id: 'opt-faq', name: 'FAQ', color: 5 },
    { name: 'สรุปเนื้อหา' },
  ]);
});

test('schema plan is idempotent when all active dictionary outputs already exist', () => {
  const readyFields = fields({
    courseLevel: {
      property: {
        options: [
          { id: 'opt-m3', name: 'ม.3', color: 0 },
          { id: 'opt-m4', name: 'ม.4', color: 1 },
          { id: 'opt-m5', name: 'ม.5', color: 2 },
          { id: 'opt-m6', name: 'ม.6', color: 3 },
        ],
      },
    },
  }).map((field) => field.fieldName === 'content_theme'
    ? {
      ...field,
      property: {
        options: [
          { id: 'opt-faq', name: 'FAQ', color: 5 },
          { id: 'opt-summary', name: 'สรุปเนื้อหา', color: 6 },
        ],
      },
    }
    : field);
  const plan = buildTikTokClassificationSelectOptionPlan({ fields: readyFields, rules: rules() });
  assert.equal(plan.alreadyReady, true);
  assert.equal(plan.actionCount, 0);
});

test('duplicate destination option names remain fail-closed', () => {
  const duplicate = fields({
    courseLevel: {
      property: {
        options: [
          { id: 'opt-a', name: 'ม.4', color: 1 },
          { id: 'opt-b', name: 'ม.4', color: 2 },
        ],
      },
    },
  });
  assert.throws(
    () => buildTikTokClassificationSelectOptionPlan({ fields: duplicate, rules: rules() }),
    (error) => error.code === 'TIKTOK_COURSE_LEVEL_SCHEMA_OPTION_DUPLICATE',
  );
});

test('incident state validation accepts only the exact preflight-only failed operation', () => {
  const result = validateTikTokCourseLevelIncidentState(incidentRow());
  assert.equal(result.resetRequired, true);
  assert.equal(result.admissionKey, TIKTOK_COURSE_LEVEL_RECOVERY_INCIDENT.admissionKey);

  assert.throws(
    () => validateTikTokCourseLevelIncidentState(incidentRow({ active_lock_count: 1 })),
    (error) => error.code === 'TIKTOK_COURSE_LEVEL_INCIDENT_GUARD_FAILED',
  );
  assert.throws(
    () => validateTikTokCourseLevelIncidentState(incidentRow({ records_written: 1 })),
    (error) => error.code === 'TIKTOK_COURSE_LEVEL_INCIDENT_EVIDENCE_INVALID',
  );
});

test('exact reset SQL contains identity, zero-write, active-work, fence and lock guards', () => {
  const readSql = buildTikTokCourseLevelIncidentReadSql({ checkedAt: 1785206000000 });
  assert.match(readSql, /^SELECT /u);
  assert.match(readSql, /matching_fence_count/u);
  assert.match(readSql, /active_lock_count/u);

  const resetSql = buildTikTokCourseLevelIncidentResetSql({ updatedAt: 1785206000000 });
  assert.match(resetSql, /^UPDATE tiktok_source_admissions SET status = 'failed_retryable'/u);
  assert.match(resetSql, /admission_key = 'tiktok-admission:f7f64c/u);
  assert.match(resetSql, /r\.records_written = 0/u);
  assert.match(resetSql, /w\.lifecycle_status = 'active'/u);
  assert.match(resetSql, /EXISTS \( SELECT 1 FROM sync_generation_fences/u);
  assert.match(resetSql, /NOT EXISTS \( SELECT 1 FROM sync_locks/u);
  assert.match(resetSql, /RETURNING admission_key/u);
  assert.doesNotMatch(resetSql, /\b(?:DELETE|DROP|ALTER|CREATE)\b/iu);
});

test('reset result must preserve exact incident identity and become failed_retryable', () => {
  const incident = TIKTOK_COURSE_LEVEL_RECOVERY_INCIDENT;
  const result = validateTikTokCourseLevelIncidentResetRow({
    admission_key: incident.admissionKey,
    work_key: incident.workKey,
    generation: incident.generation,
    source_watermark: incident.sourceWatermark,
    metric_date: incident.metricDate,
    source_record_count: incident.sourceRecordCount,
    admission_status: 'failed_retryable',
    sync_run_id: incident.syncRunId,
    admission_error_code: null,
  });
  assert.equal(result.exactRedrivePrepared, true);
});
