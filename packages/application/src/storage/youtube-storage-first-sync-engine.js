import {
  previewYouTubeOrganicStorage,
  writeYouTubeOrganicStorageFirst,
} from './youtube-organic-history-storage.js';

const CAPTURE_KEYS = Object.freeze({
  raw_channel_key: 'rawChannels',
  raw_video_key: 'rawVideos',
  raw_analytics_daily_key: 'rawAnalytics',
  content_key: 'contentRows',
  content_daily_key: 'dailyRows',
  account_key: 'accountRows',
});

/** ห่อ Existing TableSyncEngine เพื่อบังคับ D1-first โดยไม่สร้าง Lark engine ใหม่. */
export class YouTubeStorageFirstSyncEngine {
  constructor(input = {}) {
    this.tableSyncEngine = requireSyncEngine(input.tableSyncEngine);
    this.context = requireContext(input.context);
    this.larkWriteEnabled = input.larkWriteEnabled === true;
    this.d1WriteEnabled = input.d1WriteEnabled === true;
    this.captured = new Map();
    this.storagePromise = null;
    this.storageResult = null;
  }

  async planByKey(input = {}) {
    const captureName = CAPTURE_KEYS[input.keyField];
    if (captureName) {
      this.captured.set(captureName, Object.freeze([...(Array.isArray(input.rows) ? input.rows : [])]));
    }
    return this.tableSyncEngine.planByKey(input);
  }

  async executePlan(plan, options = {}) {
    if (!this.storagePromise) {
      this.storagePromise = this.d1WriteEnabled
        ? writeYouTubeOrganicStorageFirst(this.context, this.captured)
        : Promise.resolve(disabledStorageResult(this.captured));
    }
    this.storageResult = await this.storagePromise;

    if (!this.larkWriteEnabled) {
      return Object.freeze({
        created: 0,
        updated: 0,
        skipped: Number(plan?.skipped ?? 0),
        duplicateInputRows: Number(plan?.duplicateInputRows ?? 0),
        writeOutcome: 'disabled_by_flag',
      });
    }
    return this.tableSyncEngine.executePlan(plan, options);
  }

  async previewStorage() {
    if (this.captured.size === 0) {
      return Object.freeze({ status: 'not_observed', reason: 'source_flow_completed_without_new_plan' });
    }
    return previewYouTubeOrganicStorage(this.context, this.captured);
  }
}

function disabledStorageResult(captured) {
  return Object.freeze({
    status: 'disabled_by_flag',
    capturedScopes: Object.freeze([...captured.keys()].sort()),
  });
}

function requireSyncEngine(value) {
  if (!value
    || typeof value.planByKey !== 'function'
    || typeof value.executePlan !== 'function') {
    throw new TypeError('YouTube end-to-end requires Existing TableSyncEngine');
  }
  return value;
}

function requireContext(value) {
  if (!value || typeof value !== 'object') {
    throw new TypeError('YouTube storage-first engine requires context');
  }
  return value;
}
