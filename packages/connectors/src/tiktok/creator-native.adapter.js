import { toEpochMilliseconds } from '../shared/date-time.js';
import { readLarkNumber, readLarkText, readLarkUrl } from '../shared/lark-cell-value.js';

// รายชื่อ Field alias ที่ Lark Native Connector อาจใช้ในแต่ละภาษา/เวอร์ชัน
// การรวม Alias ไว้จุดเดียวช่วยไม่ให้ Mapping กระจายซ้ำหลายฟังก์ชัน
const FIELD_ALIASES = Object.freeze({
  videoId: ['video_id', 'Video ID', 'Unique identifier of the video', 'ID'],
  publishedAt: ['published_at', 'Published At', 'Date and time the video was published', 'Publish Time'],
  description: ['description', 'caption', 'Video Description', 'Video description', 'Description'],
  shareableUrl: ['shareable_url', 'share_url', 'Shareable URL', 'Shareable URL for this TikTok video'],
  embedUrl: ['embed_url', 'Embed Link', 'Embeddable link', 'Embeddable link for this TikTok video', 'Embed URL'],
  thumbnailUrl: ['thumbnail_url', 'temporary_thumbnail_url', 'Temporary Thumbnail URL', 'Temporary video thumbnail URL', 'Temporary URL for video content thumbnail'],
  durationSeconds: ['duration_seconds', 'duration', 'Video Duration', 'Video duration', 'Video duration in seconds, rounded to three decimal places'],
  views: ['views', 'Total Video Views', 'Total video views'],
  likes: ['likes', 'Total Likes', 'Total number of likes the video received'],
  comments: ['comments', 'Comment Count', 'Total number of comments the video received'],
  shares: ['shares', 'Share Count', 'Total number of times the video was shared'],
  averagePlayDuration: ['average_play_duration', 'average_video_play_duration', 'Average Video Play Duration', 'Average video play duration based on all views'],
  totalPlayDuration: ['total_play_duration', 'total_video_play_duration', 'Total Video Play Duration', 'Total video play duration based on all views'],
  completionRate: ['completion_rate', 'Percentage of Video Watched Completely', 'Percentage of video watched completely', 'Percentage of video watched completely based on all views'],
  uniqueViewers: ['unique_viewers', 'Total Number of Viewers', 'Total number of viewers who watched the video (deduplicated)'],
  trafficSources: ['traffic_sources', 'Traffic Sources', 'Different Sources of Video Exposure', 'Different sources of video exposure', 'Different sources of video exposure, arranged by exposure percentage', 'Different sources of video exposure, arranged by exposure percentage from high to low'],
  countryRegionBreakdown: ['country_region_breakdown', 'Audience Country/Region Breakdown', 'Audience country/region breakdown', 'Breakdown percentage data of audience country/region'],
});

/**
 * แปลงหนึ่งแถวจาก Lark TikTok For Creator เป็น Canonical object ของระบบ
 * Metric ที่ Source ไม่รองรับหรือไม่มีค่าจะคงเป็น null เพื่อไม่สร้างข้อมูลศูนย์ปลอม
 *
 * @param {Record<string, unknown>} row แถวข้อมูลดิบจาก Lark
 * @returns {Readonly<Record<string, unknown>>} ข้อมูล TikTok ที่ Normalize และ Freeze แล้ว
 */
export function mapTikTokCreatorVideoRow(row) {
  assertObject(row, 'TikTok creator row');

  const externalContentId = readTikTokVideoId(firstPresent(row, FIELD_ALIASES.videoId));

  // URL ของวิดีโอเป็นแหล่งที่ใช้ตรวจ Source handle และ Video ID
  // จึงอ่านเพียงครั้งเดียวและตรวจให้สัมพันธ์กับ externalContentId ก่อนนำไปสร้าง Stable Key
  const shareableUrl = readLarkUrl(firstPresent(row, FIELD_ALIASES.shareableUrl), {
    label: 'TikTok shareable URL',
  });

  const embedUrl = readLarkUrl(firstPresent(row, FIELD_ALIASES.embedUrl), {
    label: 'TikTok embed URL',
  });
  const videoIdentity = resolveTikTokVideoIdentity({
    externalContentId,
    shareableUrl,
    embedUrl,
  });

  return Object.freeze({
    platform: 'tiktok',
    externalContentId,
    publishedAt: toEpochMilliseconds(firstPresent(row, FIELD_ALIASES.publishedAt), {
      allowNull: true,
      label: 'TikTok published_at',
    }),
    description: readLarkText(firstPresent(row, FIELD_ALIASES.description), {
      label: 'TikTok description',
    }),
    shareableUrl,
    embedUrl,
    videoUrl: videoIdentity.videoUrl,
    thumbnailUrl: readLarkUrl(firstPresent(row, FIELD_ALIASES.thumbnailUrl), {
      label: 'TikTok thumbnail URL',
    }),
    sourceHandle: videoIdentity.sourceHandle,
    durationSeconds: toNullableSeconds(firstPresent(row, FIELD_ALIASES.durationSeconds), 'TikTok video duration'),
    metrics: Object.freeze({
      views: toNullableCount(firstPresent(row, FIELD_ALIASES.views), 'TikTok views'),
      likes: toNullableCount(firstPresent(row, FIELD_ALIASES.likes), 'TikTok likes'),
      comments: toNullableCount(firstPresent(row, FIELD_ALIASES.comments), 'TikTok comments'),
      shares: toNullableCount(firstPresent(row, FIELD_ALIASES.shares), 'TikTok shares'),
      averagePlayDurationSeconds: toNullableSeconds(firstPresent(row, FIELD_ALIASES.averagePlayDuration), 'TikTok average play duration'),
      totalPlayDurationSeconds: toNullableSeconds(firstPresent(row, FIELD_ALIASES.totalPlayDuration), 'TikTok total play duration'),
      completionRate: toNullableRatio(firstPresent(row, FIELD_ALIASES.completionRate)),
      uniqueViewers: toNullableCount(firstPresent(row, FIELD_ALIASES.uniqueViewers), 'TikTok unique viewers'),
      trafficSources: readLarkText(firstPresent(row, FIELD_ALIASES.trafficSources), {
        label: 'TikTok traffic sources',
      }),
      countryRegionBreakdown: readLarkText(firstPresent(row, FIELD_ALIASES.countryRegionBreakdown), {
        label: 'TikTok country/region breakdown',
      }),
    }),
  });
}

/**
 * เลือก URL วิดีโอ TikTok ที่ยืนยัน Domain/Handle แล้ว และปฏิเสธ URL สองช่องที่ชี้คนละบัญชี
 */
function resolveTikTokVideoIdentity(input) {
  const shareableIdentity = extractTikTokVideoUrlIdentity(input.shareableUrl);
  const embedIdentity = extractTikTokVideoUrlIdentity(input.embedUrl);
  const identities = [shareableIdentity, embedIdentity].filter(Boolean);
  const handles = [...new Set(identities.map((identity) => identity.handle))];
  const videoIds = [...new Set(identities.map((identity) => identity.videoId))];

  if (handles.length > 1) {
    throw new TypeError(`TikTok video URLs contain conflicting source handles: ${handles.join(', ')}`);
  }
  if (videoIds.length > 1) {
    throw new TypeError(`TikTok video URLs contain conflicting video IDs: ${videoIds.join(', ')}`);
  }
  if (videoIds.length === 1 && videoIds[0] !== input.externalContentId) {
    throw new TypeError(
      `TikTok video ID mismatch: raw=${input.externalContentId}, url=${videoIds[0]}`,
    );
  }

  const videoUrl = shareableIdentity
    ? input.shareableUrl
    : embedIdentity
      ? input.embedUrl
      : input.shareableUrl ?? input.embedUrl;

  return Object.freeze({
    videoUrl,
    sourceHandle: handles[0] ?? null,
  });
}

/**
 * อ่าน Handle จาก URL รูปแบบ /@handle/video/id
 * คืน null เมื่อ URL ไม่ใช่ TikTok video URL แทนการเดา Handle จากข้อความส่วนอื่น
 */
export function extractTikTokHandle(value) {
  return extractTikTokVideoUrlIdentity(value)?.handle ?? null;
}

/** อ่าน Handle และ Video ID จาก TikTok URL ที่ยืนยัน Domain/Path แล้ว */
function extractTikTokVideoUrlIdentity(value) {
  if (typeof value !== 'string' || value.trim() === '') return null;

  try {
    const url = new URL(value);
    const hostname = url.hostname.toLowerCase().replace(/\.$/u, '');
    // ป้องกัน URL จาก Domain อื่นที่ปลอม Path เป็น /@handle/video/... แล้วผ่าน Source identity guard
    if (hostname !== 'tiktok.com' && !hostname.endsWith('.tiktok.com')) return null;
    const match = url.pathname.match(/^\/@([^/]+)\/video\/([^/?#]+)/u);
    const handle = match?.[1]?.trim().toLowerCase();
    const videoId = match?.[2]?.trim();
    if (!handle || !videoId) return null;
    return Object.freeze({ handle, videoId });
  } catch {
    return null;
  }
}

/**
 * อ่าน Video ID โดยปฏิเสธ Number ที่เกินช่วงปลอดภัยของ JavaScript
 * TikTok ID จริงยาวเกิน Number.MAX_SAFE_INTEGER จึงต้องเก็บเป็น Text เพื่อไม่ให้เลขท้ายถูกปัด
 */
function readTikTokVideoId(value) {
  assertNoUnsafeIdentifierNumber(value);
  const text = readLarkText(value, { allowNull: false, label: 'TikTok video ID' });
  if (text && /^[+-]?(?:\d+\.\d+|\d+(?:e[+-]?\d+))$/iu.test(text)) {
    throw new TypeError('TikTok video ID must be stored as exact text, not decimal/scientific notation');
  }
  return text;
}

/** ตรวจเฉพาะ Property ที่ Lark ใช้ห่อค่าจริง เพื่อไม่ตีความ Metadata เป็น Identifier */
function assertNoUnsafeIdentifierNumber(value) {
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value)) {
      throw new TypeError('TikTok video ID number exceeds JavaScript safe integer range; store it as text');
    }
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) assertNoUnsafeIdentifierNumber(item);
    return;
  }
  if (!value || typeof value !== 'object') return;
  for (const key of ['text', 'name', 'value', 'option', 'label']) {
    if (Object.hasOwn(value, key)) assertNoUnsafeIdentifierNumber(value[key]);
  }
}

/**
 * เลือก Alias แรกที่มีค่าธุรกิจจริง
 * Cell wrapper ที่มีเพียง metadata เช่น {type:'url'} หรือ Array ว่างจะไม่บัง Alias ถัดไป
 */
function firstPresent(row, aliases) {
  for (const alias of aliases) {
    const value = row?.[alias];
    if (hasMeaningfulCellValue(value)) return value;
  }

  return null;
}

/** ตรวจค่าที่มีความหมายโดยคง 0/false และมองข้าม metadata ที่ไม่ใช่ข้อมูลของ Field */
function hasMeaningfulCellValue(value) {
  if (value === null || value === undefined) return false;
  if (typeof value === 'string') return value.trim() !== '';
  if (typeof value === 'number' || typeof value === 'boolean') return true;
  if (value instanceof Date) return Number.isFinite(value.getTime());
  if (Array.isArray(value)) return value.some((item) => hasMeaningfulCellValue(item));
  if (typeof value !== 'object') return false;

  return ['link', 'url', 'text', 'name', 'value', 'option', 'label']
    .some((key) => hasMeaningfulCellValue(value[key]));
}

/** บังคับข้อมูลดิบหนึ่งแถวให้เป็น Object ปกติ ไม่รับ null หรือ Array */
function assertObject(value, label) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
}

/** อ่าน Metric ตัวเลขทั่วไปและคืน null เมื่อ Source ไม่มีค่า */
function toNullableNumber(value, label = 'TikTok numeric metric') {
  if (value === null || value === undefined || value === '') return null;
  return readLarkNumber(value, { label });
}

/**
 * อ่าน Metric ประเภท Count โดยบังคับเป็นจำนวนเต็มไม่ติดลบ
 * ป้องกันค่าติดลบหรือทศนิยมที่ไม่สมเหตุผลหลุดเข้า Snapshot
 */
function toNullableCount(value, label) {
  const numericValue = toNullableNumber(value, label);
  if (numericValue === null) return null;
  if (!Number.isSafeInteger(numericValue) || numericValue < 0) {
    throw new RangeError(`${label} must be a non-negative safe integer`);
  }
  return numericValue;
}

/**
 * อ่าน Completion rate จาก 0-1, 0-100 หรือข้อความเปอร์เซ็นต์
 * ผลลัพธ์ Canonical ต้องอยู่ในช่วง 0-1 เท่านั้น
 */
function toNullableRatio(value) {
  if (value === null || value === undefined || value === '') return null;

  let ratio;
  if (typeof value === 'string' && value.trim().endsWith('%')) {
    ratio = toNullableNumber(value.trim().slice(0, -1), 'TikTok completion rate') / 100;
  } else {
    const numericValue = toNullableNumber(value, 'TikTok completion rate');
    if (numericValue === null) return null;
    ratio = numericValue > 1 && numericValue <= 100 ? numericValue / 100 : numericValue;
  }

  if (!Number.isFinite(ratio) || ratio < 0 || ratio > 1) {
    throw new RangeError('TikTok completion rate must be between 0 and 1, or 0% and 100%');
  }
  return ratio;
}

/** อ่าน Duration จากตัวเลขวินาทีหรือข้อความ HH:MM:SS/MM:SS และบังคับไม่ติดลบ */
function toNullableSeconds(value, label) {
  if (value === null || value === undefined || value === '') return null;

  const seconds = typeof value === 'string' && value.includes(':')
    ? parseClockDuration(value)
    : toNullableNumber(value, label);

  if (!Number.isFinite(seconds) || seconds < 0) {
    throw new RangeError(`${label} must be a non-negative duration in seconds`);
  }
  return seconds;
}

/**
 * แปลง MM:SS หรือ HH:MM:SS เป็นวินาที
 * นาที/วินาทีในรูปแบบ Clock ต้องน้อยกว่า 60 เพื่อปฏิเสธค่ากำกวม เช่น 00:99:99
 */
function parseClockDuration(value) {
  const text = String(value).trim();
  if (!/^\d+(?::\d{1,2}){1,2}(?:\.\d+)?$/u.test(text)) {
    throw new TypeError(`Invalid TikTok duration value: ${value}`);
  }

  const parts = text.split(':').map((part) => Number(part));
  const [hours, minutes, seconds] = parts.length === 3 ? parts : [0, parts[0], parts[1]];
  if (![hours, minutes, seconds].every(Number.isFinite) || hours < 0 || minutes < 0 || seconds < 0) {
    throw new TypeError(`Invalid TikTok duration value: ${value}`);
  }
  if (minutes >= 60 || seconds >= 60) {
    throw new RangeError(`Invalid TikTok clock duration value: ${value}`);
  }

  return hours * 3600 + minutes * 60 + seconds;
}
