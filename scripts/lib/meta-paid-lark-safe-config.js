import { permanentError } from '../../packages/shared/src/errors/runtime-error.js';

export const META_PAID_LARK_SAFE_CONFIG_CONTRACT_VERSION =
  'meta_paid_lark_safe_config_v1';

const ENABLED_FLAG_ASSIGNMENT =
  /((?:["']?)(MKT_[A-Z0-9_]+_ENABLED)(?:["']?)\s*:\s*)(?:"(true|false)"|(true|false))/gu;

export function materializeMetaPaidLarkSafeConfig(sourceText) {
  const source = requireText(sourceText, 'sourceText');
  const declaredFlags = [];
  const changedFlags = [];
  const text = source.replace(
    ENABLED_FLAG_ASSIGNMENT,
    (match, prefix, flag, quotedValue, bareValue) => {
      const enabled = (quotedValue ?? bareValue) === 'true';
      declaredFlags.push(flag);
      if (enabled) changedFlags.push(flag);
      return `${prefix}"false"`;
    },
  );
  if (declaredFlags.length === 0) {
    throw safeConfigError(
      'Paid Meta closeout safe config contains no MKT execution flags',
      'META_PAID_LARK_SAFE_CONFIG_FLAGS_MISSING',
    );
  }
  const remainingTrueFlags = collectTrueMktExecutionFlags(text);
  if (remainingTrueFlags.length !== 0) {
    throw safeConfigError(
      'Paid Meta closeout safe config still contains enabled MKT execution flags',
      'META_PAID_LARK_SAFE_CONFIG_NOT_CLOSED',
      { remainingTrueFlags },
    );
  }
  return Object.freeze({
    contractVersion: META_PAID_LARK_SAFE_CONFIG_CONTRACT_VERSION,
    text,
    declaredFlags: Object.freeze([...new Set(declaredFlags)].sort()),
    changedFlags: Object.freeze([...new Set(changedFlags)].sort()),
    remainingTrueFlags: Object.freeze([]),
  });
}

export function collectTrueMktExecutionFlags(text) {
  const source = requireText(text, 'text');
  const matches = [];
  for (const match of source.matchAll(ENABLED_FLAG_ASSIGNMENT)) {
    if ((match[3] ?? match[4]) === 'true') matches.push(match[2]);
  }
  return Object.freeze([...new Set(matches)].sort());
}

function requireText(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw safeConfigError(
      `${fieldName} is required`,
      'META_PAID_LARK_SAFE_CONFIG_INPUT_INVALID',
      { fieldName },
    );
  }
  return value;
}

function safeConfigError(message, code, details = {}) {
  return permanentError(message, { code, details });
}
