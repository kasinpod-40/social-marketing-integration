import { json } from '../../../packages/shared/src/http/response.js';

const ROUTES = new Map([
  ['GET /health', handleHealth],
  ['GET /project-brain', handleProjectBrainStatus],
]);

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const routeKey = `${request.method} ${url.pathname}`;
    const handler = ROUTES.get(routeKey);

    if (!handler) {
      return json({ ok: false, error: 'Route not found', path: url.pathname }, { status: 404 });
    }

    try {
      return await handler({ request, env, ctx, url });
    } catch (error) {
      return json(
        {
          ok: false,
          error: 'Unhandled API error',
          message: error instanceof Error ? error.message : 'Unknown error',
        },
        { status: 500 },
      );
    }
  },
};

async function handleHealth({ env }) {
  return json({
    ok: true,
    service: 'social-mkt-api-worker',
    env: env?.APP_ENV ?? 'unknown',
    timezone: env?.DEFAULT_TIMEZONE ?? 'Asia/Bangkok',
  });
}

async function handleProjectBrainStatus() {
  return json({
    ok: true,
    projectBrainRequired: true,
    currentPhase: 'phase0-foundation',
    rules: ['native-first', 'snapshot-first', 'metric-definition-strictness', 'monitoring-from-day-one'],
  });
}
