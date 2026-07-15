import test from 'node:test';
import assert from 'node:assert/strict';
import {
  LARK_TABLE_ENV,
  readLarkTableIdsFromEnv,
} from '../../packages/config/src/lark-table-config.js';
import {
  readYouTubeLarkTableIdsFromEnv,
  YOUTUBE_REQUIRED_LARK_TABLE_KEYS,
} from '../../packages/config/src/youtube-organic-runtime-config.js';

test('resolves required Lark table ids from env only', () => {
  const result = readLarkTableIdsFromEnv({
    LARK_TABLE_MKT_CONTENT: ' tbl_content ',
    LARK_TABLE_MKT_CLASSIFICATION_DICTIONARY: 'tbl_dictionary',
  }, ['mktContent', 'mktClassificationDictionary']);

  assert.deepEqual(result, {
    mktContent: 'tbl_content',
    mktClassificationDictionary: 'tbl_dictionary',
  });
});

test('resolves the separate Ads Ad table mapping', () => {
  assert.deepEqual(readLarkTableIdsFromEnv({
    LARK_TABLE_MKT_ADS_ADS: 'tbl_ads',
  }, ['mktAdsAds']), { mktAdsAds: 'tbl_ads' });
});

test('YouTube activation preflight requires Account, RAW, Content and Daily tables together', () => {
  assert.deepEqual(YOUTUBE_REQUIRED_LARK_TABLE_KEYS, [
    'mktAccounts',
    'rawYouTubeChannels',
    'rawYouTubeVideos',
    'rawYouTubeAnalyticsDaily',
    'mktContent',
    'mktContentDaily',
  ]);

  const complete = Object.fromEntries(YOUTUBE_REQUIRED_LARK_TABLE_KEYS.map((tableKey, index) => [
    LARK_TABLE_ENV[tableKey],
    `tbl_youtube_${index}`,
  ]));
  assert.equal(readYouTubeLarkTableIdsFromEnv(complete).mktAccounts, 'tbl_youtube_0');

  delete complete.LARK_TABLE_MKT_ACCOUNTS;
  assert.throws(
    () => readYouTubeLarkTableIdsFromEnv(complete),
    (error) => error?.code === 'LARK_TABLE_CONFIG_INVALID'
      && error.details?.envName === 'LARK_TABLE_MKT_ACCOUNTS',
  );
});

test('fails clearly when a required Lark table id env is missing', () => {
  assert.throws(
    () => readLarkTableIdsFromEnv({}, ['mktContent']),
    /LARK_TABLE_MKT_CONTENT/,
  );
});


test('rejects duplicate table ids so two logical destinations cannot write into the same table', () => {
  assert.throws(
    () => readLarkTableIdsFromEnv({
      LARK_TABLE_MKT_CONTENT: 'tbl_same',
      LARK_TABLE_MKT_CONTENT_DAILY: 'tbl_same',
    }, ['mktContent', 'mktContentDaily']),
    /assigned to both/,
  );
});

test('rejects duplicate logical table keys in the requested contract', () => {
  assert.throws(
    () => readLarkTableIdsFromEnv({ LARK_TABLE_MKT_CONTENT: 'tbl_content' }, ['mktContent', 'mktContent']),
    /Duplicate Lark logical table key/,
  );
});
