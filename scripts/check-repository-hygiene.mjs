import { access, readFile, readdir } from 'node:fs/promises';
import { constants } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { findBlockedReleasePaths } from './lib/release-archive-policy.js';
import { inspectLocalSecretFile } from './lib/local-secret-file-policy.js';

const root = process.cwd();
const issues = [];

await requireFile('.dev.vars.example');
await requireFile('AGENTS.md');
await requireFile('docs/current-task.md');
await requireFile('docs/Social_MKT_Data_Hub_Multi_Channel_Blueprint_v0.10.2.xlsx');
await requireFile('scripts/package-clean-release.mjs');
await requireFile('scripts/verify-release-archive.mjs');
await scanForMacMetadata(root);
await checkGeneratedRootArtifacts();
checkTrackedLocalOnlyFiles();
await checkDevVarsPermission();
await checkPortablePackageLock();

if (issues.length > 0) {
  console.error('Repository hygiene check failed:');
  for (const issue of issues) console.error(`- ${issue}`);
  process.exitCode = 1;
} else {
  console.log('Repository hygiene check passed');
}

async function requireFile(path) {
  try {
    await access(join(root, path), constants.R_OK);
  } catch {
    issues.push(`Missing required file: ${path}`);
  }
}

async function scanForMacMetadata(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    if (['node_modules', '.git', '.wrangler', 'outputs', 'coverage', 'dist', 'tmp', 'temp'].includes(entry.name)) {
      continue;
    }
    const fullPath = join(directory, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === '__MACOSX') issues.push(`Unexpected __MACOSX: ${relative(root, fullPath)}`);
      else await scanForMacMetadata(fullPath);
    } else if (entry.name === '.DS_Store' || entry.name.startsWith('._')) {
      issues.push(`Unexpected macOS metadata: ${relative(root, fullPath)}`);
    }
  }
}

async function checkGeneratedRootArtifacts() {
  if (!isRepositorySourceRoot()) return;

  for (const path of ['RELEASE_MANIFEST.txt']) {
    try {
      await access(join(root, path), constants.F_OK);
      issues.push(`Generated release artifact must not exist in source root: ${path}`);
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
  }
}

function isRepositorySourceRoot() {
  const result = spawnSync('git', ['rev-parse', '--show-toplevel'], {
    cwd: root,
    encoding: 'utf8',
  });
  if (result.status !== 0) return false;
  return resolve(result.stdout.trim()) === resolve(root);
}

function checkTrackedLocalOnlyFiles() {
  const result = spawnSync('git', ['ls-files'], { cwd: root, encoding: 'utf8' });
  if (result.status !== 0) return;
  const trackedPaths = result.stdout.split(/\r?\n/u).filter(Boolean);
  const tracked = new Set(trackedPaths);
  for (const path of ['.dev.vars', 'wrangler.sync.jsonc']) {
    if (tracked.has(path)) {
      issues.push(`Tracked local-only file: ${path}; run git rm --cached ${path}`);
    }
  }
  for (const path of findBlockedReleasePaths(trackedPaths)) {
    issues.push(`Tracked release-blocked path: ${path}`);
  }
}

async function checkDevVarsPermission() {
  try {
    const inspection = await inspectLocalSecretFile(join(root, '.dev.vars'), {
      expectedBasename: '.dev.vars',
    });
    if (inspection.exists && !inspection.ownerOnly) {
      issues.push('.dev.vars target permissions are too open; run chmod 600 on the target file');
    }
  } catch (error) {
    issues.push(`Invalid .dev.vars local secret: ${error?.message ?? String(error)}`);
  }
}

async function checkPortablePackageLock() {
  const path = join(root, 'package-lock.json');
  let lock;
  try {
    lock = JSON.parse(await readFile(path, 'utf8'));
  } catch (error) {
    issues.push(`Cannot read package-lock.json: ${error?.message ?? String(error)}`);
    return;
  }

  for (const [packagePath, metadata] of Object.entries(lock.packages ?? {})) {
    const resolved = metadata?.resolved;
    if (typeof resolved !== 'string' || !resolved.startsWith('https://')) continue;

    let hostname;
    try {
      hostname = new URL(resolved).hostname;
    } catch {
      issues.push(`Invalid resolved URL in package-lock.json (${packagePath || '<root>'}): ${resolved}`);
      continue;
    }

    if (hostname !== 'registry.npmjs.org') {
      issues.push(
        `Non-portable npm registry URL in package-lock.json (${packagePath || '<root>'}): ${hostname}`,
      );
    }
  }
}
