const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const Module = require('node:module');
const loaded = new Module('request-retry');
loaded._compile(ts.transpileModule(fs.readFileSync('electron/RequestRetry.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }
}).outputText, 'request-retry.cjs');
const { retryTransientRequest, waitForRetry, requestErrorMessage } = loaded.exports;
const serviceError = status => ({ response: { status, headers: {} }, config: { url: 'https://example.test?key=private-test-key' } });
test('503 errors back off and eventually return the successful response', async () => {
  let attempts = 0; const delays = [], progress = [];
  const result = await retryTransientRequest(async () => {
    if (++attempts < 4) throw serviceError(503);
    return 'answer';
  }, { random: () => 0, wait: async delay => delays.push(delay), onRetry: attempt => progress.push(attempt) });
  assert.equal(result, 'answer'); assert.equal(attempts, 4);
  assert.deepEqual(delays, [1000, 2000, 4000]); assert.deepEqual(progress, [2, 3, 4]);
});
test('persistent outages stop after four total attempts', async () => {
  let attempts = 0;
  await assert.rejects(retryTransientRequest(async () => { attempts++; throw serviceError(503); }, { wait: async () => {} }));
  assert.equal(attempts, 4);
});
test('invalid credentials and invalid requests are never retried', async () => {
  for (const status of [400, 401, 402, 403, 404]) {
    let attempts = 0;
    await assert.rejects(retryTransientRequest(async () => { attempts++; throw serviceError(status); }, { wait: async () => assert.fail('Should not retry') }));
    assert.equal(attempts, 1);
  }
});
test('Retry-After is respected and excessive delays are bounded', async () => {
  for (const seconds of [5, 120]) {
    let attempts = 0; const delays = [];
    await retryTransientRequest(async () => {
      if (++attempts === 1) throw { response: { status: 429, headers: { 'retry-after': String(seconds) } } };
      return 'answer';
    }, { random: () => 0, wait: async delay => delays.push(delay) });
    assert.deepEqual(delays, [Math.min(seconds * 1000, 30000)]);
  }
});
test('canceling during backoff prevents further requests', async () => {
  const controller = new AbortController(); let attempts = 0;
  await assert.rejects(retryTransientRequest(async () => { attempts++; throw serviceError(503); }, {
    signal: controller.signal, wait: async () => controller.abort()
  }), { name: 'AbortError' });
  assert.equal(attempts, 1);
});
test('real backoff wait can be canceled immediately', async () => {
  const controller = new AbortController();
  const waiting = waitForRetry(30000, controller.signal); controller.abort();
  await assert.rejects(waiting, { name: 'AbortError' });
});
test('errors expose a useful message without credentials or request dumps', () => {
  const message = requestErrorMessage(serviceError(503), 'Gemini');
  assert.match(message, /temporarily unavailable/); assert.match(message, /question was kept/);
  assert.equal(message.includes('private-test-key'), false);
  assert.match(requestErrorMessage(serviceError(401), 'Gemini'), /API key/);
  assert.match(requestErrorMessage(serviceError(429), 'Gemini'), /quota/);
  assert.equal(requestErrorMessage(new Error('https://example.test?key=private-test-key')).includes('private-test-key'), false);
});
