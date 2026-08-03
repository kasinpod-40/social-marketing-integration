import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { auditOperatorTerminalChannels } from './lib/operator-terminal-channel-audit.js';

// Root ของ Repository คำนวณจากตำแหน่ง Script เพื่อให้รันได้จาก Working directory ใดก็ได้
const SCRIPT_FILE = fileURLToPath(import.meta.url);
const PROJECT_ROOT = path.resolve(path.dirname(SCRIPT_FILE), '..');
const SOURCE_ROOTS = Object.freeze(['apps', 'packages', 'scripts']);
const SOURCE_EXTENSIONS = Object.freeze(['.js', '.mjs']);

// แยก Pattern ตามชนิด Declaration เพื่อลด False positive จากคำว่า import ใน Comment/String
const IMPORT_DECLARATION_PATTERN = /^\s*import(?:\s+[\s\S]*?\s+from\s+)?\s*['"]([^'"]+)['"]\s*;?/gmu;
const EXPORT_FROM_PATTERN = /^\s*export\s+(?:\*|\{[\s\S]*?\})\s+from\s+['"]([^'"]+)['"]\s*;?/gmu;
const DYNAMIC_IMPORT_PATTERN = /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/gu;

/**
 * ตรวจ Dependency graph ของ Source code ทั้งโปรเจกต์
 * - Relative import ต้องชี้ไปยังไฟล์จริง
 * - Shared/Domain/Config/Sync engine ห้ามย้อนกลับไปพึ่ง Layer ระดับสูงกว่า
 * - Dependency graph ต้องไม่มีวงจร
 * - Operator/Terminal ที่ผู้ใช้อาจรันต้องผ่าน All-channel reliability policy
 */
async function main() {
  const files = (await Promise.all(
    SOURCE_ROOTS.map((directory) => collectSourceFiles(path.join(PROJECT_ROOT, directory))),
  )).flat().sort();
  const fileSet = new Set(files);
  const graph = new Map(files.map((file) => [file, []]));
  const violations = [];

  for (const file of files) {
    const source = await readFile(file, 'utf8');
    for (const specifier of readImportSpecifiers(source)) {
      if (!specifier.startsWith('.')) continue;
      const resolved = resolveRelativeImport(file, specifier, fileSet);
      if (!resolved) {
        violations.push(`Unresolved relative import: ${relative(file)} -> ${specifier}`);
        continue;
      }
      graph.get(file).push(resolved);
      const layerViolation = validateLayerDirection(file, resolved);
      if (layerViolation) violations.push(layerViolation);
    }
  }

  const cycles = findCycles(graph);
  for (const cycle of cycles) {
    violations.push(`Circular dependency: ${cycle.map(relative).join(' -> ')}`);
  }

  const terminalAudit = await auditOperatorTerminalChannels({ projectRoot: PROJECT_ROOT });
  for (const violation of terminalAudit.violations) {
    violations.push(`Operator terminal reliability: ${JSON.stringify(violation)}`);
  }

  if (violations.length > 0) {
    console.error('Architecture audit failed:');
    for (const violation of violations) console.error(`- ${violation}`);
    process.exitCode = 1;
    return;
  }

  const edgeCount = [...graph.values()].reduce((total, dependencies) => total + dependencies.length, 0);
  const entryByPath = new Map(terminalAudit.entries.map((entry) => [entry.path, entry]));
  const requiredChannelStatuses = Object.fromEntries(
    Object.entries(terminalAudit.requiredChannels).map(([channel, entrypoint]) => [channel, {
      entrypoint,
      status: entryByPath.get(entrypoint)?.status ?? 'MISSING',
    }]),
  );
  const changedEntrypoints = terminalAudit.entries
    .filter((entry) => entry.changedInBranch)
    .map((entry) => ({ path: entry.path, status: entry.status }));

  console.log(
    `Architecture audit passed: ${files.length} source files, ${edgeCount} local dependencies, 0 cycles, `
    + `${terminalAudit.candidateCount} operator entrypoints audited, 0 terminal policy violations`,
  );
  console.log(`Operator terminal audit status counts: ${JSON.stringify(terminalAudit.statusCounts)}`);
  console.log(`Operator terminal required channels: ${JSON.stringify(requiredChannelStatuses)}`);
  console.log(`Operator terminal changed entrypoints: ${JSON.stringify(changedEntrypoints)}`);
}

/** เดิน Directory แบบ Recursive และคืนเฉพาะไฟล์ JavaScript ที่เป็น Source code */
async function collectSourceFiles(directory) {
  const directoryStat = await safeStat(directory);
  if (!directoryStat?.isDirectory()) return [];

  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) return collectSourceFiles(absolute);
    return SOURCE_EXTENSIONS.includes(path.extname(entry.name)) ? [absolute] : [];
  }));
  return nested.flat();
}

/** อ่าน Module specifier จาก Static/Dynamic imports โดยไม่ประมวลผลโค้ด */
function readImportSpecifiers(source) {
  const specifiers = [];
  for (const pattern of [IMPORT_DECLARATION_PATTERN, EXPORT_FROM_PATTERN, DYNAMIC_IMPORT_PATTERN]) {
    pattern.lastIndex = 0;
    for (const match of source.matchAll(pattern)) specifiers.push(match[1]);
  }
  return specifiers;
}

/** Resolve Relative import ตามกฎ ESM ที่โปรเจกต์ใช้ และปฏิเสธ path ที่ไม่มีจริง */
function resolveRelativeImport(importer, specifier, fileSet) {
  const base = path.resolve(path.dirname(importer), specifier);
  const candidates = path.extname(base)
    ? [base]
    : [
      ...SOURCE_EXTENSIONS.map((extension) => `${base}${extension}`),
      ...SOURCE_EXTENSIONS.map((extension) => path.join(base, `index${extension}`)),
    ];
  return candidates.find((candidate) => fileSet.has(candidate)) ?? null;
}

/**
 * บังคับ Dependency direction เฉพาะ Layer ล่างที่ต้องเป็นอิสระ
 * Application/Connector/App ยังประกอบกันที่ Runtime ได้ แต่ Layer พื้นฐานห้ามย้อนขึ้นด้านบน
 */
function validateLayerDirection(importer, dependency) {
  const from = relative(importer);
  const to = relative(dependency);

  const rules = [
    {
      prefix: 'packages/shared/',
      allowed: ['packages/shared/'],
      message: 'Shared layer must not depend on another project layer',
    },
    {
      prefix: 'packages/domain/',
      allowed: ['packages/domain/', 'packages/shared/'],
      message: 'Domain layer may depend only on Domain/Shared',
    },
    {
      prefix: 'packages/config/',
      allowed: ['packages/config/', 'packages/shared/'],
      message: 'Config layer may depend only on Config/Shared',
    },
    {
      prefix: 'packages/sync-engine/',
      allowed: ['packages/sync-engine/', 'packages/shared/'],
      message: 'Sync engine may depend only on Sync engine/Shared',
    },
  ];

  const rule = rules.find((candidate) => from.startsWith(candidate.prefix));
  if (!rule || rule.allowed.some((prefix) => to.startsWith(prefix))) return null;
  return `${rule.message}: ${from} -> ${to}`;
}

/** หา Cycle ด้วย Depth-first search และ Deduplicate cycle ที่เริ่มคนละ Node */
function findCycles(graph) {
  const state = new Map();
  const stack = [];
  const cycles = new Map();

  /** เดิน Dependency graph จาก Node ปัจจุบันและเก็บ Cycle ที่ย้อนกลับเข้า Stack */
  function visit(node) {
    state.set(node, 'visiting');
    stack.push(node);

    for (const dependency of graph.get(node) ?? []) {
      if (state.get(dependency) === 'visiting') {
        const start = stack.indexOf(dependency);
        const cycle = [...stack.slice(start), dependency];
        cycles.set(canonicalCycleKey(cycle), cycle);
      } else if (!state.has(dependency)) {
        visit(dependency);
      }
    }

    stack.pop();
    state.set(node, 'visited');
  }

  for (const node of graph.keys()) {
    if (!state.has(node)) visit(node);
  }
  return [...cycles.values()];
}

/** สร้าง Key ของ Cycle ที่ไม่ขึ้นกับ Node เริ่มต้น เพื่อไม่รายงานวงจรเดียวกันซ้ำ */
function canonicalCycleKey(cycle) {
  const nodes = cycle.slice(0, -1).map(relative);
  const rotations = nodes.map((_, index) => [...nodes.slice(index), ...nodes.slice(0, index)].join(' -> '));
  return rotations.sort()[0];
}

/** แปลง Absolute path เป็น Path สั้นแบบ POSIX สำหรับ Log ที่อ่านง่ายข้ามระบบปฏิบัติการ */
function relative(file) {
  return path.relative(PROJECT_ROOT, file).split(path.sep).join('/');
}

/** Stat แบบไม่โยน Error เมื่อ Directory ไม่มี เพื่อรองรับ Root ที่ยังไม่สร้างใน Release แรก */
async function safeStat(file) {
  try {
    return await stat(file);
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
}

await main();