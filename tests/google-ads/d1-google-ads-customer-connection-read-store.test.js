import test from 'node:test';
import assert from 'node:assert/strict';
import {
  D1GoogleAdsCustomerConnectionReadStore,
} from '../../packages/connectors/src/google-ads/d1-google-ads-customer-connection-read-store.js';
import {
  buildGoogleAdsConnectionGateSql,
  validateGoogleAdsConnectionGateRow,
} from '../../scripts/lib/google-ads-live-operator.js';
import { createSqliteD1 } from '../helpers/sqlite-d1.js';

function createConnectionDb(accessStatus = 'google_ads_api_access_pending') {
  const d1 = createSqliteD1();
  d1.exec(`
    CREATE TABLE connections (
      id TEXT PRIMARY KEY,
      customer_key TEXT NOT NULL,
      connector_key TEXT NOT NULL,
      external_account_id TEXT,
      connection_status TEXT NOT NULL,
      access_status TEXT NOT NULL,
      granted_scopes_json TEXT,
      provider_metadata_json TEXT,
      last_validated_at INTEGER,
      credential_reference TEXT,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE encrypted_credentials (
      connection_id TEXT NOT NULL,
      credential_kind TEXT NOT NULL,
      status TEXT NOT NULL,
      credential_reference TEXT NOT NULL,
      key_version TEXT NOT NULL
    );
  `);
  d1.prepare(`
    INSERT INTO connections (
      id, customer_key, connector_key, external_account_id, connection_status,
      access_status, granted_scopes_json, provider_metadata_json,
      last_validated_at, credential_reference, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    'connection-1',
    'chemistry_k',
    'google_ads',
    null,
    'connected',
    accessStatus,
    JSON.stringify(['https://www.googleapis.com/auth/adwords']),
    JSON.stringify({
      managerCustomerId: '9463570541',
      approvedAdvertiserCustomerId: '5662332033',
    }),
    null,
    'credential-1',
    1785034568523,
  ).run();
  d1.prepare(`
    INSERT INTO encrypted_credentials (
      connection_id, credential_kind, status, credential_reference, key_version
    ) VALUES (?, ?, ?, ?, ?)
  `).bind('connection-1', 'refresh_token', 'active', 'credential-1', 'v1').run();
  return d1;
}

function operatorTarget() {
  return {
    customerKey: 'chemistry_k',
    managerCustomerId: '9463570541',
    advertiserCustomerId: '5662332033',
    sourceTimezone: 'Asia/Bangkok',
  };
}

test('D1 read store returns API-pending Script consent with active encrypted credential', async () => {
  const d1 = createConnectionDb();
  try {
    const store = new D1GoogleAdsCustomerConnectionReadStore({ db: d1 });
    const connection = await store.findScriptAuthorizedConnection({ customerKey: 'chemistry_k' });
    assert.equal(connection.accessStatus, 'google_ads_api_access_pending');
    assert.equal(connection.advertiserCustomerId, null);
    assert.equal(connection.providerMetadata.approvedAdvertiserCustomerId, '5662332033');
    assert.equal(connection.credentialReference, 'credential-1');
    assert.equal(connection.activeCredentialReference, 'credential-1');
  } finally {
    d1.close();
  }
});

test('operator Script consent SQL executes on SQLite/D1 and accepts API-pending state', async () => {
  const d1 = createConnectionDb();
  try {
    const sql = buildGoogleAdsConnectionGateSql(operatorTarget());
    const row = await d1.prepare(sql).first();
    const gate = validateGoogleAdsConnectionGateRow(row);
    assert.equal(gate.script_authorized_connection_count, 1);
    assert.equal(gate.script_access_allowed, 1);
    assert.equal(gate.api_access_pending, 1);
    assert.equal(gate.api_access_validated, 0);
    assert.equal(gate.scope_matches, 1);
    assert.equal(gate.advertiser_matches, 1);
  } finally {
    d1.close();
  }
});

test('D1 read store excludes unsupported API state from Script authorization', async () => {
  const d1 = createConnectionDb('not_validated');
  try {
    const store = new D1GoogleAdsCustomerConnectionReadStore({ db: d1 });
    const connection = await store.findScriptAuthorizedConnection({ customerKey: 'chemistry_k' });
    assert.equal(connection, null);
  } finally {
    d1.close();
  }
});
