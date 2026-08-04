import { META_K2_EXACT_RECOVERY_PATH } from '../../packages/config/src/meta-k2-exact-recovery-contract.js';
import { permanentError } from '../../packages/shared/src/errors/runtime-error.js';
import { parseJsoncObject } from './chatwoot-safe-wrangler-config.js';

const EXACT_WORKER_NAME = 'social-mkt-sync-worker';
const DNS_LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u;

/**
 * Resolve the public Worker authority declared by the exact Wrangler config.
 * The live command does not pass --env, so only top-level route/workers_dev fields are authoritative.
 */
export function resolveMetaK2WranglerOriginAuthority(configText) {
  const config = parseJsoncObject(configText);
  if (config.name !== EXACT_WORKER_NAME) {
    throw authorityError(
      'Meta K2 recovery requires the exact Worker name in Wrangler config',
      'META_K2_WRANGLER_RECOVERY_WORKER_INVALID',
      { fieldName: 'name' },
    );
  }

  const routeEntries = [
    ...normalizeRouteContainer(config.route, 'route'),
    ...normalizeRouteContainer(config.routes, 'routes'),
  ];
  const routeOrigins = routeEntries
    .map((entry) => parseRouteOrigin(entry))
    .filter(Boolean);
  const uniqueOrigins = [...new Set(routeOrigins)].sort();
  if (uniqueOrigins.length > 1) {
    throw authorityError(
      'Wrangler config exposes multiple origins that cover the Meta K2 recovery route',
      'META_K2_WRANGLER_RECOVERY_ROUTE_CONFLICT',
      { originCount: uniqueOrigins.length },
    );
  }

  if (config.workers_dev !== undefined && typeof config.workers_dev !== 'boolean') {
    throw authorityError(
      'Wrangler workers_dev must be boolean when present',
      'META_K2_WRANGLER_RECOVERY_WORKERS_DEV_INVALID',
      { fieldName: 'workers_dev' },
    );
  }

  return Object.freeze({
    workerName: EXACT_WORKER_NAME,
    routeOrigin: uniqueOrigins[0] ?? null,
    routeEntryCount: routeEntries.length,
    matchingRouteCount: routeOrigins.length,
    workersDevEnabled: config.workers_dev === true,
  });
}

export function buildMetaK2WorkersDevOrigin(workerName, accountSubdomain) {
  const worker = requireDnsLabel(workerName, 'workerName');
  const subdomain = requireDnsLabel(accountSubdomain, 'accountSubdomain');
  return `https://${worker}.${subdomain}.workers.dev`;
}

function normalizeRouteContainer(value, fieldName) {
  if (value === undefined || value === null) return [];
  const values = Array.isArray(value) ? value : [value];
  return values.map((entry) => {
    if (typeof entry === 'string') {
      return Object.freeze({ pattern: entry, customDomain: false, fieldName });
    }
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      throw authorityError(
        'Wrangler route entry is invalid',
        'META_K2_WRANGLER_RECOVERY_ROUTE_INVALID',
        { fieldName },
      );
    }
    if (typeof entry.pattern !== 'string' || entry.pattern.trim() === '') {
      throw authorityError(
        'Wrangler route object requires a pattern',
        'META_K2_WRANGLER_RECOVERY_ROUTE_INVALID',
        { fieldName },
      );
    }
    if (entry.custom_domain !== undefined && typeof entry.custom_domain !== 'boolean') {
      throw authorityError(
        'Wrangler custom_domain must be boolean when present',
        'META_K2_WRANGLER_RECOVERY_ROUTE_INVALID',
        { fieldName },
      );
    }
    return Object.freeze({
      pattern: entry.pattern,
      customDomain: entry.custom_domain === true,
      fieldName,
    });
  });
}

function parseRouteOrigin(entry) {
  let pattern = entry.pattern.trim();
  if (/^http:\/\//iu.test(pattern)) {
    throw authorityError(
      'Meta K2 Wrangler route must use HTTPS',
      'META_K2_WRANGLER_RECOVERY_ROUTE_INVALID',
      { fieldName: entry.fieldName },
    );
  }
  pattern = pattern.replace(/^https:\/\//iu, '');
  if (pattern.includes('?') || pattern.includes('#')) {
    throw authorityError(
      'Meta K2 Wrangler route must not contain query or fragment',
      'META_K2_WRANGLER_RECOVERY_ROUTE_INVALID',
      { fieldName: entry.fieldName },
    );
  }

  const slash = pattern.indexOf('/');
  const authority = slash >= 0 ? pattern.slice(0, slash) : pattern;
  const pathPattern = slash >= 0 ? pattern.slice(slash) : '/';
  const coversExactPath = routePathCovers(pathPattern, META_K2_EXACT_RECOVERY_PATH);
  if (!coversExactPath) return null;

  if (authority.includes('*')) {
    throw authorityError(
      'Wildcard Wrangler host cannot identify one exact Meta K2 recovery origin',
      'META_K2_WRANGLER_RECOVERY_ROUTE_AMBIGUOUS',
      { fieldName: entry.fieldName },
    );
  }
  if (entry.customDomain && pathPattern !== '/') {
    throw authorityError(
      'Wrangler custom domain route must not contain a path',
      'META_K2_WRANGLER_RECOVERY_ROUTE_INVALID',
      { fieldName: entry.fieldName },
    );
  }

  let url;
  try {
    url = new URL(`https://${authority}`);
  } catch {
    throw authorityError(
      'Wrangler route authority is not a valid HTTPS host',
      'META_K2_WRANGLER_RECOVERY_ROUTE_INVALID',
      { fieldName: entry.fieldName },
    );
  }
  if (url.protocol !== 'https:'
    || url.username !== ''
    || url.password !== ''
    || (url.port !== '' && url.port !== '443')
    || url.pathname !== '/') {
    throw authorityError(
      'Wrangler route authority is not an exact HTTPS origin',
      'META_K2_WRANGLER_RECOVERY_ROUTE_INVALID',
      { fieldName: entry.fieldName },
    );
  }
  return url.origin;
}

function routePathCovers(pattern, exactPath) {
  if (pattern === '' || pattern === '/' || pattern === '/*') return true;
  const firstStar = pattern.indexOf('*');
  if (firstStar < 0) return pattern === exactPath;
  if (pattern.indexOf('*', firstStar + 1) >= 0) {
    throw authorityError(
      'Wrangler route path may contain at most one wildcard',
      'META_K2_WRANGLER_RECOVERY_ROUTE_INVALID',
    );
  }
  const prefix = pattern.slice(0, firstStar);
  const suffix = pattern.slice(firstStar + 1);
  return exactPath.startsWith(prefix) && exactPath.endsWith(suffix);
}

function requireDnsLabel(value, fieldName) {
  const text = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (!DNS_LABEL.test(text)) {
    throw authorityError(
      `${fieldName} must be a DNS-safe label`,
      'META_K2_WRANGLER_RECOVERY_WORKERS_DEV_INVALID',
      { fieldName },
    );
  }
  return text;
}

function authorityError(message, code, details = {}) {
  return permanentError(message, { code, details });
}
