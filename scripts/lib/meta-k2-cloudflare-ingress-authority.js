import { META_K2_EXACT_RECOVERY_PATH } from '../../packages/config/src/meta-k2-exact-recovery-contract.js';
import { permanentError } from '../../packages/shared/src/errors/runtime-error.js';

const EXACT_WORKER_NAME = 'social-mkt-sync-worker';
const ACCOUNT_OR_ZONE_ID = /^[0-9a-f]{32}$/iu;
const HOSTNAME = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u;

export function parseMetaK2WorkerDomains(payload, workerName = EXACT_WORKER_NAME) {
  const body = requireEnvelope(payload, 'workerDomains');
  const expectedWorker = requireWorkerName(workerName);
  const matching = body.result.filter((entry) => entry?.service === expectedWorker);
  const origins = matching.map((entry) => {
    const hostname = requireHostname(entry?.hostname, 'workerDomains.hostname');
    return `https://${hostname}`;
  });
  return Object.freeze({
    source: 'cloudflare_worker_domains',
    inspectedCount: body.result.length,
    matchingCount: matching.length,
    origins: Object.freeze(unique(origins)),
  });
}

export function parseMetaK2AccountZones(payload) {
  const body = requireEnvelope(payload, 'zones');
  const zones = body.result.map((entry) => Object.freeze({
    id: requireId(entry?.id, 'zones.id'),
  }));
  return Object.freeze({
    inspectedCount: zones.length,
    zones: Object.freeze(zones),
  });
}

export function parseMetaK2WorkerRoutes(payload, workerName = EXACT_WORKER_NAME) {
  const body = requireEnvelope(payload, 'workerRoutes');
  const expectedWorker = requireWorkerName(workerName);
  const matching = body.result.filter((entry) => entry?.script === expectedWorker);
  const origins = matching
    .map((entry) => parseRouteOrigin(entry?.pattern))
    .filter(Boolean);
  return Object.freeze({
    source: 'cloudflare_worker_routes',
    inspectedCount: body.result.length,
    matchingScriptCount: matching.length,
    matchingPathCount: origins.length,
    origins: Object.freeze(unique(origins)),
  });
}

export function selectMetaK2CloudflareIngressAuthority(input = {}) {
  const domainOrigins = normalizeOrigins(input.domainOrigins, 'domainOrigins');
  const routeOrigins = normalizeOrigins(input.routeOrigins, 'routeOrigins');
  const origins = unique([...domainOrigins, ...routeOrigins]);
  if (origins.length === 0) {
    throw authorityError(
      'Cloudflare remote metadata exposes no public ingress for the exact Meta K2 recovery route',
      'META_K2_CLOUDFLARE_RECOVERY_ORIGIN_UNAVAILABLE',
      {
        domainOriginCount: domainOrigins.length,
        routeOriginCount: routeOrigins.length,
      },
    );
  }
  if (origins.length !== 1) {
    throw authorityError(
      'Cloudflare remote metadata exposes conflicting Meta K2 recovery origins',
      'META_K2_CLOUDFLARE_RECOVERY_ORIGIN_CONFLICT',
      {
        domainOriginCount: domainOrigins.length,
        routeOriginCount: routeOrigins.length,
        uniqueOriginCount: origins.length,
      },
    );
  }
  return Object.freeze({
    origin: origins[0],
    source: domainOrigins.includes(origins[0])
      ? 'cloudflare_worker_domain'
      : 'cloudflare_worker_route',
    domainOriginCount: domainOrigins.length,
    routeOriginCount: routeOrigins.length,
  });
}

function parseRouteOrigin(value) {
  let pattern = requireText(value, 'workerRoutes.pattern');
  if (/^http:\/\//iu.test(pattern)) {
    throw authorityError(
      'Cloudflare Worker route must not use HTTP',
      'META_K2_CLOUDFLARE_RECOVERY_ROUTE_INVALID',
    );
  }
  pattern = pattern.replace(/^https:\/\//iu, '');
  if (pattern.includes('?') || pattern.includes('#')) {
    throw authorityError(
      'Cloudflare Worker route must not contain query or fragment',
      'META_K2_CLOUDFLARE_RECOVERY_ROUTE_INVALID',
    );
  }
  const slash = pattern.indexOf('/');
  const authority = slash >= 0 ? pattern.slice(0, slash) : pattern;
  const pathPattern = slash >= 0 ? pattern.slice(slash) : '/';
  if (!routePathCovers(pathPattern, META_K2_EXACT_RECOVERY_PATH)) return null;
  if (authority.includes('*')) {
    throw authorityError(
      'Wildcard Worker route host cannot identify one exact recovery origin',
      'META_K2_CLOUDFLARE_RECOVERY_ROUTE_AMBIGUOUS',
    );
  }
  const hostname = requireHostname(authority, 'workerRoutes.pattern');
  return `https://${hostname}`;
}

function routePathCovers(pattern, exactPath) {
  if (pattern === '' || pattern === '/' || pattern === '/*') return true;
  const firstStar = pattern.indexOf('*');
  if (firstStar < 0) return pattern === exactPath;
  if (pattern.indexOf('*', firstStar + 1) >= 0) {
    throw authorityError(
      'Cloudflare Worker route path may contain at most one wildcard',
      'META_K2_CLOUDFLARE_RECOVERY_ROUTE_INVALID',
    );
  }
  const prefix = pattern.slice(0, firstStar);
  const suffix = pattern.slice(firstStar + 1);
  return exactPath.startsWith(prefix) && exactPath.endsWith(suffix);
}

function requireEnvelope(value, fieldName) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || value.success !== true || !Array.isArray(value.result)) {
    throw authorityError(
      `${fieldName} response is invalid`,
      'META_K2_CLOUDFLARE_RECOVERY_RESPONSE_INVALID',
      { fieldName },
    );
  }
  return value;
}

function normalizeOrigins(value, fieldName) {
  if (!Array.isArray(value)) {
    throw authorityError(
      `${fieldName} must be an array`,
      'META_K2_CLOUDFLARE_RECOVERY_INPUT_INVALID',
      { fieldName },
    );
  }
  return value.map((origin) => {
    const url = new URL(requireText(origin, fieldName));
    if (url.protocol !== 'https:' || url.pathname !== '/' || url.search || url.hash) {
      throw authorityError(
        `${fieldName} contains an invalid HTTPS origin`,
        'META_K2_CLOUDFLARE_RECOVERY_INPUT_INVALID',
        { fieldName },
      );
    }
    return url.origin;
  });
}

function requireWorkerName(value) {
  const text = requireText(value, 'workerName');
  if (text !== EXACT_WORKER_NAME) {
    throw authorityError(
      'Cloudflare ingress authority requires the exact Worker name',
      'META_K2_CLOUDFLARE_RECOVERY_WORKER_INVALID',
    );
  }
  return text;
}

function requireHostname(value, fieldName) {
  const text = requireText(value, fieldName).toLowerCase();
  if (!HOSTNAME.test(text) || text.includes('..')) {
    throw authorityError(
      `${fieldName} must be an exact DNS hostname`,
      'META_K2_CLOUDFLARE_RECOVERY_HOSTNAME_INVALID',
      { fieldName },
    );
  }
  return text;
}

function requireId(value, fieldName) {
  const text = requireText(value, fieldName);
  if (!ACCOUNT_OR_ZONE_ID.test(text)) {
    throw authorityError(
      `${fieldName} must be a Cloudflare identifier`,
      'META_K2_CLOUDFLARE_RECOVERY_ID_INVALID',
      { fieldName },
    );
  }
  return text;
}

function requireText(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw authorityError(
      `${fieldName} is required`,
      'META_K2_CLOUDFLARE_RECOVERY_INPUT_INVALID',
      { fieldName },
    );
  }
  return value.trim();
}

function unique(values) {
  return [...new Set(values)].sort();
}

function authorityError(message, code, details = {}) {
  return permanentError(message, { code, details });
}
