import { preflightMetaCustomerConnections } from '../packages/application/src/use-cases/preflight-meta-customer-connections.js';
import { createMetaTokenConnectionRuntime } from '../packages/connectors/src/meta/meta-token-connection-runtime.js';
import { sanitizeOperationalError } from '../packages/shared/src/errors/runtime-error.js';
import { readDevVars } from './lib/dev-vars.js';

try {
  const fileEnv = await readDevVars(process.env.DEV_VARS_FILE ?? '.dev.vars');
  const env = Object.freeze({ ...fileEnv, ...process.env });
  const runtime = createMetaTokenConnectionRuntime(env);
  const result = await preflightMetaCustomerConnections(runtime);
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exitCode = 1;
} catch (error) {
  console.error(JSON.stringify({
    ok: false,
    businessWrites: 0,
    error: sanitizeOperationalError(error),
  }, null, 2));
  process.exitCode = 1;
}
