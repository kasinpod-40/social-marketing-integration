import { permanentError } from '../../shared/src/errors/runtime-error.js';

/**
 * Google Ads View closeout is update-only.
 * Missing managed Views must block instead of silently creating new presentation state.
 */
export function assertGoogleAdsViewFilterUpdateOnly(preview) {
  const actions = Array.isArray(preview?.actions) ? preview.actions : [];
  const createViews = Number(preview?.summary?.createViews ?? 0);
  const unexpected = actions.filter((action) => action?.kind !== 'update_view');

  if (createViews > 0 || unexpected.length > 0) {
    throw createForbiddenError({ createViews, actions: unexpected });
  }

  return preview;
}

/**
 * Guard the actual mutation boundary as well as Preview.
 * This closes the race where a managed View disappears after Preview but before Apply re-plans.
 */
export function createGoogleAdsUpdateOnlyClient(client) {
  if (!client || typeof client !== 'object') {
    throw new TypeError('Google Ads update-only guard requires a Lark client');
  }

  return new Proxy(client, {
    get(target, property, receiver) {
      if (property === 'createView') {
        return async (input = {}) => {
          throw createForbiddenError({
            createViews: 1,
            actions: [{
              kind: 'create_view',
              tableKey: input.tableKey ?? null,
              viewKey: input.viewKey ?? null,
              viewName: input.viewName ?? null,
            }],
          });
        };
      }

      const value = Reflect.get(target, property, receiver);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}

function createForbiddenError({ createViews, actions }) {
  return permanentError('Google Ads View filter operation is update-only and cannot create Views', {
    code: 'GOOGLE_ADS_VIEW_FILTER_CREATE_FORBIDDEN',
    details: {
      createViews,
      unexpectedActions: actions.map((action) => ({
        kind: action?.kind ?? null,
        tableKey: action?.tableKey ?? null,
        viewKey: action?.viewKey ?? null,
        viewName: action?.viewName ?? null,
      })),
    },
  });
}
