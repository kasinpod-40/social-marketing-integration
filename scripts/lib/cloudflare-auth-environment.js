const WRANGLER_API_TOKEN_ENV = 'CLOUDFLARE_API_TOKEN';

/**
 * Wrangler ต้องใช้ OAuth session สำหรับ Remote D1 ของ Integration Workspace
 * ขณะที่ process หลักยังเก็บ API Token ไว้สำหรับ Queue API หลัง D1 guard ผ่าน
 */
export function buildWranglerOAuthEnvironment(env = {}) {
  const wranglerEnv = { ...env };
  delete wranglerEnv[WRANGLER_API_TOKEN_ENV];
  return wranglerEnv;
}
