const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const Module = require('node:module');
function load(path) {
  const mod = new Module(path);
  mod._compile(ts.transpileModule(fs.readFileSync(path, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }
  }).outputText, path + '.cjs');
  return mod.exports;
}
const { composeQuestionText } = load('src/components/Audio/QuestionText.ts');
const { pauseAndSend, flushRecording } = load('src/components/Audio/VoiceSubmission.ts');
test('typing preserves trailing spaces, repeated spaces, leading spaces and newlines', () => {
  for (const text of ['hello ', 'hello  ', '  hello ', 'hello\n', ' ']) {
    assert.equal(composeQuestionText(text, ''), text);
  }
  assert.equal(composeQuestionText('hello ', '') + 'world', 'hello world');
});
test('live speech joins the draft without stripping typed whitespace', () => {
  assert.equal(composeQuestionText('hello ', 'world'), 'hello world');
  assert.equal(composeQuestionText('hello', 'world'), 'hello world');
  assert.equal(composeQuestionText('', 'hello'), 'hello');
  assert.equal(composeQuestionText('hello  ', 'world'), 'hello  world');
});
test('Pause begins sending before microphone cleanup', () => {
  const order = [];
  pauseAndSend(true, false, () => order.push('send'), () => order.push('pause'));
  assert.deepEqual(order, ['send', 'pause']);
});
test('Pause stops an empty recording without submitting silence', () => {
  let paused = false;
  pauseAndSend(false, false, () => assert.fail('No question to send'), () => { paused = true; });
  assert.equal(paused, true);
});
test('Pause never duplicates an in-flight request', () => {
  let paused = false;
  pauseAndSend(true, true, () => assert.fail('Already sending'), () => { paused = true; });
  assert.equal(paused, true);
});
class Recorder extends EventTarget {
  state = 'recording';
  chunks = ['first audio chunk'];
  stop() {
    this.state = 'inactive';
    queueMicrotask(() => {
      this.chunks.push('final audio chunk');
      this.dispatchEvent(new Event('stop'));
    });
  }
}
test('recording flush waits until the final audio chunk arrives', async () => {
  const recorder = new Recorder();
  await flushRecording(recorder);
  assert.deepEqual(recorder.chunks, ['first audio chunk', 'final audio chunk']);
  await flushRecording(recorder);
  assert.equal(recorder.chunks.length, 2);
});
test('recording errors reject without leaving the submission stuck', async () => {
  const recorder = new Recorder();
  recorder.stop = () => { recorder.state = 'inactive'; recorder.dispatchEvent(new Event('error')); };
  await assert.rejects(flushRecording(recorder), /Audio recording failed/);
});
