const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const Module = require('node:module');
const compiled = ts.transpileModule(fs.readFileSync('electron/QuestionAnswer.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }
}).outputText;
const loaded = new Module('question-answer');
loaded._compile(compiled, 'question-answer.cjs');
const { questionPrompt, normalizeAnswer } = loaded.exports;

test('general questions retain a full answer without code or complexity', () => {
  for (const type of ['mathematics', 'science', 'medical', 'legal', 'humanities', 'business', 'writing', 'general']) {
    const answer = normalizeAnswer({ type, answer: 'A complete explanation.\n1. A worked step.', code: 'irrelevant', time_complexity: 'O(N)' });
    assert.equal(answer.answer, 'A complete explanation.\n1. A worked step.');
    assert.equal(answer.code, null);
    assert.equal(answer.time_complexity, null);
    assert.equal(answer.space_complexity, null);
    assert.equal(answer.star_breakdown, null);
  }
});
test('coding questions preserve code and actual complexity', () => {
  const answer = normalizeAnswer({ type: 'coding', answer: 'Add the numbers.', code: '```python\ndef add(a, b): return a + b\n```', time_complexity: 'O(1)' });
  assert.equal(answer.code, 'def add(a, b): return a + b');
  assert.equal(answer.time_complexity, 'O(1)');
});
test('MCQ, behavioral and architecture responses preserve applicable fields', () => {
  assert.equal(normalizeAnswer({ type: 'mcq', mcq_answer: 'B: Oxygen', mcq_eliminations: ['A is incorrect'] }).answer, 'B: Oxygen');
  assert.equal(normalizeAnswer({ type: 'behavioral', answer: 'Use your own experience.', star_breakdown: { situation: 'Example', result: 'Outcome' } }).star_breakdown.result, 'Outcome');
  assert.deepEqual(normalizeAnswer({ type: 'system_design', answer: 'Use a queue.', system_design: { core_components: ['Queue', null] } }).system_design.core_components, ['Queue']);
});
test('legacy talking points remain usable and malformed results are rejected', () => {
  assert.equal(normalizeAnswer({ thoughts: ['First', 'Second'] }).answer, 'First\n\nSecond');
  for (const invalid of [null, [], 'text', {}, { answer: 12 }]) assert.throws(() => normalizeAnswer(invalid));
});
test('one prompt supports screenshots, transcripts and general subject explanations', () => {
  const prompt = questionPrompt('python', 'Explain photosynthesis.');
  assert.match(prompt, /mathematics, sciences, medicine, law, history/);
  assert.match(prompt, /Answer every question/);
  assert.match(prompt, /Non-coding questions must have null code/);
  assert.match(prompt, /Explain photosynthesis/);
  assert.match(prompt, /"answer"/);
});

function processingFixture(provider, fail = false, failCount = 0) {
  const calls = [];
  const events = [];
  let problem;
  const answer = { type: 'science', title: 'Photosynthesis', problem_statement: 'What is photosynthesis?', answer: 'Plants convert light energy into chemical energy.', thoughts: ['Light supplies energy.'] };
  const response = JSON.stringify(answer);
  const config = { apiProvider: provider, apiKey: 'test-key', solutionModel: 'test-model', language: 'python' };
  const request = async (payload, options) => {
    calls.push({ payload, options });
    if (fail) throw new Error('Provider unavailable');
    return { choices: [{ message: { content: response } }], content: [{ type: 'text', text: response }] };
  };
  class SDK {
    chat = { completions: { create: request } };
    messages = { create: request };
  }
  let geminiAttempts = 0;
  const retryModule = new Module('request-retry');
  retryModule._compile(ts.transpileModule(fs.readFileSync('electron/RequestRetry.ts', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }
  }).outputText, 'request-retry.cjs');
  const mocks = {
    './RequestRetry': { ...retryModule.exports, retryTransientRequest: (request, options) => retryModule.exports.retryTransientRequest(request, { ...options, wait: async delay => calls.push({ retryDelay: delay }) }) },
    './QuestionAnswer': loaded.exports,
    './ConfigHelper': { configHelper: { loadConfig: () => config, on: () => {} } },
    'openai': { OpenAI: SDK },
    '@anthropic-ai/sdk': SDK,
    'electron': { clipboard: { writeText: text => calls.push({ copied: text }) } },
    'axios': { post: async (url, payload, options) => {
      calls.push({ url, payload, options });
      if (++geminiAttempts <= failCount) throw { response: { status: 503, headers: {} } };
      if (fail) throw new Error('Provider unavailable');
      return { data: { candidates: [{ content: { parts: [{ text: response }] } }] } };
    }, isCancel: () => false }
  };
  const mod = new Module('processing-helper');
  mod.require = name => Object.hasOwn(mocks, name) ? mocks[name] : require(name);
  mod._compile(ts.transpileModule(fs.readFileSync('electron/ProcessingHelper.ts', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true }
  }).outputText, 'processing-helper.cjs');
  const deps = {
    getScreenshotHelper: () => ({ getScreenshotQueue: () => queues.main, getExtraScreenshotQueue: () => queues.extra, clearExtraScreenshotQueue: () => {} }),
    getMainWindow: () => ({ isDestroyed: () => false, webContents: { send: (event, data) => events.push({ event, data }) } }),
    setProblemInfo: value => { problem = value; }, getProblemInfo: () => problem,
    setView: () => {}, setHasDebugged: () => {},
    PROCESSING_EVENTS: { INITIAL_START: 'start', INITIAL_SOLUTION_ERROR: 'error', PROBLEM_EXTRACTED: 'question', SOLUTION_SUCCESS: 'answer' }
  };
  const queues = { main: [], extra: [] };
  return { helper: new mod.exports.ProcessingHelper(deps), calls, events, queues, config, deps };
}

test('all providers answer text and screenshots using the universal format', async () => {
  for (const provider of ['openai', 'gemini', 'anthropic']) {
    const { helper, calls, events } = processingFixture(provider);
    await helper.processAudioQuestion('What is photosynthesis?');
    assert.equal(events.find(event => event.event === 'answer').data.type, 'science');
    assert.equal(calls.find(call => call.copied).copied, 'Plants convert light energy into chemical energy.');
    const result = await helper.processScreenshotsHelper([{ path: 'test.png', data: 'image-base64' }], new AbortController().signal);
    assert.equal(result.success, true);
    assert.equal(result.data.code, null);
    assert.ok(JSON.stringify(calls).includes('image-base64'));
    assert.ok(JSON.stringify(calls).includes('mathematics, sciences'));
  }
});
test('Gemini accepts raw audio and unsupported providers return an explicit error', async () => {
  const gemini = processingFixture('gemini');
  await gemini.helper.processAudioDirect('audio-base64', 'audio/webm;codecs=opus');
  assert.ok(JSON.stringify(gemini.calls).includes('audio-base64'));
  assert.equal(gemini.calls[0].payload.contents[0].parts[1].inlineData.mimeType, 'audio/webm');
  const openai = processingFixture('openai');
  await assert.rejects(openai.helper.processAudioDirect('audio-base64'), /Raw audio requires Gemini/);
  assert.ok(openai.events.some(event => event.event === 'error'));
});
test('provider failures are reported instead of returning a false success', async () => {
  const { helper, events } = processingFixture('gemini', true);
  await assert.rejects(helper.processAudioQuestion('Explain gravity'), /Provider unavailable/);
  assert.equal(events.find(event => event.event === 'error').data, 'Provider unavailable');
  assert.equal(events.some(event => event.event === 'answer'), false);
});

test('text submission recovers from Gemini 503s and reports retry progress', async () => {
  const { helper, calls, events } = processingFixture('gemini', false, 2);
  await helper.processAudioQuestion('What is photosynthesis?');
  assert.equal(calls.filter(call => call.url).length, 3);
  assert.equal(calls.filter(call => call.retryDelay).length, 2);
  assert.equal(events.filter(event => event.event === 'answer').length, 1);
  assert.equal(events.filter(event => event.event === 'error').length, 0);
  assert.ok(events.some(event => event.event === 'processing-status' && /Retrying/.test(event.data.message)));
  assert.ok(calls.filter(call => call.url).every(call => !call.url.includes('key=')));
});
test('persistent Gemini 503s return a clean error for manual retry', async () => {
  const { helper, events } = processingFixture('gemini', false, 10);
  await assert.rejects(helper.processAudioQuestion('Explain gravity'), /Gemini is temporarily unavailable/);
  assert.equal(events.some(event => event.event === 'answer'), false);
  assert.match(events.find(event => event.event === 'error').data, /question was kept/);
});

test('short typed requests attach main and extra screenshots for every provider', async () => {
  const directory = fs.mkdtempSync(require('node:path').join(require('node:os').tmpdir(), 'question-context-'));
  try {
    const main = require('node:path').join(directory, 'main.png');
    const extra = require('node:path').join(directory, 'extra.png');
    fs.writeFileSync(main, 'main screenshot');
    fs.writeFileSync(extra, 'extra screenshot');
    for (const provider of ['openai', 'gemini', 'anthropic']) {
      const fixture = processingFixture(provider);
      fixture.queues.main.push(main);
      fixture.queues.extra.push(extra, main, require('node:path').join(directory, 'deleted.png'));
      await fixture.helper.processAudioQuestion('fix');
      const payload = JSON.stringify(fixture.calls.find(call => call.payload).payload);
      assert.ok(payload.includes(Buffer.from('main screenshot').toString('base64')));
      assert.ok(payload.includes(Buffer.from('extra screenshot').toString('base64')));
      assert.match(payload, /Latest user request: fix/);
      assert.match(payload, /Read the screenshots before answering/);
    }
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test('follow-ups retain the previous question and code, and reset discards that context', async () => {
  const { helper, deps, calls } = processingFixture('openai');
  deps.setProblemInfo({ type: 'coding', problem_statement: 'Add two integers', code: 'func add(a, b int) int { return a + b }' });
  await helper.processAudioQuestion('fix');
  const payload = JSON.stringify(calls.find(call => call.payload).payload);
  assert.match(payload, /Add two integers/);
  assert.match(payload, /func add/);
  helper.cancelOngoingRequests();
  const count = calls.length;
  await helper.regenerateForLanguage();
  assert.equal(calls.length, count);
  await helper.processAudioQuestion('Explain gravity');
  assert.ok(!JSON.stringify(calls.slice(count)).includes('Add two integers'));
});

test('language regeneration reuses screenshot input and requests the newly selected language', async () => {
  for (const provider of ['openai', 'gemini', 'anthropic']) {
    const { helper, config, calls, events } = processingFixture(provider);
    await helper.regenerateForLanguage();
    assert.equal(calls.length, 0);
    await helper.processScreenshotsHelper([{ path: 'test.png', data: 'original-image' }], new AbortController().signal);
    config.language = 'java';
    await helper.regenerateForLanguage();
    const payload = JSON.stringify(calls.filter(call => call.payload).at(-1).payload);
    assert.match(payload, /original-image/);
    assert.match(payload, /write the solution in java/);
    assert.ok(events.some(event => event.event === 'start'));
    assert.ok(events.some(event => event.event === 'answer'));
  }
});

test('cancelled regeneration cannot overwrite a newer answer', async () => {
  const { helper, events } = processingFixture('openai');
  let finish;
  helper.requestQuestionAnswer = () => new Promise(resolve => { finish = resolve; });
  const pending = helper.processAudioQuestion('First question');
  helper.cancelOngoingRequests();
  finish({ type: 'general', answer: 'Stale answer' });
  await pending;
  assert.equal(events.some(event => event.event === 'answer'), false);
});

test('saving a changed language triggers regeneration without waiting for the provider', async () => {
  const handlers = new Map();
  let config = { language: 'golang' };
  let generations = 0;
  const mod = new Module('ipc-handlers');
  mod.require = name => {
    if (name === 'electron') return { ipcMain: { handle: (name, handler) => handlers.set(name, handler) } };
    if (name === './ConfigHelper') return { configHelper: {
      loadConfig: () => config,
      updateConfig: updates => (config = { ...config, ...updates })
    } };
    return require(name);
  };
  mod._compile(ts.transpileModule(fs.readFileSync('electron/ipcHandlers.ts', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }
  }).outputText, 'ipc-handlers.cjs');
  mod.exports.initializeIpcHandlers({ processingHelper: {
    regenerateForLanguage: () => { generations++; return new Promise(() => {}); }
  } });
  const update = handlers.get('update-config');
  assert.equal(update(null, { language: 'java' }).language, 'java');
  assert.equal(generations, 1);
  update(null, { language: 'java' });
  update(null, { opacity: 0.8 });
  assert.equal(generations, 1);
});
