export const LARK_TABLE_IDS = Object.freeze({
  mktAccounts: 'tblDcT7CVveNlNpP',
  mktAdsAccounts: 'tbl3yPcXdQzZQvBc',
  mktContent: 'tbllvswTYP1dQGf3',
  mktContentDaily: 'tbl5n2rbZU7NO07w',
  mktAdsCampaigns: 'tblR7FwJ2tasEKPy',
  mktAdsAdGroups: 'tblsFufuixpig0Tf',
  mktAdsCreatives: 'tblmWi81dZ98v4dc',
  mktAdsDaily: 'tblPTMsC9J32gukX',
  mktMetricDefinitions: 'tblk2Ho99sXqLLE2',
  mktReportSnapshots: 'tbl81gHrMESpDolN',
  mktAiReportRuns: 'tblCX8IMtOiahI1x',
  mktReportSettings: 'tblYzXA6m9G0PvIs',
  mktSyncLog: 'tblpgnHODi8MIcso',
  mktSystemAlerts: 'tbl5Cq9iVkWTFdA4',
  rawTikTokCreatorVideos: 'tblMdO6XCti94EwH',
  rawTikTokBusinessCampaigns: 'tblaHQOIAR1Yolk5',
  rawTikTokBusinessAdGroups: 'tbluOIJPRMgHHmyx',
  rawTikTokBusinessAds: 'tblgxZSqOFMpkykU',
  rawGoogleCampaigns: 'tblsxhuZJCDtk4wg',
  rawGoogleCustomerLists: 'tblS5Rki3QS7Wg1H',
});

export const LARK_TABLE_ENV = Object.freeze({
  rawTikTokCreatorVideos: 'LARK_TABLE_RAW_TIKTOK_CREATOR_VIDEOS',
  mktContent: 'LARK_TABLE_MKT_CONTENT',
  mktContentDaily: 'LARK_TABLE_MKT_CONTENT_DAILY',
  mktMetricDefinitions: 'LARK_TABLE_MKT_METRIC_DEFINITIONS',
  mktReportSnapshots: 'LARK_TABLE_MKT_REPORT_SNAPSHOTS',
  mktAiReportRuns: 'LARK_TABLE_MKT_AI_REPORT_RUNS',
});

export function readLarkTableIdsFromEnv(env) {
  return Object.freeze({
    rawTikTokCreatorVideos: readTableId(env, 'rawTikTokCreatorVideos'),
    mktContent: readTableId(env, 'mktContent'),
    mktContentDaily: readTableId(env, 'mktContentDaily'),
    mktMetricDefinitions: readTableId(env, 'mktMetricDefinitions'),
    mktReportSnapshots: readTableId(env, 'mktReportSnapshots'),
    mktAiReportRuns: readTableId(env, 'mktAiReportRuns'),
  });
}

function readTableId(env, tableKey) {
  const envName = LARK_TABLE_ENV[tableKey];
  const value = env?.[envName] ?? LARK_TABLE_IDS[tableKey];
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`Missing Lark table id for ${tableKey}`);
  }

  return value.trim();
}
