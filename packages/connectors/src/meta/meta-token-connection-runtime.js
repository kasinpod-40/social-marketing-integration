import { loadMetaTokenConnectionConfig } from '../../../config/src/meta-token-connection-config.js';
import { MetaGraphClient } from './meta-graph.client.js';
import { FacebookPageConnectionAdapter } from './facebook-page-connection.adapter.js';
import { InstagramBusinessConnectionAdapter } from './instagram-business-connection.adapter.js';
import { MetaAdsConnectionAdapter } from './meta-ads-connection.adapter.js';

const FACEBOOK_GRAPH_BASE_URL = 'https://graph.facebook.com';
const INSTAGRAM_GRAPH_BASE_URL = 'https://graph.instagram.com';

/**
 * สร้าง Adapter จาก Environment โดยไม่คืน Token ออกนอก Factory.
 * Facebook Organic และ Meta Ads ใช้ Credential เดียวกันแต่ได้ Adapter/ผลลัพธ์แยกกัน.
 */
export function createMetaTokenConnectionRuntime(env = {}, options = {}) {
  const config = loadMetaTokenConnectionConfig(env);
  const common = {
    apiVersion: config.apiVersion,
    fetchImpl: options.fetchImpl,
    timeoutMs: config.transport.timeoutMs,
    maxPages: config.transport.maxPages,
    pageSize: config.transport.pageSize,
    maxAttempts: config.transport.maxAttempts,
    maxResponseBytes: config.transport.maxResponseBytes,
    sleepImpl: options.sleepImpl,
    randomImpl: options.randomImpl,
    onRequest: options.onRequest,
  };
  const facebookClient = config.credentials.facebookAccessToken
    ? new MetaGraphClient({
      ...common,
      accessToken: config.credentials.facebookAccessToken,
      baseUrl: FACEBOOK_GRAPH_BASE_URL,
    })
    : null;
  const instagramClient = config.credentials.instagramAccessToken
    ? new MetaGraphClient({
      ...common,
      accessToken: config.credentials.instagramAccessToken,
      baseUrl: INSTAGRAM_GRAPH_BASE_URL,
    })
    : null;

  return deepFreeze({
    facebook: facebookClient
      ? new FacebookPageConnectionAdapter({ client: facebookClient })
      : null,
    instagram: instagramClient
      ? new InstagramBusinessConnectionAdapter({ client: instagramClient })
      : null,
    metaAds: facebookClient
      ? new MetaAdsConnectionAdapter({ client: facebookClient })
      : null,
    mappings: config.mappings,
  });
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const nested of Object.values(value)) deepFreeze(nested);
  return Object.freeze(value);
}
