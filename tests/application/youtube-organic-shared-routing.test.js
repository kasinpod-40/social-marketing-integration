import test from 'node:test';
import assert from 'node:assert/strict';
import { JOB_TYPES } from '../../packages/application/src/jobs/job-catalog.js';
import {
  createYouTubeOrganicActiveJobRouter,
  selectYouTubeOrganicActiveRoute,
} from '../../apps/sync-worker/src/youtube-organic-active-job-router.js';
import {
  readYouTubeEndToEndRuntimeConfig,
} from '../../packages/config/src/youtube-organic-runtime-config.js';

function youtubeInput(env = {}) {
  return {
    env,
    job: { body: { type: JOB_TYPES.YOUTUBE_ORGANIC_SYNC } },
  };
}

test('YouTube rollout flags default false and reject invalid values', () => {
  assert.deepEqual(readYouTubeEndToEndRuntimeConfig({}), {
    endToEndEnabled: false,
    larkWriteEnabled: false,
  });
  assert.deepEqual(readYouTubeEndToEndRuntimeConfig({
    MKT_YOUTUBE_END_TO_END_ENABLED: 'true',
    MKT_YOUTUBE_LARK_WRITE_ENABLED: true,
  }), {
    endToEndEnabled: true,
    larkWriteEnabled: true,
  });
  assert.throws(
    () => readYouTubeEndToEndRuntimeConfig({ MKT_YOUTUBE_END_TO_END_ENABLED: 'yes' }),
    (error) => error.code === 'MKT_YOUTUBE_RUNTIME_CONFIG_INVALID',
  );
});

test('shared router preserves the legacy route while the new gate is false', async () => {
  const events = [];
  const router = createYouTubeOrganicActiveJobRouter({
    async processEndToEnd() {
      events.push('end_to_end');
      return 'end_to_end';
    },
    async processFallback() {
      events.push('fallback');
      return 'fallback';
    },
  });

  assert.equal(selectYouTubeOrganicActiveRoute(youtubeInput()), 'fallback');
  assert.equal(await router(youtubeInput()), 'fallback');
  assert.deepEqual(events, ['fallback']);
});

test('shared router selects D1-first YouTube only when the dedicated gate is true', async () => {
  const events = [];
  const router = createYouTubeOrganicActiveJobRouter({
    async processEndToEnd() {
      events.push('end_to_end');
      return 'end_to_end';
    },
    async processFallback() {
      events.push('fallback');
      return 'fallback';
    },
  });
  const input = youtubeInput({ MKT_YOUTUBE_END_TO_END_ENABLED: 'true' });

  assert.equal(selectYouTubeOrganicActiveRoute(input), 'end_to_end');
  assert.equal(await router(input), 'end_to_end');
  assert.deepEqual(events, ['end_to_end']);
});

test('non-YouTube jobs always remain in the existing router chain', async () => {
  const router = createYouTubeOrganicActiveJobRouter({
    async processEndToEnd() {
      throw new Error('unexpected YouTube route');
    },
    async processFallback() {
      return 'fallback';
    },
  });
  const input = {
    env: { MKT_YOUTUBE_END_TO_END_ENABLED: 'true' },
    job: { body: { type: JOB_TYPES.TIKTOK_CREATOR_NATIVE_SYNC } },
  };

  assert.equal(selectYouTubeOrganicActiveRoute(input), 'fallback');
  assert.equal(await router(input), 'fallback');
});
