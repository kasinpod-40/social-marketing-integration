import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { promisify } from 'node:util';
import {
  findBlockedReleasePaths,
  findDuplicateArtifactHashes,
  findMissingRequiredReleasePaths,
  normalizeReleasePath,
  parseManifestFilePaths,
  RELEASE_MANIFEST_PATH,
  scanReleaseTextFiles,
} from './release-archive-policy.js';

const execFileAsync = promisify(execFile);
const MAX_COMMAND_OUTPUT_BYTES = 20 * 1024 * 1024;
const MAX_TEXT_SCAN_BYTES = 2 * 1024 * 1024;

/** ตรวจ Archive จริงหลังสร้าง โดย Extract ไป Temporary directory และไม่แตะ Workspace source */
export async function verifyReleaseArchive(input = {}) {
  const archivePath = resolve(requireText(input.archivePath, 'archivePath'));
  const { stdout } = await execFileAsync('unzip', ['-Z1', archivePath], {
    maxBuffer: MAX_COMMAND_OUTPUT_BYTES,
  });
  const rawEntries = stdout.split(/\r?\n/u).filter(Boolean);
  const filePaths = rawEntries
    .filter((entry) => !entry.endsWith('/'))
    .map(normalizeReleasePath)
    .sort();
  const duplicateEntryPaths = findDuplicateValues(filePaths);
  const blockedPaths = findBlockedReleasePaths(filePaths);
  const missingPaths = findMissingRequiredReleasePaths(filePaths);
  const extractionRoot = await mkdtemp(join(tmpdir(), 'social-mkt-release-verify-'));

  try {
    await execFileAsync('unzip', ['-qq', archivePath, '-d', extractionRoot], {
      maxBuffer: MAX_COMMAND_OUTPUT_BYTES,
    });
    const artifacts = [];
    const textFiles = [];
    for (const path of filePaths) {
      const buffer = await readFile(join(extractionRoot, path));
      artifacts.push({ path, sha256: sha256(buffer) });
      if (buffer.length <= MAX_TEXT_SCAN_BYTES && !buffer.includes(0)) {
        textFiles.push({ path, content: buffer.toString('utf8') });
      }
    }

    const duplicateArtifacts = findDuplicateArtifactHashes(artifacts);
    const sensitiveFindings = scanReleaseTextFiles(textFiles);
    const manifest = await readFile(join(extractionRoot, RELEASE_MANIFEST_PATH), 'utf8');
    const manifestPaths = parseManifestFilePaths(manifest);
    const manifestMismatch = comparePathSets(filePaths, manifestPaths);
    const issues = [
      ...duplicateEntryPaths.map((path) => `Duplicate ZIP entry: ${path}`),
      ...blockedPaths.map((path) => `Blocked release path: ${path}`),
      ...missingPaths.map((path) => `Missing required release path: ${path}`),
      ...duplicateArtifacts.map((entry) => `Duplicate artifact ${entry.sha256}: ${entry.paths.join(', ')}`),
      ...sensitiveFindings.map((entry) => `${entry.code} in ${entry.path}: ${entry.message}`),
      ...manifestMismatch.map((message) => `Manifest mismatch: ${message}`),
    ];
    if (issues.length > 0) {
      throw new Error(`Release archive verification failed:\n- ${issues.join('\n- ')}`);
    }

    return Object.freeze({
      ok: true,
      archivePath,
      fileCount: filePaths.length,
      blockedPathCount: 0,
      missingPathCount: 0,
      sensitiveFindingCount: 0,
      duplicateArtifactCount: 0,
      manifestEntryCount: manifestPaths.length,
    });
  } finally {
    await rm(extractionRoot, { recursive: true, force: true });
  }
}

function comparePathSets(actual, declared) {
  const actualSet = new Set(actual);
  const declaredSet = new Set(declared);
  const issues = [];
  for (const path of actualSet) {
    if (!declaredSet.has(path)) issues.push(`archive-only ${path}`);
  }
  for (const path of declaredSet) {
    if (!actualSet.has(path)) issues.push(`manifest-only ${path}`);
  }
  return issues.sort();
}

function findDuplicateValues(values) {
  const seen = new Set();
  const duplicates = new Set();
  for (const value of values) {
    if (seen.has(value)) duplicates.add(value);
    seen.add(value);
  }
  return [...duplicates].sort();
}

function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

function requireText(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') throw new TypeError(`${fieldName} is required`);
  return value.trim();
}
