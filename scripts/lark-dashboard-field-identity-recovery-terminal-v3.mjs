#!/usr/bin/env node

import {
  buildLarkDashboardCompatibilityFreezeAudit,
  buildLarkDashboardMutationBlockedFailure,
  hasRetiredDashboardMutationArgument,
} from './lib/lark-dashboard-compatibility-freeze-v1.js';

const args = process.argv.slice(2);
const entrypoint = 'scripts/lark-dashboard-field-identity-recovery-terminal-v3.mjs';

if (hasRetiredDashboardMutationArgument(args)) {
  const failure = buildLarkDashboardMutationBlockedFailure({ entrypoint, args });
  process.stderr.write(`${JSON.stringify(failure, null, 2)}\n`);
  process.exitCode = 1;
} else {
  const audit = buildLarkDashboardCompatibilityFreezeAudit({ entrypoint });
  process.stdout.write(`${JSON.stringify(audit, null, 2)}\n`);
}
