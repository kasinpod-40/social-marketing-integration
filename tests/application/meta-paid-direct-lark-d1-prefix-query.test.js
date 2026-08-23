import test from 'node:test';
import assert from 'node:assert/strict';
import { buildMetaPaidDirectCandidateSql } from '../../scripts/lib/meta-paid-direct-lark-materializer.js';

test('direct Meta candidate discovery avoids D1 LIKE/GLOB prefix matching', () => {
  const sql = buildMetaPaidDirectCandidateSql('chemistry_k2');

  assert.match(
    sql,
    /WHERE substr\(r\.work_key, 1, length\('meta_ads:chemistry_k2:'\)\) = 'meta_ads:chemistry_k2:'/u,
  );
  assert.match(
    sql,
    /CASE WHEN substr\(r\.work_key, 1, length\('meta_ads:chemistry_k2:meta-chemistry_k2-history-20260701-20260731-'\)\) = 'meta_ads:chemistry_k2:meta-chemistry_k2-history-20260701-20260731-' THEN 0 ELSE 1 END/u,
  );
  assert.doesNotMatch(sql, /\b(?:LIKE|GLOB)\b/iu);
});
