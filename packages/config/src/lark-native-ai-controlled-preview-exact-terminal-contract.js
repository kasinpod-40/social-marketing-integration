import {
  LARK_NATIVE_AI_CONTROLLED_PREVIEW_SUPPORTED_WINDOWS,
} from './lark-native-ai-controlled-preview-contract.js';
import {
  LARK_NATIVE_AI_CONTROLLED_PREVIEW_LIVE_PILOT_CONFIRMATION,
  LARK_NATIVE_AI_CONTROLLED_PREVIEW_LIVE_PILOT_INPUT_SCHEMA_VERSION,
} from './lark-native-ai-controlled-preview-live-pilot-contract.js';

export { LARK_NATIVE_AI_CONTROLLED_PREVIEW_LIVE_PILOT_INPUT_SCHEMA_VERSION };

export const LARK_NATIVE_AI_CONTROLLED_PREVIEW_EXACT_TERMINAL_CONTRACT_VERSION =
  'lark_native_ai_controlled_preview_exact_terminal_v1';

export const LARK_NATIVE_AI_CONTROLLED_PREVIEW_SOURCE_PACKAGE_SCHEMA_VERSION =
  'lark_native_ai_controlled_preview_retained_source_package_v1';

export const LARK_NATIVE_AI_CONTROLLED_PREVIEW_EXACT_TERMINAL_EVIDENCE_SCHEMA_VERSION =
  'lark_native_ai_controlled_preview_exact_terminal_evidence_v1';

export const LARK_NATIVE_AI_CONTROLLED_PREVIEW_EXACT_TERMINAL_CONFIRMATION =
  'RUN_LARK_NATIVE_AI_CONTROLLED_PREVIEW_EXACT_TERMINAL';

export const LARK_NATIVE_AI_CONTROLLED_PREVIEW_EXACT_TERMINAL_DEFAULT_SOURCE_PATH =
  'outputs/lark-native-ai-controlled-preview/retained-real-report-source.json';

export const LARK_NATIVE_AI_CONTROLLED_PREVIEW_EXACT_TERMINAL_OUTPUT_ROOT =
  'outputs/lark-native-ai-controlled-preview/exact-terminal';

export const LARK_NATIVE_AI_CONTROLLED_PREVIEW_EXACT_TERMINAL_WINDOWS =
  LARK_NATIVE_AI_CONTROLLED_PREVIEW_SUPPORTED_WINDOWS;

export const LARK_NATIVE_AI_CONTROLLED_PREVIEW_EXACT_TERMINAL_CHILD_ENV = Object.freeze({
  confirmation: LARK_NATIVE_AI_CONTROLLED_PREVIEW_LIVE_PILOT_CONFIRMATION,
  inputSchemaVersion: LARK_NATIVE_AI_CONTROLLED_PREVIEW_LIVE_PILOT_INPUT_SCHEMA_VERSION,
  maxAttempts: '1',
  maxPages: '1',
  maxFilterConditions: '50',
  requestTimeoutMs: '30000',
  minRequestIntervalMs: '150',
});

export const LARK_NATIVE_AI_CONTROLLED_PREVIEW_EXACT_TERMINAL_LIMITS = Object.freeze({
  expectedWindows: 4,
  expectedRows: 40,
  maximumFirstPassWrites: 40,
  maximumSourcePackageBytes: 16 * 1024 * 1024,
  childTimeoutMs: 5 * 60 * 1000,
  childMaxBufferBytes: 64 * 1024 * 1024,
});
