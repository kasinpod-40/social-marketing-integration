import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import {
  extractWooCommerceWranglerStderrEvidence,
} from './woocommerce-wrangler-stderr-evidence.js';

const originalSpawnSync = childProcess.spawnSync;

childProcess.spawnSync = function patchedSpawnSync(file, args = [], options = {}) {
  const result = Reflect.apply(originalSpawnSync, this, [file, args, options]);
  if (isTargetWranglerVersionUploadFailure(file, args, result)) {
    const evidence = extractWooCommerceWranglerStderrEvidence(result.stderr);
    process.stderr.write(`${JSON.stringify({
      ok: false,
      stage: 'woocommerce-wrangler-versions-upload-stderr-evidence',
      ...evidence,
      remoteActionsAddedByPreload: 0,
      tokenPrintedByPreload: false,
    }, null, 2)}\n`);
  }
  return result;
};

syncBuiltinESMExports();

function isTargetWranglerVersionUploadFailure(file, args, result) {
  const executable = String(file ?? '').split(/[\\/]/u).pop();
  return executable === 'npx'
    && Array.isArray(args)
    && args[0] === 'wrangler'
    && args[1] === 'versions'
    && args[2] === 'upload'
    && (result?.error || result?.status !== 0);
}
