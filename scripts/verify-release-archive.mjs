import { verifyReleaseArchive } from './lib/release-archive-verifier.js';

const archivePath = process.argv[2];
if (!archivePath) {
  console.error('Usage: npm run release:verify -- <archive.zip>');
  process.exitCode = 1;
} else {
  try {
    console.log(JSON.stringify(await verifyReleaseArchive({ archivePath }), null, 2));
  } catch (error) {
    console.error(error?.stack ?? String(error));
    process.exitCode = 1;
  }
}
