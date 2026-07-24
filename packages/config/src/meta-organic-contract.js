/** Shared transport/auth contract; Facebook และ Instagram business mapping ต้องอยู่คนละ Adapter */
export const META_ORGANIC_CONTRACT_VERSION = 'meta-organic-v1';

export const META_ORGANIC_CONTRACT = deepFreeze({
  transport: {
    apiVersion: 'required_runtime_config',
    auth: 'bearer_access_token',
    pagination: 'cursor_after_until_paging_next_absent',
    cursorPersistence: 'forbidden',
  },
  facebook: {
    identity: 'page_id',
    token: 'page_access_token',
    preflightToken: 'facebook_user_or_system_user_access_token',
    tokenEnv: 'META_ACCESS_TOKEN',
    identityEnv: 'META_FACEBOOK_PAGE_ID',
    ownershipGuard: 'selected_page_id_must_match_response_page_id',
    adapter: 'facebook_page_adapter_required',
  },
  instagram: {
    identity: 'instagram_business_account_id',
    linkedAsset: 'facebook_page_id',
    loginMode: 'instagram_login',
    tokenEnv: 'META_INSTAGRAM_ACCESS_TOKEN',
    identityEnv: 'META_INSTAGRAM_ACCOUNT_ID',
    ownershipGuard: 'selected_ig_account_id_must_match_response_account_id',
    adapter: 'instagram_business_adapter_required',
  },
  activation: {
    defaultEnabled: false,
    implementationStatus: 'uat_pending',
    required: ['app_roles_or_advanced_access', 'live_dev_assets', 'token_lifecycle_uat'],
  },
});

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}
