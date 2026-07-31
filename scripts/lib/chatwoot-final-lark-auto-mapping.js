import { CHATWOOT_LARK_BLUEPRINT } from '../../packages/config/src/chatwoot-lark-blueprint.js';
import { permanentError } from '../../packages/shared/src/errors/runtime-error.js';
import {
  discoverChatwootLarkTables,
  loadChatwootLarkMetadataTarget,
} from './chatwoot-lark-metadata-readiness.js';

export const CHATWOOT_FINAL_LARK_AUTO_MAPPING_CONTRACT_VERSION =
  'chatwoot_final_lark_auto_mapping_v1';

/**
 * Resolve the 15 reviewed Chatwoot Lark table IDs from exact Blueprint names/aliases.
 * Raw Table IDs are returned only for an ignored private generated config and must never be logged.
 */
export function resolveChatwootFinalLarkAutoMappings(input = {}) {
  const env = requireObject(input.env, 'env');
  const remoteTables = requireArray(input.remoteTables, 'remoteTables');
  const target = loadChatwootLarkMetadataTarget(env);
  const discovery = discoverChatwootLarkTables({
    remoteTables,
    tableRefs: target.tableRefs,
  });

  const blockers = Object.freeze({
    missingTables: [...discovery.missingTables].sort(),
    ambiguousTables: [...discovery.ambiguousTables].sort(),
    identityMismatches: [...discovery.identityMismatches].sort(),
  });
  const blockerCount = Object.values(blockers).reduce((sum, values) => sum + values.length, 0);
  if (blockerCount > 0) {
    throw autoMappingError(
      'Chatwoot Lark table discovery is blocked',
      'CHATWOOT_FINAL_UAT_LARK_MAPPING_DISCOVERY_BLOCKED',
      { ...blockers, remoteTableCount: discovery.remoteTableCount },
    );
  }

  const entries = CHATWOOT_LARK_BLUEPRINT.map((table) => {
    const binding = discovery.bindings[table.key];
    if (!binding?.tableId) {
      throw autoMappingError(
        `Chatwoot Lark mapping is unresolved for ${table.key}`,
        'CHATWOOT_FINAL_UAT_LARK_MAPPING_DISCOVERY_INCOMPLETE',
        { tableKey: table.key },
      );
    }
    return Object.freeze({
      tableKey: table.key,
      envName: table.envName,
      tableId: binding.tableId,
      source: binding.source,
    });
  });

  if (entries.length !== 15 || new Set(entries.map((entry) => entry.tableId)).size !== 15) {
    throw autoMappingError(
      'Chatwoot Lark discovery must resolve 15 unique tables',
      'CHATWOOT_FINAL_UAT_LARK_MAPPING_DISCOVERY_INCOMPLETE',
      { resolvedTableCount: entries.length, uniqueTableCount: new Set(entries.map((entry) => entry.tableId)).size },
    );
  }

  return deepFreeze({
    contractVersion: CHATWOOT_FINAL_LARK_AUTO_MAPPING_CONTRACT_VERSION,
    tableCount: entries.length,
    aliasDiscoveryCount: entries.filter((entry) => entry.source === 'alias_discovery').length,
    staleMappingRepairCount: entries.filter((entry) => entry.source === 'repair_stale_env').length,
    configuredMappingCount: entries.filter((entry) => entry.source === 'configured_id').length,
    values: Object.fromEntries(entries.map((entry) => [entry.envName, entry.tableId])),
  });
}

function requireArray(value, fieldName) {
  if (!Array.isArray(value)) throw new TypeError(`${fieldName} must be an array`);
  return value;
}

function requireObject(value, fieldName) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${fieldName} must be an object`);
  }
  return value;
}

function autoMappingError(message, code, details = {}) {
  return permanentError(message, { code, details });
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const nested of Object.values(value)) deepFreeze(nested);
  return value;
}
