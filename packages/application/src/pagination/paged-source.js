import { permanentError } from '../../../shared/src/errors/runtime-error.js';

const DEFAULT_MAX_PAGES = 1_000;

/**
 * เดิน Source ทีละหน้าโดยไม่สะสมทุก Item ในหน่วยความจำ
 * Provider adapter รับผิดชอบแปลง Response เป็น { items, hasMore, nextCursor } เท่านั้น
 */
export async function* iteratePagedSourcePages(input = {}) {
  const readPage = requireFunction(input.readPage, 'readPage');
  const maxPages = positiveInteger(input.maxPages ?? DEFAULT_MAX_PAGES, 'maxPages');
  const onPage = typeof input.onPage === 'function' ? input.onPage : () => undefined;
  let cursor = optionalCursor(input.initialCursor);
  const visited = new Set();

  if (cursor) visited.add(cursor);

  for (let pageNumber = 1; pageNumber <= maxPages; pageNumber += 1) {
    const response = normalizePage(await readPage(Object.freeze({
      cursor,
      pageNumber,
    })), pageNumber);

    if (response.hasMore) {
      if (!response.nextCursor) {
        throw permanentError('Paged source returned hasMore without a next cursor', {
          code: 'PAGED_SOURCE_CURSOR_MISSING',
          details: { pageNumber },
        });
      }
      if (response.nextCursor === cursor || visited.has(response.nextCursor)) {
        throw permanentError('Paged source returned a repeated cursor', {
          code: 'PAGED_SOURCE_CURSOR_REPEATED',
          details: { pageNumber },
        });
      }
    } else if (response.nextCursor) {
      throw permanentError('Paged source returned a next cursor while hasMore is false', {
        code: 'PAGED_SOURCE_CURSOR_UNEXPECTED',
        details: { pageNumber },
      });
    }

    const page = Object.freeze({
      pageNumber,
      cursor,
      items: response.items,
      hasMore: response.hasMore,
      nextCursor: response.nextCursor,
      metadata: response.metadata,
    });
    onPage(Object.freeze({
      pageNumber,
      itemCount: response.items.length,
      hasMore: response.hasMore,
    }));
    yield page;

    if (!response.hasMore) return;
    visited.add(response.nextCursor);
    cursor = response.nextCursor;
  }

  throw permanentError('Paged source exceeded the configured maximum pages', {
    code: 'PAGED_SOURCE_MAX_PAGES_EXCEEDED',
    details: { maxPages },
  });
}

/**
 * Consume ทีละหน้าและคืนเฉพาะ Counter/metadata ที่มีขนาดคงที่
 * callback ต้องทำ Normalize/Plan/Write/Checkpoint ให้เสร็จก่อน Promise resolve
 */
export async function consumePagedSource(input = {}) {
  const consumePage = requireFunction(input.consumePage, 'consumePage');
  let pagesProcessed = 0;
  let itemsProcessed = 0;

  for await (const page of iteratePagedSourcePages(input)) {
    await consumePage(page);
    pagesProcessed += 1;
    itemsProcessed += page.items.length;
  }

  return Object.freeze({ pagesProcessed, itemsProcessed });
}

function normalizePage(value, pageNumber) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw permanentError('Paged source response must be an object', {
      code: 'PAGED_SOURCE_RESPONSE_INVALID',
      details: { pageNumber },
    });
  }
  if (!Array.isArray(value.items)) {
    throw permanentError('Paged source response must contain an items array', {
      code: 'PAGED_SOURCE_RESPONSE_INVALID',
      details: { pageNumber },
    });
  }

  const hasMore = value.hasMore === true;
  const nextCursor = optionalCursor(value.nextCursor);
  return Object.freeze({
    items: Object.freeze([...value.items]),
    hasMore,
    nextCursor,
    metadata: freezeMetadata(value.metadata),
  });
}

function freezeMetadata(value) {
  if (value === null || value === undefined) return Object.freeze({});
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('Paged source metadata must be an object');
  }
  return Object.freeze({ ...value });
}

function optionalCursor(value) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'string' || value.trim() === '') {
    throw new TypeError('Paged source cursor must be a non-empty string');
  }
  return value.trim();
}

function requireFunction(value, fieldName) {
  if (typeof value !== 'function') throw new TypeError(`Paged source requires ${fieldName}`);
  return value;
}

function positiveInteger(value, fieldName) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number <= 0) {
    throw new TypeError(`Paged source ${fieldName} must be a positive integer`);
  }
  return number;
}
