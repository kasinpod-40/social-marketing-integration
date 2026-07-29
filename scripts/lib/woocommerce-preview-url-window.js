const EXACT_DISABLED_STATE = Object.freeze({ enabled: false, previewsEnabled: false });
const EXACT_ACTIVE_STATE = Object.freeze({ enabled: false, previewsEnabled: true });

export function parseWooCommercePreviewUrlState(payload, label = 'previewUrlState') {
  const body = requireObject(payload, label);
  if (body.success !== true) {
    throw previewWindowError(
      'Cloudflare Worker subdomain response was not successful',
      'WOOCOMMERCE_PREVIEW_URL_WINDOW_API_FAILED',
      {
        label,
        errorCodes: Array.isArray(body.errors)
          ? body.errors.map((item) => item?.code ?? null).filter((value) => value !== null)
          : [],
      },
    );
  }
  const result = requireObject(body.result, `${label}.result`);
  if (typeof result.enabled !== 'boolean' || typeof result.previews_enabled !== 'boolean') {
    throw previewWindowError(
      'Cloudflare Worker subdomain response did not contain exact boolean settings',
      'WOOCOMMERCE_PREVIEW_URL_WINDOW_STATE_INVALID',
      { label },
    );
  }
  return Object.freeze({
    enabled: result.enabled,
    previewsEnabled: result.previews_enabled,
  });
}

export function assertWooCommercePreviewUrlBaseline(state) {
  return assertExactState(
    state,
    EXACT_DISABLED_STATE,
    'WOOCOMMERCE_PREVIEW_URL_WINDOW_BASELINE_INVALID',
    'WooCommerce Preview URL window requires workers.dev and Preview URLs to start disabled',
  );
}

export function assertWooCommercePreviewUrlActive(state) {
  return assertExactState(
    state,
    EXACT_ACTIVE_STATE,
    'WOOCOMMERCE_PREVIEW_URL_WINDOW_ENABLE_FAILED',
    'WooCommerce Preview URL window did not enable Preview URLs while keeping workers.dev disabled',
  );
}

export function assertWooCommercePreviewUrlRestored(state) {
  return assertExactState(
    state,
    EXACT_DISABLED_STATE,
    'WOOCOMMERCE_PREVIEW_URL_WINDOW_RESTORE_FAILED',
    'WooCommerce Preview URL window did not restore workers.dev and Preview URLs to disabled',
  );
}

export function buildWooCommercePreviewUrlMutation(previewsEnabled) {
  if (typeof previewsEnabled !== 'boolean') {
    throw previewWindowError(
      'previewsEnabled must be boolean',
      'WOOCOMMERCE_PREVIEW_URL_WINDOW_INPUT_INVALID',
    );
  }
  return Object.freeze({
    enabled: false,
    previews_enabled: previewsEnabled,
  });
}

function assertExactState(stateInput, expected, code, message) {
  const state = requireObject(stateInput, 'state');
  const observed = {
    enabled: state.enabled,
    previewsEnabled: state.previewsEnabled,
  };
  if (observed.enabled !== expected.enabled
    || observed.previewsEnabled !== expected.previewsEnabled) {
    throw previewWindowError(message, code, { observed, expected });
  }
  return Object.freeze(observed);
}

function requireObject(value, fieldName) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw previewWindowError(
      `${fieldName} must be an object`,
      'WOOCOMMERCE_PREVIEW_URL_WINDOW_INPUT_INVALID',
      { fieldName },
    );
  }
  return value;
}

function previewWindowError(message, code, details = {}) {
  const error = new Error(message);
  error.name = 'WooCommercePreviewUrlWindowError';
  error.code = code;
  error.details = details;
  return error;
}
