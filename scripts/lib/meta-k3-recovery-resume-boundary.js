import {
  META_K3_EXACT_RECOVERY_IDENTITY,
  META_K3_EXACT_RECOVERY_TRUE_FLAGS_BY_PHASE,
} from '../../packages/config/src/meta-k3-exact-recovery-contract.js';

const EXACT = META_K3_EXACT_RECOVERY_IDENTITY;

export const META_K3_RECOVERY_RESUME_PROFILES = Object.freeze({
  post_admission_pre_stability: Object.freeze([
    'retained-evidence-admission.json',
  ]),
  post_backup_pre_preview: Object.freeze([
    'backup.json',
    'meta-k2-before-recovery.sql',
    'read-only-stability.json',
    'retained-evidence-admission.json',
  ]),
  post_d1_preview_http_404_safe_restored: Object.freeze([
    'backup.json',
    'deploy-d1-continuation.json',
    'meta-k2-before-recovery.sql',
    'read-only-stability.json',
    'restore-after-d1.json',
    'retained-evidence-admission.json',
    'verify-d1-continuation.json',
    'verify-restore-after-d1.json',
  ]),
});

export function identifyMetaK3RecoveryResumeProfile(
  observedFiles = [],
  observedDirectories = [],
) {
  if (!Array.isArray(observedFiles) || !Array.isArray(observedDirectories)) {
    throw boundaryError(
      'K3 recovery resume inventory must be arrays',
      'META_K3_PRE_MUTATION_EVIDENCE_INVALID',
    );
  }
  if (observedDirectories.length !== 0) {
    throw boundaryError(
      'K3 recovery resume root must not contain directories',
      'META_K3_PRE_MUTATION_EVIDENCE_INVALID',
      { observedDirectories: [...observedDirectories].sort() },
    );
  }
  const files = [...observedFiles].sort();
  const profile = Object.entries(META_K3_RECOVERY_RESUME_PROFILES)
    .find(([, expected]) => JSON.stringify(files) === JSON.stringify(expected))?.[0]
    ?? null;
  if (!profile) {
    throw boundaryError(
      'K3 recovery evidence does not match an accepted safe resume profile',
      'META_K3_PRE_MUTATION_EVIDENCE_INVALID',
      { observedFiles: files },
    );
  }
  return profile;
}

export function validateMetaK3RecoveryResumeEvidence(profile, evidence = {}) {
  if (!Object.hasOwn(META_K3_RECOVERY_RESUME_PROFILES, profile)) {
    throw boundaryError(
      'K3 recovery resume profile is unknown',
      'META_K3_PRE_MUTATION_EVIDENCE_INVALID',
      { profile },
    );
  }

  const admission = evidence.admission;
  let accepted = evidenceIdentity(admission, 'retained-evidence-admission')
    && Number(admission?.data?.queueMessageCount) === 0
    && Number(admission?.data?.workerDeploymentCount) === 0
    && admission?.data?.productionTrafficChange === false;

  if (profile !== 'post_admission_pre_stability') {
    const stability = evidence.stability;
    const backup = evidence.backup;
    accepted = accepted
      && evidenceIdentity(stability, 'read-only-stability')
      && stability?.data?.executionFlagsAllFalse === true
      && stability?.data?.productionDeploymentUnchanged === true
      && evidenceIdentity(backup, 'backup')
      && Number(backup?.data?.remoteMutationCount) === 0;
  }

  if (profile === 'post_d1_preview_http_404_safe_restored') {
    const deploy = evidence.deployD1;
    const verify = evidence.verifyD1;
    const restore = evidence.restoreD1;
    const verifyRestore = evidence.verifyRestoreD1;
    accepted = accepted
      && evidenceIdentity(deploy, 'deploy-d1-continuation')
      && deploy?.data?.executionTransport === 'preview_version_upload'
      && deploy?.data?.productionDeploymentUnchanged === true
      && deploy?.data?.productionTrafficChange === false
      && Number(deploy?.data?.workerDeploymentCount) === 0
      && Number(deploy?.data?.workerVersionUploadCount) === 1
      && Number(deploy?.data?.queueMessageCount) === 0
      && evidenceIdentity(verify, 'verify-d1-continuation')
      && stableJson(verify?.data?.expectedTrueFlags)
        === stableJson(META_K3_EXACT_RECOVERY_TRUE_FLAGS_BY_PHASE.d1)
      && verify?.data?.executionTransport === 'preview_version_upload'
      && verify?.data?.productionDeploymentUnchanged === true
      && Number(verify?.data?.queueMessageCount) === 0
      && evidenceIdentity(restore, 'restore-after-d1')
      && restore?.data?.mode === 'safe'
      && stableJson(restore?.data?.expectedTrueFlags) === '[]'
      && restore?.data?.productionDeploymentUnchanged === true
      && restore?.data?.productionTrafficChange === false
      && Number(restore?.data?.workerDeploymentCount) === 0
      && Number(restore?.data?.workerVersionUploadCount) === 1
      && evidenceIdentity(verifyRestore, 'verify-restore-after-d1')
      && verifyRestore?.data?.mode === 'safe'
      && stableJson(verifyRestore?.data?.expectedTrueFlags) === '[]'
      && verifyRestore?.data?.executionFlagsAllFalse === true
      && verifyRestore?.data?.productionDeploymentUnchanged === true;
  }

  if (!accepted) {
    throw boundaryError(
      'K3 recovery evidence does not prove the accepted safe resume boundary',
      'META_K3_PRE_MUTATION_EVIDENCE_INVALID',
      { profile },
    );
  }

  return Object.freeze({
    accepted: true,
    profile,
    operationId: EXACT.operationId,
    businessContinuationEvidencePresent: false,
    queueMessageCount: 0,
    lifecycleSqlRepairCount: 0,
    productionTrafficChange: false,
  });
}

function evidenceIdentity(value, phase) {
  return value?.status === 'passed'
    && value?.phase === phase
    && value?.operationId === EXACT.operationId
    && value?.workKey === EXACT.workKey
    && value?.syncRunId === EXACT.syncRunId;
}

function stableJson(value) {
  return JSON.stringify(value ?? null);
}

function boundaryError(message, code, details = {}) {
  const error = new Error(message);
  error.name = 'MetaK3RecoveryResumeBoundaryError';
  error.code = code;
  error.details = details;
  return error;
}
