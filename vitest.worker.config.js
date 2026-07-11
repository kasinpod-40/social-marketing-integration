import { cloudflareTest } from '@cloudflare/vitest-pool-workers';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: './wrangler.sync.example.jsonc' },
    }),
  ],
  test: {
    include: ['tests/worker-runtime/**/*.test.js'],
  },
});
