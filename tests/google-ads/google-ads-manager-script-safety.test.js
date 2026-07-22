import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const scriptUrl = new URL('../../scripts/google-ads-manager-script-signed-delivery.js', import.meta.url);

test('Manager Script is exact-account, read-only, DRY_RUN by default, and schedule-free', async () => {
  const source = await readFile(scriptUrl, 'utf8');
  assert.match(source, /EXECUTION_MODE:\s*'DRY_RUN'/u);
  assert.match(source, /MANAGER_CUSTOMER_ID:\s*'946-357-0541'/u);
  assert.match(source, /TARGET_CUSTOMER_ID:\s*'566-233-2033'/u);
  assert.match(source, /AdsManagerApp\.accounts\(\)\.withIds\(\[CONFIG\.TARGET_CUSTOMER_ID\]\)/u);
  assert.match(source, /AdsManagerApp\.select\(target\)/u);
  assert.match(source, /AdsApp\.search\(/u);
  assert.doesNotMatch(source, /campaign\.start_date|campaign\.end_date/u);
  assert.doesNotMatch(source, /ScriptApp|newTrigger|\.createCampaign\(|\.pause\(|\.enable\(|\.remove\(|\.setBudget\(/u);
  assert.doesNotMatch(source, /MKT_GOOGLE_ADS_SIGNING_SECRET\s*[:=]\s*['"][^'"]{10,}/u);
});

test('Manager Script uses bounded retry/backoff and a fresh nonce while keeping one idempotency key', async () => {
  const source = await readFile(scriptUrl, 'utf8');
  assert.match(source, /MAX_ATTEMPTS:\s*3/u);
  assert.match(source, /Math\.pow\(2, attempt - 1\)/u);
  assert.match(source, /var nonce = nonce_\(\)/u);
  assert.match(source, /var idempotencyKey = 'google-ads:' \+ deliveryId/u);
  assert.match(source, /status === 429 \|\| status >= 500/u);
});


test('Manager Script converts decimal currency metrics to integer micros without float multiplication', async () => {
  const source = await readFile(scriptUrl, 'utf8');
  assert.doesNotMatch(source, /Math\.round\(number \* 1000000\)/u);
  const context = {};
  vm.runInNewContext(source, context);
  assert.equal(context.currencyToMicros_('689.23'), 689230000);
  assert.equal(context.currencyToMicros_('0'), 0);
  assert.equal(context.currencyToMicros_('0.0000005'), 1);
  assert.equal(context.currencyToMicros_('1e-6'), 1);
  assert.throws(() => context.currencyToMicros_('-1'), /INVALID_CURRENCY_DECIMAL/u);
});


test('Manager Script account selection fails closed for missing, ambiguous, and mismatched targets', async () => {
  const source = await readFile(scriptUrl, 'utf8');
  function account(id) { return { getCustomerId() { return id; } }; }
  function contextFor(ids) {
    const values = ids.map(account);
    return {
      AdsManagerApp: {
        accounts() {
          return {
            withIds(requested) {
              assert.deepEqual(Array.from(requested), ['566-233-2033']);
              return {
                get() {
                  let index = 0;
                  return {
                    hasNext() { return index < values.length; },
                    next() { return values[index++]; },
                  };
                },
              };
            },
          };
        },
      },
    };
  }

  const missing = contextFor([]);
  vm.runInNewContext(source, missing);
  assert.throws(() => missing.selectExactlyOneTarget_(), /TARGET_ACCOUNT_NOT_SELECTABLE/u);

  const ambiguous = contextFor(['566-233-2033', '566-233-2033']);
  vm.runInNewContext(source, ambiguous);
  assert.throws(() => ambiguous.selectExactlyOneTarget_(), /TARGET_ACCOUNT_SELECTION_AMBIGUOUS/u);

  const mismatch = contextFor(['111-222-3333']);
  vm.runInNewContext(source, mismatch);
  assert.throws(() => mismatch.selectExactlyOneTarget_(), /TARGET_ACCOUNT_IDENTITY_MISMATCH/u);

  const exact = contextFor(['566-233-2033']);
  vm.runInNewContext(source, exact);
  assert.equal(exact.selectExactlyOneTarget_().getCustomerId(), '566-233-2033');
});
