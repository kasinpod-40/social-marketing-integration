export const OPERATOR_TERMINAL_AUDIT_CONTRACT =
  'operator_terminal_channel_audit_v1';

export const OPERATOR_TERMINAL_STATUSES = Object.freeze([
  'PASS_EXISTING_PATTERN',
  'NEEDS_SPAWNED_TEST',
  'NEEDS_ALL_BLOCKER_PREFLIGHT',
  'NEEDS_EXIT_CODE_CONTRACT',
  'NEEDS_SAFE_RESTORE_EVIDENCE',
  'UNSAFE_SHELL_COMMAND',
]);

export const OPERATOR_TERMINAL_REQUIRED_CHANNELS = Object.freeze({
  meta: 'scripts/meta-history-2026-reviewed-release-terminal.mjs',
  woocommerce: 'scripts/woocommerce-report-runtime-closeout.mjs',
  chatwoot: 'scripts/chatwoot-controller-safe-baseline-resume-terminal.mjs',
  tiktok: 'scripts/tiktok-durable-recovery-operator.mjs',
  google_ads: 'scripts/google-ads-live-operator.mjs',
  youtube: 'scripts/youtube-report-remote-readiness-reviewed-terminal.mjs',
  lark_native_ai: 'scripts/lark-native-ai-controlled-preview-exact-terminal.mjs',
});

export const OPERATOR_TERMINAL_STRICT_PASS_PATHS = Object.freeze([
  'scripts/youtube-report-remote-readiness-reviewed-terminal.mjs',
  'scripts/youtube-report-terminal-acceptance.mjs',
  'scripts/multichannel-report-live-closure-terminal.mjs',
  'scripts/multichannel-report-live-closure-acceptance.mjs',
  'scripts/lark-native-ai-controlled-preview-exact-terminal.mjs',
]);

export const OPERATOR_TERMINAL_COMPANION_CONTROLS = Object.freeze({
  'scripts/youtube-report-remote-readiness-reviewed-terminal.mjs': Object.freeze({
    allBlockerPreflightPath: 'scripts/youtube-report-terminal-acceptance.mjs',
    spawnedTestPath: 'tests/scripts/youtube-report-terminal-acceptance.test.js',
    completionAuthority: 'exit_code_contract',
  }),
  'scripts/multichannel-report-live-closure-terminal.mjs': Object.freeze({
    allBlockerPreflightPath: 'scripts/multichannel-report-live-closure-acceptance.mjs',
    spawnedTestPath: 'tests/scripts/multichannel-report-live-closure-acceptance.test.js',
    completionAuthority: 'exit_code_contract',
    privateEvidencePath: 'outputs/multichannel-report-live-closure/terminal-acceptance-summary.json',
    safeRestoreAuthority: 'scripts/report-runtime-closeout-reviewed-multiwindow.mjs#finally-all-false',
    sameInputReplayAuthority: 'scripts/report-runtime-closeout-reviewed-multiwindow.mjs#same-input-replay-zero-drift',
  }),
});

/**
 * Existing debt is explicit and fail-closed. A changed/new entrypoint that is not PASS must be listed here,
 * otherwise the architecture gate fails. Once an entry reaches PASS the stale debt entry also fails and must
 * be removed, so this cannot become a permanent blanket allowlist.
 */
export const OPERATOR_TERMINAL_ACKNOWLEDGED_DEBT = Object.freeze({});

export const OPERATOR_TERMINAL_RECOMMENDED_CONTROLS = Object.freeze([
  'plan_only_default',
  'spawned_entrypoint_test',
  'all_blocker_local_preflight',
  'exact_repository_identity',
  'shell_free_child_process',
  'private_retained_evidence',
  'completion_or_exit_contract',
  'safe_restore_or_same_input_replay',
]);