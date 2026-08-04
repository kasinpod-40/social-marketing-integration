import {
  getReportPlatformContract,
} from '../../packages/application/src/reports/report-platform-adapter-registry.js';
import {
  REPORT_RUNTIME_REVIEWED_CHANNELS,
  REPORT_RUNTIME_REVIEWED_MULTIWINDOW_DAYS,
} from './report-runtime-closeout-channel-binding.js';

export const REPORT_ALL_READY_CHANNELS_CONTRACT = 'report_all_ready_channels_v1';
export const REPORT_ALL_READY_CHANNELS_CONFIRMATION = 'RUN_ALL_READY_CHANNEL_REPORTS';

export function selectAllReadyReportChannels(input = {}) {
  const handoff = requireObject(input.handoff, 'handoff');
  const platformScopes = input.platformScopes ?? REPORT_RUNTIME_REVIEWED_CHANNELS;
  if (!Array.isArray(platformScopes) || platformScopes.length === 0) throw selectionError(
    'Run-all Report selection requires at least one platform',
    'REPORT_ALL_READY_CHANNELS_INPUT_INVALID',
  );
  if (handoff.contractVersion !== 'multichannel_report_live_closure_handoff_v1') throw selectionError(
    'Run-all Report handoff contract is invalid',
    'REPORT_ALL_READY_CHANNELS_HANDOFF_INVALID',
  );

  const ready = [];
  const waiting = [];
  const seen = new Set();
  for (const platformScope of platformScopes) {
    const platform = requireText(platformScope, 'platformScope').toLowerCase();
    if (seen.has(platform) || !REPORT_RUNTIME_REVIEWED_CHANNELS.includes(platform)) throw selectionError(
      'Run-all Report platforms must be unique reviewed channels',
      'REPORT_ALL_READY_CHANNELS_PLATFORM_INVALID',
      { platformScope: platform },
    );
    seen.add(platform);
    const contract = getReportPlatformContract(platform);
    const base = Object.freeze({
      platformScope: platform,
      capability: contract.capability,
      sourceStatus: contract.sourceStatus,
    });
    if (contract.sourceStatus === 'planned') {
      waiting.push(Object.freeze({ ...base, reasonCode: 'REPORT_SOURCE_PLANNED' }));
      continue;
    }

    const readiness = resolveReadiness(handoff, platform);
    if (!readiness) {
      waiting.push(Object.freeze({ ...base, reasonCode: 'REPORT_READINESS_MISSING' }));
      continue;
    }
    const target = readiness.evidence?.target ?? {};
    if (target.platformScope !== platform || target.capability !== contract.capability) {
      waiting.push(Object.freeze({ ...base, reasonCode: 'REPORT_READINESS_TARGET_INVALID' }));
      continue;
    }
    if (readiness.ok !== true
      || readiness.assessment?.readyForLive !== true
      || readiness.assessment?.repositoryReady !== true
      || readiness.assessment?.sourceReady !== true) {
      waiting.push(Object.freeze({
        ...base,
        reasonCode: 'REPORT_READINESS_NOT_READY',
        blockerCount: Number(readiness.assessment?.blockerCount ?? 0),
      }));
      continue;
    }
    const windows = readiness.assessment?.windows;
    const exactWindows = Array.isArray(windows)
      ? windows.map((row) => Number(row?.windowDays)).sort((a, b) => a - b)
      : [];
    if (JSON.stringify(exactWindows) !== JSON.stringify(REPORT_RUNTIME_REVIEWED_MULTIWINDOW_DAYS)) {
      waiting.push(Object.freeze({ ...base, reasonCode: 'REPORT_READINESS_WINDOWS_INVALID' }));
      continue;
    }

    const authority = resolveAuthority(handoff, platform);
    if (!authority) {
      waiting.push(Object.freeze({ ...base, reasonCode: 'REPORT_CLOSEOUT_AUTHORITY_MISSING' }));
      continue;
    }
    if (authority.contractVersion !== 'report_runtime_closeout_uat_v1'
      || authority.platformScope !== platform
      || authority.capability !== contract.capability
      || ![
        'scripts/report-runtime-closeout-reviewed-multiwindow.mjs',
        'scripts/report-runtime-closeout-operator.mjs',
      ].includes(authority.operator)) {
      waiting.push(Object.freeze({ ...base, reasonCode: 'REPORT_CLOSEOUT_AUTHORITY_INVALID' }));
      continue;
    }

    ready.push(Object.freeze({
      ...base,
      windows: Object.freeze([...REPORT_RUNTIME_REVIEWED_MULTIWINDOW_DAYS]),
      sourceWatermark: readiness.evidence?.source?.sourceWatermark ?? null,
    }));
  }

  return Object.freeze({
    ok: true,
    contractVersion: REPORT_ALL_READY_CHANNELS_CONTRACT,
    ready: Object.freeze(ready),
    waiting: Object.freeze(waiting),
    readyCount: ready.length,
    waitingCount: waiting.length,
    allReviewedChannelsCount: platformScopes.length,
  });
}

export function resolveRunAllChannelAuthority(handoff, platformScope) {
  return resolveAuthority(requireObject(handoff, 'handoff'), requireText(platformScope, 'platformScope'));
}

function resolveReadiness(handoff, platformScope) {
  const direct = handoff.channelReadiness?.[platformScope];
  if (direct && typeof direct === 'object' && !Array.isArray(direct)) return direct;
  if (platformScope === 'youtube'
    && handoff.youtubeReadiness
    && typeof handoff.youtubeReadiness === 'object'
    && !Array.isArray(handoff.youtubeReadiness)) return handoff.youtubeReadiness;
  return null;
}

function resolveAuthority(handoff, platformScope) {
  const mapped = handoff.closeoutAuthorities?.[platformScope];
  if (mapped && typeof mapped === 'object' && !Array.isArray(mapped)) return mapped;
  const legacy = handoff.closeoutAuthority;
  if (legacy && typeof legacy === 'object' && !Array.isArray(legacy)) return legacy;
  return null;
}

function requireObject(value, field) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw selectionError(
    `${field} must be an object`,
    'REPORT_ALL_READY_CHANNELS_INPUT_INVALID',
    { field },
  );
  return value;
}
function requireText(value, field) {
  if (typeof value !== 'string' || value.trim() === '') throw selectionError(
    `${field} is required`,
    'REPORT_ALL_READY_CHANNELS_INPUT_INVALID',
    { field },
  );
  return value.trim();
}
function selectionError(message, code, details = {}) {
  const error = new Error(message);
  error.name = 'ReportAllReadyChannelsError';
  error.code = code;
  error.details = details;
  return error;
}
