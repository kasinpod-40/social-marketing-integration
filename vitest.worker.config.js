import {
  cloudflareTest,
  readD1Migrations,
} from '@cloudflare/vitest-pool-workers';
import { defineConfig } from 'vitest/config';

const d1Migrations = await readD1Migrations('./migrations');

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: './wrangler.sync.example.jsonc' },
      miniflare: {
        bindings: { TEST_D1_MIGRATIONS: d1Migrations },
      },
    }),
  ],
  test: {
    include: ['tests/worker-runtime/**/*.test.js'],
  },
});
