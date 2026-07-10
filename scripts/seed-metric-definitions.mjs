import { seedMetricDefinitions } from '../packages/application/src/use-cases/seed-metric-definitions.js';
import { createLocalLarkRuntime, printJson } from './lib/lark-runtime.js';

if (process.env.CONFIRM_WRITE !== 'YES') {
  throw new Error('Refusing to write to Lark. Run with CONFIRM_WRITE=YES npm run seed:metrics');
}

const runtime = await createLocalLarkRuntime(['mktMetricDefinitions']);
const result = await seedMetricDefinitions({
  repository: runtime.repository,
  tableId: runtime.tables.mktMetricDefinitions,
});

printJson(result);
