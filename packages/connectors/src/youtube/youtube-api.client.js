import {
  permanentError,
  transientError,
} from '../../../shared/src/errors/runtime-error.js';
import { requireDateOnly } from '../../../shared/src/date/date-only.js';

const DATA_API_BASE_URL = 'https://www.googleapis.com/youtube/v3';
const ANALYTICS_API_BASE_URL = 'https://youtubeanalytics.googleapis.com/v2';
const MAX_VIDEO_IDS_PER_REQUEST = 50;

/** Client ขนาดเล็กสำหรับ YouTube Data API และ Owner Analytics โดยไม่เก็บ Request state ใน Global scope */
export class YouTubeApiClient {
  constructor(config = {}) {
    this.apiKey = optionalText(config.apiKey);
    this.accessToken = optionalText(config.accessToken);
    if (!this.apiKey && !this.accessToken) {
      throw new TypeError('YouTubeApiClient requires apiKey or accessToken');
    }

    const fetchImpl = config.fetchImpl ?? globalThis.fetch?.bind(globalThis);
    if (typeof fetchImpl !== 'function') throw new TypeError('YouTubeApiClient requires fetch');
    this.fetchImpl = (...args) => fetchImpl(...args);
    this.dataBaseUrl = normalizeBaseUrl(config.dataBaseUrl ?? DATA_API_BASE_URL);
    this.analyticsBaseUrl = normalizeBaseUrl(config.analyticsBaseUrl ?? ANALYTICS_API_BASE_URL);
    this.timeoutMs = positiveInteger(config.timeoutMs ?? 30_000, 'timeoutMs');
    this.maxPages = positiveInteger(config.maxPages ?? 100, 'maxPages');
  }

  /** อ่าน Channel identity, uploads playlist และ public cumulative statistics */
  async getChannel(input = {}) {
    const channelId = optionalText(input.channelId);
    const mine = input.mine === true;
    if ((channelId ? 1 : 0) + (mine ? 1 : 0) !== 1) {
      throw new TypeError('YouTube getChannel requires exactly one of channelId or mine=true');
    }
    if (mine && !this.accessToken) {
      throw permanentError('YouTube mine=true requires OAuth access token', {
        code: 'YOUTUBE_OAUTH_REQUIRED',
      });
    }

    const payload = await this.requestJson({
      baseUrl: this.dataBaseUrl,
      path: '/channels',
      query: {
        part: 'snippet,contentDetails,statistics,status',
        ...(channelId ? { id: channelId } : { mine: 'true' }),
      },
    });
    const items = requireArray(payload.items, 'YouTube channels.items');
    if (items.length !== 1) {
      throw permanentError(`YouTube channel lookup returned ${items.length} records`, {
        code: 'YOUTUBE_CHANNEL_IDENTITY_MISMATCH',
        details: { requestedChannelId: channelId, resultCount: items.length },
      });
    }
    return Object.freeze(items[0]);
  }

  /** เดิน uploads playlist ด้วย pageToken แบบมีเพดานและคืน Video IDs ที่ไม่ซ้ำ */
  async listUploadVideoIds(input = {}) {
    const playlistId = requireText(input.uploadsPlaylistId, 'uploadsPlaylistId');
    const ids = [];
    const seen = new Set();
    let pageToken = null;

    for (let page = 1; page <= this.maxPages; page += 1) {
      const payload = await this.requestJson({
        baseUrl: this.dataBaseUrl,
        path: '/playlistItems',
        query: {
          part: 'contentDetails',
          playlistId,
          maxResults: '50',
          ...(pageToken ? { pageToken } : {}),
        },
      });
      for (const item of requireArray(payload.items, 'YouTube playlistItems.items')) {
        const videoId = optionalText(item?.contentDetails?.videoId);
        if (videoId && !seen.has(videoId)) {
          seen.add(videoId);
          ids.push(videoId);
        }
      }
      pageToken = optionalText(payload.nextPageToken);
      if (!pageToken) return Object.freeze(ids);
    }

    throw transientError('YouTube uploads pagination exceeded configured maxPages', {
      code: 'YOUTUBE_PAGINATION_LIMIT',
      details: { maxPages: this.maxPages, playlistId },
    });
  }

  /** อ่าน Video resources เป็น Chunk ละไม่เกิน 50 IDs ตาม Data API contract */
  async listVideos(input = {}) {
    const videoIds = uniqueTextArray(input.videoIds, 'videoIds');
    const videos = [];
    for (let index = 0; index < videoIds.length; index += MAX_VIDEO_IDS_PER_REQUEST) {
      const chunk = videoIds.slice(index, index + MAX_VIDEO_IDS_PER_REQUEST);
      const payload = await this.requestJson({
        baseUrl: this.dataBaseUrl,
        path: '/videos',
        query: {
          part: 'snippet,contentDetails,statistics,status',
          id: chunk.join(','),
        },
      });
      videos.push(...requireArray(payload.items, 'YouTube videos.items'));
    }
    return Object.freeze(videos.map((video) => Object.freeze(video)));
  }

  /** อ่าน Owner Analytics ซึ่งต้องใช้ OAuth และเก็บผลแยกจาก cumulative Data API snapshots */
  async queryAnalytics(input = {}) {
    if (!this.accessToken) {
      throw permanentError('YouTube Analytics requires OAuth access token', {
        code: 'YOUTUBE_ANALYTICS_OAUTH_REQUIRED',
      });
    }
    const channelId = requireText(input.channelId, 'channelId');
    const payload = await this.requestJson({
      baseUrl: this.analyticsBaseUrl,
      path: '/reports',
      authMode: 'oauth',
      query: {
        ids: `channel==${channelId}`,
        startDate: requireDateOnly(input.startDate, { label: 'startDate' }),
        endDate: requireDateOnly(input.endDate, { label: 'endDate' }),
        metrics: requireText(input.metrics, 'metrics'),
        ...(optionalText(input.dimensions) ? { dimensions: input.dimensions.trim() } : {}),
        ...(optionalText(input.filters) ? { filters: input.filters.trim() } : {}),
        ...(optionalText(input.sort) ? { sort: input.sort.trim() } : {}),
        ...(input.maxResults ? { maxResults: String(positiveInteger(input.maxResults, 'maxResults')) } : {}),
        ...(input.startIndex ? { startIndex: String(positiveInteger(input.startIndex, 'startIndex')) } : {}),
      },
    });
    return Object.freeze(payload);
  }

  async requestJson(input) {
    const url = new URL(`${input.baseUrl}${input.path}`);
    for (const [key, value] of Object.entries(input.query ?? {})) {
      if (value !== null && value !== undefined && value !== '') url.searchParams.set(key, String(value));
    }
    if (this.apiKey && input.authMode !== 'oauth') url.searchParams.set('key', this.apiKey);

    const headers = new Headers({ accept: 'application/json' });
    if (this.accessToken) headers.set('authorization', `Bearer ${this.accessToken}`);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    let response;
    try {
      response = await this.fetchImpl(url, { method: 'GET', headers, signal: controller.signal });
    } catch (cause) {
      throw transientError(`YouTube network request failed: ${input.path}`, {
        code: 'YOUTUBE_NETWORK_ERROR',
        cause,
        details: { path: input.path },
      });
    } finally {
      clearTimeout(timeout);
    }

    let payload;
    try {
      payload = await response.json();
    } catch (cause) {
      throw transientError(`YouTube returned invalid JSON: ${input.path}`, {
        code: 'YOUTUBE_INVALID_RESPONSE',
        cause,
        details: { path: input.path, status: response.status },
      });
    }
    if (response.ok && !payload?.error) return payload;
    throw createYouTubeApiError({ response, payload, path: input.path });
  }
}

function createYouTubeApiError({ response, payload, path }) {
  const reasons = Array.isArray(payload?.error?.errors)
    ? payload.error.errors.map((item) => optionalText(item?.reason)).filter(Boolean)
    : [];
  if (reasons.includes('quotaExceeded')) {
    return permanentError(`YouTube API quota is exhausted: ${path}`, {
      code: 'YOUTUBE_QUOTA_EXHAUSTED',
      details: {
        path,
        status: response.status,
        apiCode: payload?.error?.code ?? null,
        reasons,
        recovery: 'wait_for_quota_reset_or_request_additional_quota',
      },
    });
  }

  const retryableReasons = new Set(['rateLimitExceeded', 'userRateLimitExceeded', 'backendError']);
  const retryable = response.status === 429 || response.status >= 500
    || reasons.some((reason) => retryableReasons.has(reason));
  const factory = retryable ? transientError : permanentError;
  return factory(`YouTube API request failed: ${path}`, {
    code: retryable ? 'YOUTUBE_TRANSIENT_API_ERROR' : 'YOUTUBE_PERMANENT_API_ERROR',
    details: {
      path,
      status: response.status,
      apiCode: payload?.error?.code ?? null,
      reasons,
    },
  });
}

function uniqueTextArray(value, fieldName) {
  const values = requireArray(value, fieldName).map((item) => requireText(item, fieldName));
  return [...new Set(values)];
}

function requireArray(value, fieldName) {
  if (!Array.isArray(value)) throw new TypeError(`${fieldName} must be an array`);
  return value;
}

function requireText(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') throw new TypeError(`YouTube requires ${fieldName}`);
  return value.trim();
}

function optionalText(value) {
  if (value === null || value === undefined || value === '') return null;
  const text = typeof value === 'string' ? value.trim() : '';
  return text || null;
}

function positiveInteger(value, fieldName) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number <= 0) throw new TypeError(`${fieldName} must be a positive integer`);
  return number;
}

function normalizeBaseUrl(value) {
  const url = new URL(requireText(value, 'baseUrl'));
  if (url.protocol !== 'https:' && url.hostname !== 'localhost') {
    throw new TypeError('YouTube API base URL must use HTTPS');
  }
  return url.toString().replace(/\/$/u, '');
}
