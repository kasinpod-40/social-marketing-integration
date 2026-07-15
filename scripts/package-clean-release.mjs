import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import {
  findBlockedReleasePaths,
  findMissingRequiredReleasePaths,
  normalizeReleasePath,
  RELEASE_MANIFEST_PATH,
} from './lib/release-archive-policy.js';
import { verifyReleaseArchive } from './lib/release-archive-verifier.js';

const execFileAsync = promisify(execFile);
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const packageMetadata = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
const version = requireText(packageMetadata.version, 'package.json version');
const outputDirectory = join(root, 'outputs', 'releases');
const archivePath = join(outputDirectory, `social-marketing-integration-v${version}.zip`);
const checksumPath = `${archivePath}.sha256`;
const manifestOutputPath = archivePath.replace(/\.zip$/u, '.manifest.txt');
const verificationPath = archivePath.replace(/\.zip$/u, '.verification.json');
const stageParent = await mkdtemp(join(tmpdir(), 'social-mkt-release-package-'));
const stageRoot = join(stageParent, `social-marketing-integration-v${version}`);

try {
  const files = await listSourceFiles();
  const blocked = findBlockedReleasePaths(files);
  const missing = findMissingRequiredReleasePaths(files, { includeManifest: false });
  if (blocked.length > 0 || missing.length > 0) {
    throw new Error([
      ...blocked.map((path) => `Blocked source path: ${path}`),
      ...missing.map((path) => `Missing required source path: ${path}`),
    ].join('\n'));
  }

  await mkdir(stageRoot, { recursive: true });
  for (const path of files) {
    const destination = join(stageRoot, path);
    await mkdir(dirname(destination), { recursive: true });
    await copyFile(join(root, path), destination);
  }

  const commit = (await execFileAsync('git', ['rev-parse', 'HEAD'], { cwd: root })).stdout.trim();
  const dirty = (await execFileAsync('git', ['status', '--porcelain'], { cwd: root })).stdout.trim() !== '';
  const archiveFiles = [...files, RELEASE_MANIFEST_PATH].sort();
  const manifest = buildManifest({ version, commit, dirty, files: archiveFiles });
  await writeFile(join(stageRoot, RELEASE_MANIFEST_PATH), manifest, 'utf8');

  await mkdir(outputDirectory, { recursive: true });
  await rm(archivePath, { force: true });
  await execFileAsync('zip', ['-X', '-q', '-r', archivePath, '.'], { cwd: stageRoot });
  const archiveBuffer = await readFile(archivePath);
  const checksum = sha256(archiveBuffer);
  await writeFile(checksumPath, `${checksum}  ${archivePath.split('/').at(-1)}\n`, 'utf8');
  await writeFile(manifestOutputPath, manifest, 'utf8');

  const verification = await verifyReleaseArchive({ archivePath });
  const result = Object.freeze({
    ok: true,
    version,
    sourceCommit: commit,
    sourceTreeDirty: dirty,
    archivePath,
    checksumPath,
    manifestPath: manifestOutputPath,
    verificationPath,
    sha256: checksum,
    ...verification,
  });
  await writeFile(verificationPath, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  console.error(error?.stack ?? String(error));
  process.exitCode = 1;
} finally {
  await rm(stageParent, { recursive: true, force: true });
}

async function listSourceFiles() {
  const { stdout } = await execFileAsync(
    'git',
    ['ls-files', '--cached', '--others', '--exclude-standard', '-z'],
    { cwd: root, encoding: 'buffer', maxBuffer: 20 * 1024 * 1024 },
  );
  return Object.freeze(stdout.toString('utf8')
    .split('\0')
    .filter(Boolean)
    .map(normalizeReleasePath)
    .sort());
}

function buildManifest(input) {
  return [
    `version\t${input.version}`,
    `source_commit\t${input.commit}`,
    `source_tree_dirty\t${String(input.dirty)}`,
    `generated_at\t${new Date().toISOString()}`,
    ...input.files.map((path) => `file\t${path}`),
    '',
  ].join('\n');
}

function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

function requireText(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') throw new TypeError(`${fieldName} is required`);
  return value.trim();
}
