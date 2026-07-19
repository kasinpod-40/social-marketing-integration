const today = new Intl.DateTimeFormat('en-CA', {
  timeZone: process.env.DEFAULT_TIMEZONE ?? 'Asia/Bangkok',
  year: 'numeric', month: '2-digit', day: '2-digit',
}).format(new Date());
const job = {
  schemaVersion: 1,
  type: 'youtube.channel.organic.sync',
  trigger: 'manual',
  requestedAt: new Date().toISOString(),
  metricDate: process.env.METRIC_DATE ?? today,
  syncMode: process.env.SYNC_MODE ?? 'auto',
  analyticsEnabled: process.env.ANALYTICS_ENABLED === 'true',
  dryRun: process.env.DRY_RUN === 'true',
  ...(process.env.ANALYTICS_START_DATE ? { analyticsStartDate: process.env.ANALYTICS_START_DATE } : {}),
  ...(process.env.ANALYTICS_END_DATE ? { analyticsEndDate: process.env.ANALYTICS_END_DATE } : {}),
};
console.log(JSON.stringify(job, null, 2));
