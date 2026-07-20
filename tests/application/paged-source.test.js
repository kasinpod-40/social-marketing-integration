import test from 'node:test';
import assert from 'node:assert/strict';
import {
  consumePagedSource,
  iteratePagedSourcePages,
} from '../../packages/application/src/pagination/paged-source.js';

test('paged source consumes 10,000 items while exposing only one bounded page at a time', async () => {
  const totalItems = 10_000;
  const pageSize = 100;
  let activePages = 0;
  let maxActivePages = 0;
  let largestPage = 0;

  const summary = await consumePagedSource({
    maxPages: 200,
    readPage: async ({ pageNumber }) => {
      const start = (pageNumber - 1) * pageSize;
      const remaining = totalItems - start;
      const count = Math.max(0, Math.min(pageSize, remaining));
      return {
        items: Array.from({ length: count }, (_, index) => ({ id: start + index + 1 })),
        hasMore: start + count < totalItems,
        nextCursor: start + count < totalItems ? `cursor-${pageNumber + 1}` : null,
      };
    },
    consumePage: async (page) => {
      activePages += 1;
      maxActivePages = Math.max(maxActivePages, activePages);
      largestPage = Math.max(largestPage, page.items.length);
      assert.ok(page.items.length <= pageSize);
      activePages -= 1;
    },
  });

  assert.deepEqual(summary, { pagesProcessed: 100, itemsProcessed: 10_000 });
  assert.equal(maxActivePages, 1);
  assert.equal(largestPage, 100);
});

test('paged source fails closed for missing, repeated and unexpected cursors', async () => {
  await assert.rejects(
    async () => {
      for await (const _page of iteratePagedSourcePages({
        readPage: async () => ({ items: [], hasMore: true, nextCursor: null }),
      })) {
        // generator must throw before yielding an invalid page
      }
    },
    (error) => error?.code === 'PAGED_SOURCE_CURSOR_MISSING' && error.retryable === false,
  );

  await assert.rejects(
    async () => {
      for await (const _page of iteratePagedSourcePages({
        initialCursor: 'same',
        readPage: async () => ({ items: [], hasMore: true, nextCursor: 'same' }),
      })) {
        // generator must throw before yielding an invalid page
      }
    },
    (error) => error?.code === 'PAGED_SOURCE_CURSOR_REPEATED' && error.retryable === false,
  );

  await assert.rejects(
    async () => {
      for await (const _page of iteratePagedSourcePages({
        readPage: async () => ({ items: [], hasMore: false, nextCursor: 'unexpected' }),
      })) {
        // generator must throw before yielding an invalid page
      }
    },
    (error) => error?.code === 'PAGED_SOURCE_CURSOR_UNEXPECTED' && error.retryable === false,
  );
});

test('paged source enforces max page safety without restarting from the first page', async () => {
  const cursors = [];
  await assert.rejects(
    async () => {
      for await (const page of iteratePagedSourcePages({
        maxPages: 3,
        readPage: async ({ cursor, pageNumber }) => {
          cursors.push(cursor);
          return {
            items: [{ pageNumber }],
            hasMore: true,
            nextCursor: `cursor-${pageNumber}`,
          };
        },
      })) {
        assert.equal(page.items.length, 1);
      }
    },
    (error) => error?.code === 'PAGED_SOURCE_MAX_PAGES_EXCEEDED' && error.retryable === false,
  );
  assert.deepEqual(cursors, [null, 'cursor-1', 'cursor-2']);
});
