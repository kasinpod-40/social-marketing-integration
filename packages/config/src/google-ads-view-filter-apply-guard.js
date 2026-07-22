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
    throw permanentError('Google Ads View filter operation is update-only and cannot create Views', {
      code: 'GOOGLE_ADS_VIEW_FILTER_CREATE_FORBIDDEN',
      details: {
        createViews,
        unexpectedActions: unexpected.map((action) => ({
          kind: action?.kind ?? null,
          tableKey: action?.tableKey ?? null,
          viewKey: action?.viewKey ?? null,
          viewName: action?.viewName ?? null,
        })),
      },
    });
  }

  return preview;
}
