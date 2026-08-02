import {
  YOUTUBE_REPORT_WINDOW_ACTIONS,
  assessYouTubeReportLiveReadiness as assessEvidenceReadiness,
} from './youtube-report-live-readiness-audit.js';

/**
 * Enforce the exact reviewed repository authority around the pure evidence assessor.
 * Remote collectors must prove a clean main checkout at the exact reviewed Head.
 */
export function assessYouTubeReportLiveReadiness(input = {}) {
  const repository = requireObject(input.repository, 'repository');
  const repositoryBlockers = collectRepositoryBlockers(repository);
  const evidenceResult = assessEvidenceReadiness(input);
  const unsupportedWindowBlockers = evidenceResult.blockers.filter(
    (entry) => entry.code === 'unsupported_window_present',
  );
  const forceEveryWindowBlocked = repositoryBlockers.length > 0
    || unsupportedWindowBlockers.length > 0;
  const forcedBlockers = Object.freeze([
    ...repositoryBlockers,
    ...unsupportedWindowBlockers,
  ]);
  const windows = forceEveryWindowBlocked
    ? evidenceResult.windows.map((window) => Object.freeze({
      ...window,
      action: YOUTUBE_REPORT_WINDOW_ACTIONS.BLOCKED,
      blockers: Object.freeze([...window.blockers, ...forcedBlockers]),
    }))
    : evidenceResult.windows;
  const blockers = Object.freeze([
    ...repositoryBlockers,
    ...evidenceResult.blockers,
  ]);
  const repositoryReady = repositoryBlockers.length === 0;

  return Object.freeze({
    ...evidenceResult,
    repository: Object.freeze({
      branch: textOrNull(repository.branch),
      head: textOrNull(repository.head),
      reviewedHead: textOrNull(repository.reviewedHead),
      clean: repository.clean === true,
    }),
    repositoryReady,
    readyForLive: repositoryReady
      && unsupportedWindowBlockers.length === 0
      && evidenceResult.readyForLive,
    blockers,
    windows: Object.freeze(windows),
  });
}

function collectRepositoryBlockers(repository) {
  const blockers = [];
  const branch = textOrNull(repository.branch);
  const head = textOrNull(repository.head);
  const reviewedHead = textOrNull(repository.reviewedHead);

  if (branch !== 'main') blockers.push(blocker(
    'repository_branch_not_main',
    { observed: branch },
  ));
  if (repository.clean !== true) blockers.push(blocker('repository_not_clean'));
  if (!isCommitSha(head) || !isCommitSha(reviewedHead)) blockers.push(blocker(
    'repository_head_invalid',
    { headPresent: isCommitSha(head), reviewedHeadPresent: isCommitSha(reviewedHead) },
  ));
  else if (head !== reviewedHead) blockers.push(blocker(
    'repository_head_not_reviewed',
    { head, reviewedHead },
  ));

  return Object.freeze(blockers);
}

function requireObject(value, field) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    const error = new Error(`${field} must be an object`);
    error.name = 'YouTubeReportReadinessAuditError';
    error.code = 'YOUTUBE_REPORT_READINESS_INPUT_INVALID';
    error.details = { field };
    throw error;
  }
  return value;
}

function blocker(code, details = {}) {
  return Object.freeze({
    code,
    scope: 'repository',
    details: Object.freeze({ ...details }),
  });
}

function textOrNull(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function isCommitSha(value) {
  return typeof value === 'string' && /^[0-9a-f]{40}$/u.test(value);
}
