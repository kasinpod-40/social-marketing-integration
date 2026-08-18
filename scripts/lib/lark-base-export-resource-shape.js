const DEFAULT_MAX_DEPTH = 10;
const DEFAULT_MAX_PATHS = 2_000;
const DEFAULT_MAX_ARRAY_SAMPLES = 8;

/**
 * Produces a value-redacted structural inventory of non-table resources decoded
 * from an approved local Lark `.base` export.
 *
 * The output intentionally contains property paths, value types, array lengths and
 * reference-key counts only. String/number/boolean values are never emitted, so
 * role members, IDs, tokens and workflow text cannot leak into logs while we learn
 * the exact export schema required for deterministic remap implementation.
 */
export function inspectLarkBaseExportResourceShapes(resources, options = {}) {
  const source = requireObject(resources, 'resources');
  const maxDepth = positiveInteger(options.maxDepth ?? DEFAULT_MAX_DEPTH, 'maxDepth');
  const maxPaths = positiveInteger(options.maxPaths ?? DEFAULT_MAX_PATHS, 'maxPaths');
  const maxArraySamples = positiveInteger(options.maxArraySamples ?? DEFAULT_MAX_ARRAY_SAMPLES, 'maxArraySamples');
  const result = {};

  for (const name of ['dashboards', 'workflows', 'roles', 'accessConfig', 'extraInfo']) {
    result[name] = inspectOne(source[name], { maxDepth, maxPaths, maxArraySamples });
  }

  return deepFreeze({
    ok: true,
    contractVersion: 'lark_base_export_resource_shape_audit_v1',
    mode: 'local-read-only-value-redacted',
    resources: result,
    remoteRequestCount: 0,
    remoteMutationCount: 0,
  });
}

function inspectOne(value, limits) {
  const paths = new Map();
  const referenceKeys = new Map();
  const arrayLengths = new Map();
  const state = { pathsVisited: 0, truncated: false };
  visit(value, '$', 0, paths, referenceKeys, arrayLengths, state, limits);
  return {
    rootType: valueType(value),
    topLevelKeys: plainObject(value) ? Object.keys(value).sort() : [],
    rootArrayLength: Array.isArray(value) ? value.length : null,
    pathCount: paths.size,
    truncated: state.truncated,
    paths: [...paths.values()].sort((left, right) => left.path.localeCompare(right.path)),
    arrayLengths: [...arrayLengths.entries()]
      .map(([path, lengths]) => ({ path, lengths: [...lengths].sort((a, b) => a - b) }))
      .sort((left, right) => left.path.localeCompare(right.path)),
    referenceKeyCounts: Object.fromEntries([...referenceKeys.entries()].sort(([left], [right]) => left.localeCompare(right))),
  };
}

function visit(value, path, depth, paths, referenceKeys, arrayLengths, state, limits) {
  if (state.pathsVisited >= limits.maxPaths) {
    state.truncated = true;
    return;
  }
  state.pathsVisited += 1;
  const type = valueType(value);
  addPath(paths, path, type);
  if (depth >= limits.maxDepth) {
    if (type === 'array' || type === 'object') state.truncated = true;
    return;
  }

  if (Array.isArray(value)) {
    if (!arrayLengths.has(path)) arrayLengths.set(path, new Set());
    arrayLengths.get(path).add(value.length);
    const sampleCount = Math.min(value.length, limits.maxArraySamples);
    for (let index = 0; index < sampleCount; index += 1) {
      visit(value[index], `${path}[]`, depth + 1, paths, referenceKeys, arrayLengths, state, limits);
    }
    if (value.length > sampleCount) state.truncated = true;
    return;
  }

  if (!plainObject(value)) return;
  for (const key of Object.keys(value).sort()) {
    if (looksLikeReferenceKey(key)) referenceKeys.set(key, (referenceKeys.get(key) ?? 0) + 1);
    visit(value[key], `${path}.${key}`, depth + 1, paths, referenceKeys, arrayLengths, state, limits);
  }
}

function addPath(paths, path, type) {
  const existing = paths.get(`${path}:${type}`);
  if (existing) {
    existing.occurrences += 1;
    return;
  }
  paths.set(`${path}:${type}`, { path, type, occurrences: 1 });
}

function looksLikeReferenceKey(key) {
  return /(?:^|_)(?:id|ids|token|table|field|view|block|role|workflow|automation)(?:$|_)/iu.test(key)
    || /(?:Id|Ids|Token|Table|Field|View|Block|Role|Workflow|Automation)$/u.test(key);
}

function valueType(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  if (plainObject(value)) return 'object';
  if (typeof value === 'string') return 'string';
  if (typeof value === 'number') return Number.isFinite(value) ? 'number' : 'non-finite-number';
  if (typeof value === 'boolean') return 'boolean';
  if (value === undefined) return 'undefined';
  return typeof value;
}

function plainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function requireObject(value, name) {
  if (!plainObject(value)) throw new TypeError(`${name} must be an object`);
  return value;
}

function positiveInteger(value, name) {
  if (!Number.isInteger(value) || value <= 0) throw new TypeError(`${name} must be a positive integer`);
  return value;
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const nested of Object.values(value)) deepFreeze(nested);
  return value;
}
