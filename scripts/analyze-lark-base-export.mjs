import { readFile } from 'node:fs/promises';
import { analyzeLarkBaseExport, redactLarkBaseAnalysisTableIds } from '../packages/shared/src/lark/lark-base-export.js';

try {
  await main();
} catch (error) {
  console.error(JSON.stringify({
    ok: false,
    name: error?.name ?? 'Error',
    code: error?.code ?? 'LARK_BASE_EXPORT_ANALYSIS_FAILED',
    message: error?.message ?? String(error),
  }, null, 2));
  process.exitCode = 1;
}

async function main() {
  const args = process.argv.slice(2);
  const includeIds = args.includes('--include-table-ids');
  const filePath = args.find((arg) => !arg.startsWith('--'));
  if (!filePath) {
    throw new TypeError('Usage: npm run analyze:lark-base-export -- <path-to-file.base> [--include-table-ids]');
  }
  const text = await readFile(filePath, 'utf8');
  const analysis = analyzeLarkBaseExport(text);
  const safeAnalysis = includeIds ? analysis : redactLarkBaseAnalysisTableIds(analysis);
  console.log(JSON.stringify({ ok: true, ...safeAnalysis }, null, 2));
}
