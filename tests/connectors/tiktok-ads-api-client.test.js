import test from 'node:test';
import assert from 'node:assert/strict';
import { TikTokAdsApiClient } from '../../packages/connectors/src/tiktok-ads/tiktok-ads-api.client.js';

test('capability discovery uses bounded all-status ad report and discloses only field presence', async () => {
  const calls = [];
  const client = createClient(async (url, init) => {
    calls.push({ url: new URL(url), init });
    return Response.json({ code: 0, data: { page_info: { total_number: 22 }, list: [{
      dimensions: { ad_id: 'private-id', stat_time_day: '2026-10-02 00:00:00' },
      metrics: { spend: 'private-value', impressions: '500', clicks: '4' },
    }] } });
  });
  const result = await client.probeCapability({ advertiserId: '123', accessToken: 'private',
    kind: 'ad_base', date: '2026-10-02' });
  assert.equal(result.totalCount, 22);
  assert.equal(result.sampleOnly, true);
  assert.equal(result.dateMatched, true);
  assert.deepEqual(result.fieldsPresent, { spend: true, impressions: true, clicks: true });
  assert.equal(calls[0].url.searchParams.get('data_level'), 'AUCTION_AD');
  assert.equal(calls[0].url.searchParams.get('page_size'), '1');
  assert.match(calls[0].url.searchParams.get('filtering'), /STATUS_ALL/u);
  assert.equal(JSON.stringify(result).includes('private'), false);
  await assert.rejects(client.probeCapability({ kind: 'arbitrary_endpoint' }));
  assert.equal(calls.length, 1);
});

test('metadata capability rejects a returned foreign advertiser without exposing response', async () => {
  const client = createClient(async () => Response.json({ code: 0, data: {
    page_info: { total_number: 1 }, list: [{ advertiser_id: '999', ad_id: '456' }],
  } }));
  await assert.rejects(client.probeCapability({ advertiserId: '123', accessToken: 'private',
    kind: 'ad_metadata' }), { code: 'TIKTOK_ADS_CAPABILITY_OWNER_CONFLICT' });
});

test('TikTok Ads advertiser discovery uses official v1.3 auth boundary', async () => {
  const calls = [];
  const client = createClient(async (url, init) => {
    calls.push({ url: url.toString(), init });
    return Response.json({
      code: 0,
      data: { list: [{ advertiser_id: '1234567890123456789', advertiser_name: 'Chemistry K' }] },
    });
  });
  const rows = await client.listAuthorizedAdvertisers({ accessToken: 'access-private' });
  assert.deepEqual(rows, [{
    advertiserId: '1234567890123456789',
    advertiserName: 'Chemistry K',
  }]);
  const url = new URL(calls[0].url);
  assert.equal(url.pathname, '/open_api/v1.3/oauth2/advertiser/get/');
  assert.equal(url.searchParams.get('app_id'), '7670007933899390993');
  assert.equal(url.searchParams.get('secret'), 'app-secret');
  assert.equal(calls[0].init.headers['Access-Token'], 'access-private');
});

test('TikTok Ads advertiser info validates exact authorized identity', async () => {
  const calls = [];
  const client = createClient(async (url, init) => {
    calls.push({ url: url.toString(), init });
    return Response.json({
      code: 0,
      data: {
        list: [{
          advertiser_id: '1234567890123456789',
          name: 'Chemistry K',
          currency: 'THB',
          timezone: 'Asia/Bangkok',
        }],
      },
    });
  });
  const row = await client.getAdvertiser({
    accessToken: 'access-private',
    advertiserId: '1234567890123456789',
  });
  assert.deepEqual(row, {
    advertiserId: '1234567890123456789',
    advertiserName: 'Chemistry K',
    currency: 'THB',
    timezone: 'Asia/Bangkok',
  });
  const url = new URL(calls[0].url);
  assert.equal(url.pathname, '/open_api/v1.3/advertiser/info/');
  assert.equal(url.searchParams.get('advertiser_ids'), '["1234567890123456789"]');
  assert.equal(calls[0].init.headers['Access-Token'], 'access-private');
});

test('TikTok Ads campaign probe uses a bounded GET and returns no campaign data', async () => {
  const calls = [];
  const client = createClient(async (url, init) => {
    calls.push({ url: url.toString(), init });
    return Response.json({ code: 0, data: { list: [{ campaign_id: 'private-id' }] } });
  });
  const result = await client.probeCampaigns({
    accessToken: 'access-private', advertiserId: '1234567890123456789',
  });
  assert.deepEqual(result, { campaignReturned: true, pageSize: 1 });
  assert.equal(JSON.stringify(result).includes('private-id'), false);
  const url = new URL(calls[0].url);
  assert.equal(url.pathname, '/open_api/v1.3/campaign/get/');
  assert.equal(url.searchParams.get('advertiser_id'), '1234567890123456789');
  assert.equal(url.searchParams.get('page'), '1');
  assert.equal(url.searchParams.get('page_size'), '1');
  assert.equal(calls[0].init.method, 'GET');
  assert.equal(calls[0].init.headers['Access-Token'], 'access-private');
});

test('TikTok Ads report probe requests one campaign-day row and reveals only metric presence', async () => {
  const calls = [];
  const client = createClient(async (url, init) => {
    calls.push({ url: url.toString(), init });
    return Response.json({ code: 0, data: {
      list: [{ dimensions: { campaign_id: 'private-id' }, metrics: {
        spend: '12.34', impressions: '100', clicks: '4', private_metric: 'secret',
      } }],
      page_info: { total_number: 123 },
    } });
  });
  const result = await client.probeCampaignDailyReport({
    accessToken: 'access-private', advertiserId: '1234567890123456789', date: '2026-10-01',
  });
  assert.deepEqual(result, {
    reportReturned: true, pageSize: 1, paginationAvailable: true,
    metricsPresent: { spend: true, impressions: true, clicks: true },
  });
  assert.equal(JSON.stringify(result).includes('private-id'), false);
  assert.equal(JSON.stringify(result).includes('12.34'), false);
  const url = new URL(calls[0].url);
  assert.equal(url.pathname, '/open_api/v1.3/report/integrated/get/');
  assert.equal(url.searchParams.get('report_type'), 'BASIC');
  assert.equal(url.searchParams.get('data_level'), 'AUCTION_CAMPAIGN');
  assert.deepEqual(JSON.parse(url.searchParams.get('dimensions')), ['campaign_id', 'stat_time_day']);
  assert.deepEqual(JSON.parse(url.searchParams.get('metrics')), ['spend', 'impressions', 'clicks']);
  assert.equal(url.searchParams.get('start_date'), '2026-10-01');
  assert.equal(url.searchParams.get('end_date'), '2026-10-01');
  assert.equal(url.searchParams.get('page_size'), '1');
  assert.equal(url.toString().includes('access-private'), false);
  assert.equal(calls[0].init.headers['Access-Token'], 'access-private');
  await assert.rejects(client.probeCampaignDailyReport({
    accessToken: 'access-private', advertiserId: '1234567890123456789', date: '2026-02-30',
  }), /real YYYY-MM-DD date/u);
  assert.equal(calls.length, 1);
});

test('TikTok Ads daily report reads bounded pages and rejects incomplete pagination', async () => {
  const calls = [];
  const row = (id) => ({ dimensions: { campaign_id: id, stat_time_day: '2026-10-01' },
    metrics: { spend: '1.00', impressions: '2', clicks: '1' } });
  const client = createClient(async (url) => {
    const page = Number(url.searchParams.get('page'));
    calls.push(page);
    return Response.json({ code: 0, data: {
      list: page === 1 ? Array.from({ length: 100 }, (_, index) => row(String(index + 1))) : [row('101')],
      page_info: { page, total_page: 2, total_number: 101 },
    } });
  });
  const result = await client.listCampaignDailyReport({
    accessToken: 'access-private', advertiserId: '1234567890123456789', date: '2026-10-01',
  });
  assert.equal(result.rows.length, 101);
  assert.equal(result.pageCount, 2);
  assert.deepEqual(calls, [1, 2]);

  const incomplete = createClient(async () => Response.json({ code: 0, data: {
    list: [row('1')], page_info: { page: 1, total_page: 1, total_number: 2 },
  } }));
  await assert.rejects(incomplete.listCampaignDailyReport({
    accessToken: 'access-private', advertiserId: '1234567890123456789', date: '2026-10-01',
  }), { code: 'TIKTOK_ADS_DAILY_REPORT_INCOMPLETE' });
});

test('Campaign metadata shares complete bounded pagination and strips unrelated provider fields', async () => {
  const calls = [];
  const client = createClient(async (url, init) => {
    const page = Number(url.searchParams.get('page'));
    calls.push(page);
    assert.equal(url.pathname, '/open_api/v1.3/campaign/get/');
    assert.equal(url.searchParams.get('page_size'), '100');
    assert.equal(init.headers['Access-Token'], 'access-private');
    return Response.json({ code: 0, data: { list: [{ campaign_id: String(page),
      advertiser_id: '1234567890123456789', campaign_name: `Campaign ${page}`, operation_status: 'ENABLE',
      objective_type: 'TRAFFIC', private_data: 'do-not-retain' }],
    page_info: { page, total_page: 2, total_number: 2 } } });
  });
  const result = await client.listCampaignMetadata({ accessToken: 'access-private', advertiserId: '1234567890123456789' });
  assert.deepEqual(calls, [1, 2]);
  assert.equal(result.totalCount, 2);
  assert.deepEqual(result.rows[0], { campaignId: '1', name: 'Campaign 1', status: 'ENABLE', objective: 'TRAFFIC' });
  assert.doesNotMatch(JSON.stringify(result), /do-not-retain|private_data|access-private/);
});

test('Campaign metadata rejects duplicate, wrong advertiser, incomplete and excessive pagination', async () => {
  const row = { campaign_id: '123', advertiser_id: '1234567890123456789' };
  for (const [list, info, code] of [
    [[row, row], { page: 1, total_page: 1, total_number: 2 }, 'IDENTITY_CONFLICT'],
    [[{ ...row, advertiser_id: '999' }], { page: 1, total_page: 1, total_number: 1 }, 'IDENTITY_CONFLICT'],
    [[row], { page: 1, total_page: 1, total_number: 2 }, 'INCOMPLETE'],
    [[row], { page: 1, total_page: 6, total_number: 600 }, 'PAGINATION_UNSAFE'],
  ]) {
    const client = createClient(async () => Response.json({ code: 0, data: { list, page_info: info } }));
    await assert.rejects(client.listCampaignMetadata({ accessToken: 'access-private', advertiserId: '1234567890123456789' }),
      { code: `TIKTOK_ADS_CAMPAIGN_METADATA_${code}` });
  }
  const missing = createClient(async () => Response.json({ code: 0, data: {
    list: [row], page_info: { page: 1, total_page: 1, total_number: 1 },
  } }));
  const result = await missing.listCampaignMetadata({ accessToken: 'access-private', advertiserId: '1234567890123456789' });
  assert.deepEqual(result.rows[0], { campaignId: '123', name: null, status: null, objective: null });
});

function createClient(fetchImpl) {
  return new TikTokAdsApiClient({
    appId: '7670007933899390993',
    appSecret: 'app-secret',
    fetchImpl,
  });
}


test('full all-status Ad inventory reads beyond five pages and preserves exact parents/assets', async () => {
  const pages = [];
  const client = createClient(async url => {
    const page = Number(url.searchParams.get('page'));
    pages.push(page);
    assert.equal(url.pathname, '/open_api/v1.3/ad/get/');
    assert.deepEqual(JSON.parse(url.searchParams.get('filtering')), { primary_status: 'STATUS_ALL' });
    assert.ok(JSON.parse(url.searchParams.get('fields')).includes('image_ids'));
    const start = (page - 1) * 100;
    return Response.json({ code: 0, data: {
      list: Array.from({ length: Math.min(100, 601 - start) }, (_, i) => ({
        advertiser_id: '123', ad_id: String(start + i + 1), campaign_id: '456', adgroup_id: '789',
        ad_name: 'private-name', operation_status: 'ENABLE', video_id: 'opaque-video', image_ids: ['opaque-image'], tiktok_item_id: '1234567890123456789',
      })), page_info: { page, total_page: 7, total_number: 601 },
    } });
  });
  const result = await client.listEntityMetadata({ kind: 'ad', advertiserId: '123', accessToken: 'private' });
  assert.deepEqual(pages, [1, 2, 3, 4, 5, 6, 7]);
  assert.equal(result.rows.length, 601);
  assert.equal(result.rows[600].id, '601');
  assert.equal(result.rows[0].campaignId, '456');
  assert.equal(result.rows[0].adGroupId, '789');
  assert.deepEqual(result.rows[0].imageIds, ['opaque-image']);
  assert.equal(result.rows[0].postId, '1234567890123456789');
});

test('inventory rejects duplicate/foreign identity, missing parent, malformed assets and unsafe paging', async () => {
  const row = { advertiser_id: '123', ad_id: '456', campaign_id: '789', adgroup_id: '101' };
  for (const list of [[row, row], [{ ...row, advertiser_id: '999' }],
    [{ ...row, campaign_id: null }], [{ ...row, image_ids: 'image' }]]) {
    const client = createClient(async () => Response.json({ code: 0, data: {
      list, page_info: { page: 1, total_page: 1, total_number: list.length },
    } }));
    await assert.rejects(client.listEntityMetadata({ kind: 'ad', advertiserId: '123', accessToken: 'private' }));
  }
  const client = createClient(async () => Response.json({ code: 0, data: {
    list: [], page_info: { page: 1, total_page: 101, total_number: 10001 },
  } }));
  await assert.rejects(client.listEntityMetadata({ kind: 'ad', advertiserId: '123', accessToken: 'private' }),
    { code: 'TIKTOK_ADS_INVENTORY_PAGINATION_UNSAFE' });
});


test('inventory bounds concurrent requests at four and rejects total drift between pages', async () => {
  let inFlight = 0;
  let peak = 0;
  const client = createClient(async url => {
    const page = Number(url.searchParams.get('page'));
    inFlight += 1; peak = Math.max(peak, inFlight);
    await new Promise(resolve => setTimeout(resolve, 2));
    inFlight -= 1;
    return Response.json({ code: 0, data: {
      list: [{ campaign_id: String(page) }], page_info: { page, total_page: 8, total_number: 8 },
    } });
  });
  const result = await client.listEntityMetadata({ kind: 'campaign', advertiserId: '123', accessToken: 'private' });
  assert.equal(peak, 4);
  assert.deepEqual(result.rows.map(row => row.id), ['1','2','3','4','5','6','7','8']);
  const drift = createClient(async url => {
    const page = Number(url.searchParams.get('page'));
    return Response.json({ code: 0, data: { list: [],
      page_info: { page, total_page: 2, total_number: page === 1 ? 2 : 3 },
    } });
  });
  await assert.rejects(drift.listEntityMetadata({ kind: 'campaign', advertiserId: '123', accessToken: 'private' }),
    { code: 'TIKTOK_ADS_INVENTORY_PAGINATION_UNSAFE' });
});


test('Smart+ and Ad v2 discovery keep all-status filters and exact report dimension distinct', async () => {
  const urls = [];
  const client = createClient(async url => {
    urls.push(url);
    return Response.json({ code: 0, data: { list: [], page_info: { total_number: 0 } } });
  });
  for (const kind of ['smart_plus_metadata', 'ad_v2_base']) {
    await client.probeCapability({ kind, advertiserId: '123', accessToken: 'private', date: '2026-10-02' });
  }
  assert.equal(urls[0].pathname, '/open_api/v1.3/smart_plus/ad/get/');
  assert.deepEqual(JSON.parse(urls[0].searchParams.get('filtering')), { primary_status: 'STATUS_ALL' });
  assert.deepEqual(JSON.parse(urls[1].searchParams.get('dimensions')), ['ad_id_v2', 'stat_time_day']);
});


test('Smart+ full metadata uses smart_plus_ad_id rather than legacy creative identity', async () => {
  const client = createClient(async url => {
    assert.equal(url.pathname, '/open_api/v1.3/smart_plus/ad/get/');
    assert.ok(JSON.parse(url.searchParams.get('fields')).includes('smart_plus_ad_id'));
    return Response.json({ code: 0, data: { page_info: { page: 1, total_page: 1, total_number: 1 },
      list: [{ advertiser_id: '123', smart_plus_ad_id: '456', campaign_id: '789', adgroup_id: '101',
        creative_list: [{ smart_plus_creative_id: '202' }, { smart_plus_creative_id: '303' }] }],
    } });
  });
  const result = await client.listEntityMetadata({ kind: 'smart_ad', advertiserId: '123', accessToken: 'private' });
  assert.equal(result.rows[0].id, '456');
  assert.equal(result.rows[0].adGroupId, '101');
  assert.equal(result.rows[0].creativeItems, 2);
  assert.deepEqual(result.rows[0].creativeIds, ['202', '303']);
});


test('complete daily STATUS_ALL uses only the approved true Ad dimension and refuses arbitrary grains', async () => {
  const calls = [];
  const client = createClient(async url => { calls.push(new URL(url));
    return Response.json({ code: 0, data: { list: [], page_info: { total_number: 0, total_page: 1 } } }); });
  for (const grain of ['campaign', 'ad']) {
    await client.listAllStatusDailyReport({ grain, advertiserId: '123', accessToken: 'private', date: '2026-10-02' });
  }
  assert.deepEqual(JSON.parse(calls[1].searchParams.get('dimensions')), ['ad_id_v2', 'stat_time_day']);
  assert.equal(JSON.parse(calls[1].searchParams.get('filtering'))[0].field_name, 'ad_status');
  assert.match(calls[0].searchParams.get('filtering'), /STATUS_ALL/u);
  await assert.rejects(client.listAllStatusDailyReport({ grain: 'creative' }));
  assert.equal(calls.length, 2);
});


test('full metric families use ad_id_v2 and reject unapproved metric names before request', async () => {
  const calls = []; const client = createClient(async url => { calls.push(new URL(url));
    return Response.json({ code: 0, data: { list: [], page_info: { total_number: 0, total_page: 1 } } }); });
  await client.listAllStatusDailyReport({ grain: 'ad', metricFamily: 'video', advertiserId: '123', accessToken: 'private', date: '2026-10-03' });
  assert.deepEqual(JSON.parse(calls[0].searchParams.get('metrics')), ['video_play_actions', 'video_watched_2s', 'video_watched_6s']);
  assert.deepEqual(JSON.parse(calls[0].searchParams.get('dimensions')), ['ad_id_v2', 'stat_time_day']);
  await assert.rejects(client.listAllStatusDailyReport({grain:'ad',metricFamily:'arbitrary'}));
  await client.listAllStatusDailyReport({grain:'campaign',metricFamily:'video',advertiserId:'123',accessToken:'private',date:'2026-10-03'});
  assert.deepEqual(JSON.parse(calls[1].searchParams.get('dimensions')), ['campaign_id', 'stat_time_day']);
  assert.equal(calls[1].searchParams.get('data_level'), 'AUCTION_CAMPAIGN');
  assert.match(calls[1].searchParams.get('filtering'), /campaign_status/u);
  assert.equal(calls.length, 2);
});
