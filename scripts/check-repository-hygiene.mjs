import { access, lstat, readFile, readdir } from 'node:fs/promises';
import { constants } from 'node:fs';
import { join, relative } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = process.cwd();
const issues = [];

await requireFile('.dev.vars.example');
await requireFile('AGENTS.md');
await requireFile('docs/current-task.md');
await scanForDsStore(root);
checkTrackedDsStore();
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

async function scanForDsStore(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === '.wrangler') continue;
    const fullPath = join(directory, entry.name);
    if (entry.isDirectory()) {
      await scanForDsStore(fullPath);
    } else if (entry.name === '.DS_Store') {
      issues.push(`Unexpected .DS_Store: ${relative(root, fullPath)}`);
    }
  }
}

function checkTrackedDsStore() {
  const result = spawnSync('git', ['ls-files'], { cwd: root, encoding: 'utf8' });
  if (result.status !== 0) return;
  const tracked = result.stdout.split(/\r?\n/u).filter((path) => /(^|\/)\.DS_Store$/u.test(path));
  for (const path of tracked) issues.push(`Tracked .DS_Store: ${path}`);
}


function checkTrackedLocalOnlyFiles() {
  const result = spawnSync('git', ['ls-files'], { cwd: root, encoding: 'utf8' });
  if (result.status !== 0) return;
  const tracked = new Set(result.stdout.split(/\r?\n/u).filter(Boolean));
  for (const path of ['.dev.vars', 'wrangler.sync.jsonc']) {
    if (tracked.has(path)) {
      issues.push(`Tracked local-only file: ${path}; run git rm --cached ${path}`);
    }
  }
}

async function checkDevVarsPermission() {
  const path = join(root, '.dev.vars');
  try {
    const stat = await lstat(path);
    if (process.platform !== 'win32' && (stat.mode & 0o077) !== 0) {
      issues.push('.dev.vars permissions are too open; run chmod 600 .dev.vars');
    }
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
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
