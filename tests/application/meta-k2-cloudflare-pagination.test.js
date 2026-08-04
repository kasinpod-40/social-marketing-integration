import assert from 'node:assert/strict';
import test from 'node:test';

import {
  resolveMetaK2CloudflarePagination,
} from '../../scripts/lib/meta-k2-cloudflare-pagination.js';

test('accepts an omitted result_info object for an unambiguously terminal page', () => {
  assert.deepEqual(resolveMetaK2CloudflarePagination({
    resultInfo: undefined,
    resultCount: 0,
    requestedPage: 1,
    requestedPageSize: 100,
    maxPages: 20,
  }), {
    totalPages: 1,
    metadataPresent: false,
  });
});

test('accepts total_pages zero only for an empty first page', () => {
  assert.deepEqual(resolveMetaK2CloudflarePagination({
    resultInfo: {
      page: 1,
      per_page: 100,
      count: 0,
      total_count: 0,
      total_pages: 0,
    },
    resultCount: 0,
    requestedPage: 1,
    requestedPageSize: 100,
    maxPages: 20,
  }), {
    totalPages: 0,
    metadataPresent: true,
  });

  assert.throws(
    () => resolveMetaK2CloudflarePagination({
      resultInfo: { page: 1, per_page: 100, count: 1, total_pages: 0 },
      resultCount: 1,
      requestedPage: 1,
      requestedPageSize: 100,
      maxPages: 20,
    }),
    (error) => error.code === 'META_K2_CLOUDFLARE_RECOVERY_RESPONSE_INVALID',
  );
});

test('derives total pages from total_count when total_pages is omitted', () => {
  assert.deepEqual(resolveMetaK2CloudflarePagination({
    resultInfo: {
      page: 1,
      per_page: 100,
      count: 100,
      total_count: 150,
    },
    resultCount: 100,
    requestedPage: 1,
    requestedPageSize: 100,
    maxPages: 20,
  }), {
    totalPages: 2,
    metadataPresent: true,
  });
});

test('rejects ambiguous full pages and inconsistent metadata', () => {
  assert.throws(
    () => resolveMetaK2CloudflarePagination({
      resultInfo: undefined,
      resultCount: 100,
      requestedPage: 1,
      requestedPageSize: 100,
      maxPages: 20,
    }),
    (error) => error.code === 'META_K2_CLOUDFLARE_RECOVERY_RESPONSE_INVALID',
  );
  assert.throws(
    () => resolveMetaK2CloudflarePagination({
      resultInfo: {
        page: 2,
        per_page: 100,
        count: 1,
        total_pages: 1,
      },
      resultCount: 1,
      requestedPage: 1,
      requestedPageSize: 100,
      maxPages: 20,
    }),
    (error) => error.code === 'META_K2_CLOUDFLARE_RECOVERY_RESPONSE_INVALID',
  );
});
