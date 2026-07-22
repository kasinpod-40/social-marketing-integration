import { permanentError } from '../../../shared/src/errors/runtime-error.js';

/**
 * Google Ads View Filter closeout อนุญาตเฉพาะ update_view เท่านั้น.
 * Missing View ต้องหยุดแบบ fail-closed และห้ามไหลเข้า generic createView path.
 */
export function assertGoogleAdsViewFilterPlanSafe(plan) {
  if (!plan || typeof plan !== 'object') {
    throw new TypeError('Google Ads View filter guard requires a Preview plan');
  }

  if (plan.readyToApply !== true) {
    throw permanentError('Google Ads View filter Preview is not ready to apply', {
      code: 'GOOGLE_ADS_VIEW_FILTER_PREVIEW_BLOCKED',
      details: {
        conflicts: Array.isArray(plan.conflicts) ? plan.conflicts.length : null,
        warnings: Array.isArray(plan.warnings) ? plan.warnings.length : null,
      },
    });
  }

  const actions = Array.isArray(plan.actions) ? plan.actions : [];
  const createActions = actions.filter((action) => action?.kind === 'create_view');
  const unsupportedActions = actions.filter((action) => action?.kind !== 'update_view');
  const createCount = Number(plan.summary?.createViews ?? createActions.length);

  if (createCount !== 0 || createActions.length !== 0) {
    throw permanentError('Google Ads View filter task cannot create missing Views', {
      code: 'GOOGLE_ADS_VIEW_FILTER_VIEW_MISSING_NO_CREATE',
      details: {
        createViews: createCount,
        viewNames: createActions.map((action) => action?.viewName ?? null),
      },
    });
  }

  if (unsupportedActions.length !== 0) {
    throw permanentError('Google Ads View filter task contains a non-update action', {
      code: 'GOOGLE_ADS_VIEW_FILTER_ACTION_NOT_ALLOWED',
      details: {
        actions: unsupportedActions.map((action) => ({
          kind: action?.kind ?? null,
          viewName: action?.viewName ?? null,
        })),
      },
    });
  }

  return plan;
}

/**
 * Defense in depth สำหรับ race ระหว่าง pre-Apply Preview กับ generic Apply Preview.
 * เมธอดอื่น bind กลับไปยัง client เดิม; createView ถูกแทนด้วย Permanent error เสมอ.
 */
export function createNoCreateLarkViewClient(client) {
  if (!client || typeof client !== 'object') {
    throw new TypeError('Google Ads View filter guard requires a Lark client');
  }

  return new Proxy(client, {
    get(target, property, receiver) {
      if (property === 'createView') {
        return async () => {
          throw permanentError('Google Ads View filter task cannot create Views', {
            code: 'GOOGLE_ADS_VIEW_FILTER_CREATE_FORBIDDEN',
          });
        };
      }

      const value = Reflect.get(target, property, receiver);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}
