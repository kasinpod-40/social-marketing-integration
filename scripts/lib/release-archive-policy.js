import { extname, posix } from 'node:path';

export const RELEASE_MANIFEST_PATH = 'RELEASE_MANIFEST.txt';

export const REQUIRED_RELEASE_PATHS = Object.freeze([
  '.dev.vars.example',
  '.gitignore',
  'AGENTS.md',
  'CHANGELOG.md',
  'PROJECT_BRAIN.md',
  'README.md',
  'docs/Social_MKT_Data_Hub_Multi_Channel_Blueprint_v0.10.2.xlsx',
  'docs/current-task.md',
  'docs/youtube-organic-dev-implementation-v0.11.0-rc.1.md',
  'package-lock.json',
  'package.json',
  'scripts/package-clean-release.mjs',
  'scripts/verify-release-archive.mjs',
  'wrangler.sync.example.jsonc',
]);

const BLOCKED_ANYWHERE_SEGMENTS = new Set([
  '.git',
  '__MACOSX',
  'node_modules',
]);
const BLOCKED_ROOT_SEGMENTS = new Set([
  '.cache',
  '.idea',
  '.wrangler',
  'coverage',
  'dist',
  'outputs',
  'release',
  'temp',
  'tmp',
]);
const ARTIFACT_EXTENSIONS = new Set(['.docx', '.pdf', '.pptx', '.xlsx', '.zip']);
const HIGH_CONFIDENCE_SECRET_PATTERNS = Object.freeze([
  ['PRIVATE_KEY', /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/u],
  ['GOOGLE_API_KEY', /\bAIza[0-9A-Za-z_-]{35}\b/u],
  ['GITHUB_TOKEN', /\b(?:ghp|gho|ghu|ghs|github_pat)_[0-9A-Za-z_]{20,}\b/u],
  ['AWS_ACCESS_KEY', /\bAKIA[0-9A-Z]{16}\b/u],
  ['SLACK_TOKEN', /\bxox[baprs]-[0-9A-Za-z-]{20,}\b/u],
]);
const SENSITIVE_ENV_NAME = /(?:_SECRET|_TOKEN|_PASSWORD|API_KEY|ACCESS_KEY|PRIVATE_KEY)$/u;
const LARK_TABLE_ID = /\btbl[0-9A-Za-z]{12,}\b/gu;

export function normalizeReleasePath(input) {
  if (typeof input !== 'string') throw new TypeError('Release path must be a string');
  const normalized = posix.normalize(input.replaceAll('\\', '/').replace(/^\.\//u, ''));
  if (!normalized || normalized === '.' || normalized.startsWith('/') || normalized === '..'
    || normalized.startsWith('../') || normalized.includes('\0')) {
    throw new TypeError(`Unsafe release path: ${input}`);
  }
  return normalized;
}

export function findBlockedReleasePaths(paths) {
  const findings = [];
  for (const input of paths) {
    const path = normalizeReleasePath(input);
    const segments = path.split('/');
    const basename = segments.at(-1);
    if (segments.some((segment) => BLOCKED_ANYWHERE_SEGMENTS.has(segment))
      || BLOCKED_ROOT_SEGMENTS.has(segments[0])
      || basename === '.DS_Store'
      || basename.startsWith('._')
      || basename.endsWith('.log')
      || path === 'wrangler.sync.jsonc'
      || (basename.startsWith('.dev.vars') && basename !== '.dev.vars.example')
      || (basename.startsWith('.env') && basename !== '.env.example')) {
      findings.push(path);
    }
  }
  return Object.freeze(findings.sort());
}

export function findMissingRequiredReleasePaths(paths, options = {}) {
  const required = options.includeManifest === false
    ? REQUIRED_RELEASE_PATHS
    : [...REQUIRED_RELEASE_PATHS, RELEASE_MANIFEST_PATH];
  const present = new Set(paths.map(normalizeReleasePath));
  return Object.freeze(required.filter((path) => !present.has(path)).sort());
}

export function findDuplicateArtifactHashes(entries) {
  const groups = new Map();
  for (const entry of entries) {
    const path = normalizeReleasePath(entry?.path);
    const hash = requireSha256(entry?.sha256, path);
    if (!ARTIFACT_EXTENSIONS.has(extname(path).toLowerCase())) continue;
    const paths = groups.get(hash) ?? [];
    paths.push(path);
    groups.set(hash, paths);
  }
  return Object.freeze([...groups.entries()]
    .filter(([, paths]) => paths.length > 1)
    .map(([sha256, paths]) => Object.freeze({ sha256, paths: Object.freeze(paths.sort()) })));
}

export function scanReleaseTextFiles(files) {
  const findings = [];
  for (const file of files) {
    const path = normalizeReleasePath(file?.path);
    const content = String(file?.content ?? '');
    for (const [code, pattern] of HIGH_CONFIDENCE_SECRET_PATTERNS) {
      if (pattern.test(content)) findings.push({ path, code, message: `พบรูปแบบ ${code}` });
    }

    if (!path.startsWith('tests/')) {
      findings.push(...scanSensitiveAssignments(path, content));
      for (const match of content.matchAll(LARK_TABLE_ID)) {
        findings.push({
          path,
          code: 'DEV_LARK_TABLE_ID',
          message: `พบ Lark Table ID ที่ต้องเก็บใน Local config เท่านั้น: ${mask(match[0])}`,
        });
      }
      findings.push(...scanDatabaseIds(path, content));
    }
  }
  return Object.freeze(findings.map(Object.freeze));
}

export function parseManifestFilePaths(content) {
  return Object.freeze(String(content ?? '')
    .split(/\r?\n/u)
    .filter((line) => line.startsWith('file\t'))
    .map((line) => normalizeReleasePath(line.slice(5)))
    .sort());
}

function scanSensitiveAssignments(path, content) {
  const findings = [];
  const patterns = [
    /^([A-Z][A-Z0-9_]+)\s*=\s*(.*?)\s*$/gmu,
    /["']([A-Z][A-Z0-9_]+)["']\s*:\s*["']([^"']*)["']/gu,
  ];
  for (const pattern of patterns) {
    for (const match of content.matchAll(pattern)) {
      const envName = match[1];
      const value = stripAssignmentDecoration(match[2]);
      if (!SENSITIVE_ENV_NAME.test(envName) || isSafeExampleValue(value)) continue;
      findings.push({
        path,
        code: 'CREDENTIAL_ASSIGNMENT',
        message: `พบค่า ${envName} ที่ไม่ใช่ Placeholder`,
      });
    }
  }
  return findings;
}

function scanDatabaseIds(path, content) {
  const findings = [];
  for (const match of content.matchAll(/["']database_id["']\s*:\s*["']([^"']+)["']/gu)) {
    const value = match[1];
    if (value === '00000000-0000-0000-0000-000000000000' || isSafeExampleValue(value)) continue;
    findings.push({
      path,
      code: 'DEV_D1_DATABASE_ID',
      message: `พบ D1 database_id ที่ต้องเก็บใน Local config เท่านั้น: ${mask(value)}`,
    });
  }
  return findings;
}

function stripAssignmentDecoration(value) {
  return String(value ?? '').trim().replace(/^['"]|['"],?$/gu, '').trim();
}

function isSafeExampleValue(value) {
  const normalized = String(value ?? '').trim().toLowerCase();
  return normalized === ''
    || normalized === '...'
    || normalized.startsWith('replace-')
    || normalized.startsWith('replace_')
    || normalized.startsWith('your-')
    || normalized.startsWith('<')
    || normalized.includes('placeholder')
    || normalized.includes('would-not-be-used')
    || normalized.startsWith('test-')
    || normalized.startsWith('fake-')
    || normalized.startsWith('dummy-');
}

function requireSha256(value, path) {
  if (typeof value !== 'string' || !/^[0-9a-f]{64}$/u.test(value)) {
    throw new TypeError(`Invalid SHA-256 for ${path}`);
  }
  return value;
}

function mask(value) {
  const text = String(value);
  if (text.length <= 8) return '***';
  return `${text.slice(0, 4)}…${text.slice(-4)}`;
}
