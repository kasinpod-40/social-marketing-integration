import test from 'node:test';
import assert from 'node:assert/strict';
import { D1OrganicHistoryGateway } from '../../packages/connectors/src/d1-organic-history-gateway.js';

const D1_MAX_BOUND_PARAMETERS = 100;
const OBSERVED_AT = 1784829780000;

test('Organic observation repair reads stay within the D1 100-bound-parameter limit', async () => {
  const bindCounts = [];
  const db = Object.freeze({
    prepare() {
      return Object.freeze({
        bind(...values) {
          bindCounts.push(values.length);
          if (values.length > D1_MAX_BOUND_PARAMETERS) {
            throw new Error(`too many SQL variables: ${values.length}`);
          }
          return Object.freeze({
            async all() {
              return Object.freeze({ results: Object.freeze([]) });
            },
          });
        },
      });
    },
  });
  const gateway = new D1OrganicHistoryGateway({ db });
  const contentKeys = Array.from({ length: 500 }, (_, index) => `content:${index + 1}`);

  const observed = await gateway.listObservedContentKeysAt(contentKeys, OBSERVED_AT);

  assert.deepEqual(observed, []);
  assert.deepEqual(bindCounts, [100, 100, 100, 100, 100, 6]);
  assert.ok(bindCounts.every((count) => count <= D1_MAX_BOUND_PARAMETERS));
});
