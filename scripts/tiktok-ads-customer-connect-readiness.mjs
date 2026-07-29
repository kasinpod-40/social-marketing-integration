#!/usr/bin/env node
import process from 'node:process';

const execute = process.argv.includes('--execute');
const required = [
  'MKT_CONNECTION_PUBLIC_ORIGIN',
  'MKT_CONNECTION_OPERATOR_TOKEN',
  'MKT_TIKTOK_ADS_REDIRECT_URI',
  'TIKTOK_ADS_APP_ID',
  'TIKTOK_ADS_APP_SECRET',
  'MKT_TIKTOK_ADS_ADVERTISER_ID',
];

const missing = required.filter((name) => !String(process.env[name] ?? '').trim());
const plan = {
  operation: 'tiktok_ads_customer_connect_readiness',
  environment: 'development',
  profile: 'integration_workspace',
  customerKey: 'chemistry_k',
  connectorKey: 'tiktok_ads',
  remoteMutation: execute ? 'one invitation creation only' : 'none',
  providerCall: 'none',
  queueMessage: 'none',
  larkWrite: 'none',
  scheduleMutation: 'none',
  missingInputs: missing,
};

if (!execute) {
  console.log(JSON.stringify(plan, null, 2));
  process.exit(0);
}
if (missing.length > 0) {
  console.error(JSON.stringify(plan, null, 2));
  process.exitCode = 2;
} else {
  const origin = new URL(process.env.MKT_CONNECTION_PUBLIC_ORIGIN).origin;
  const response = await fetch(`${origin}/operator/connection-invitations`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${process.env.MKT_CONNECTION_OPERATOR_TOKEN}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      connectorKey: 'tiktok_ads',
      customerKey: 'chemistry_k',
      ttlMs: 7 * 24 * 60 * 60 * 1000,
      maxAttempts: 3,
    }),
  });
  const body = await response.json();
  if (!response.ok || body?.ok !== true) {
    throw new Error(`TikTok Ads invitation creation failed with HTTP ${response.status}`);
  }
  console.log(JSON.stringify({
    connector: body.invitation.connector,
    customerKey: body.invitation.customerKey,
    connectUrl: body.invitation.connectUrl,
    expiresAt: body.invitation.expiresAt,
    environment: body.invitation.environment,
  }, null, 2));
}
