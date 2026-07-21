import { readFile } from 'node:fs/promises';
import {
  buildSharedTableLarkSchemaFromCsv,
  buildSharedTableViewContractFromCsv,
} from '../../packages/config/src/shared-table-lark-schema.js';

const ROOT = new URL('../../', import.meta.url);
const CONTRACT_DIR = 'docs/shared-table-blueprint-v0.12.1/';

/** โหลด Shared-table contract จาก CSV SSOT ชุดเดียวสำหรับ Preview และ Apply */
export async function loadSharedTableSchemaContract() {
  const [tableInventoryCsv, fieldsCsv, migrationMapCsv, viewPlanCsv] = await Promise.all([
    readContract('table-inventory.csv'),
    readContract('fields.csv'),
    readContract('migration-map.csv'),
    readContract('view-plan.csv'),
  ]);
  return Object.freeze({
    schema: buildSharedTableLarkSchemaFromCsv({ tableInventoryCsv, fieldsCsv, migrationMapCsv }),
    views: buildSharedTableViewContractFromCsv({ viewPlanCsv }),
  });
}

function readContract(name) {
  return readFile(new URL(`${CONTRACT_DIR}${name}`, ROOT), 'utf8');
}
