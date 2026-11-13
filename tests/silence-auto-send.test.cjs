const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const Module = require('node:module');
const loaded = new Module('silence-auto-send');
loaded._compile(ts.transpileModule(fs.readFileSync('src/components/Audio/SilenceAutoSend.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }
}).outputText, 'silence-auto-send.cjs');
const { SilenceAutoSend } = loaded.exports;
function fixture() {
  let now = 0, id = 0, sends = 0;
  const timers = new Map();
  const detector = new SilenceAutoSend(() => sends++, 3000,
    (callback, delay) => { timers.set(++id, { callback, at: now + delay }); return id; },
    timer => timers.delete(timer), () => now);
  return { detector, sends: () => sends, advance(ms) {
    now += ms;
    for (const [id, timer] of timers) if (timer.at <= now) { timers.delete(id); timer.callback(); }
  } };
}
test('no speech produces no automatic request', () => {
  const f = fixture(); f.advance(10000); assert.equal(f.sends(), 0);
});
test('submits exactly once after three seconds of silence', () => {
  const f = fixture(); f.detector.voiceDetected();
  f.advance(2999); assert.equal(f.sends(), 0);
  f.advance(1); assert.equal(f.sends(), 1);
  f.advance(10000); assert.equal(f.sends(), 1);
});
test('resumed speech restarts the entire three-second pause', () => {
  const f = fixture(); f.detector.voiceDetected(); f.advance(2000);
  f.detector.voiceDetected(); f.advance(1000); assert.equal(f.sends(), 0);
  f.advance(2000); assert.equal(f.sends(), 1);
});
test('clear, manual submission or unmount cancel the pending request', () => {
  const f = fixture(); f.detector.voiceDetected(); f.advance(1500);
  f.detector.reset(); f.advance(5000); assert.equal(f.sends(), 0);
});
test('the next spoken question can submit independently', () => {
  const f = fixture(); f.detector.voiceDetected(); f.advance(3000);
  f.detector.voiceDetected(); f.advance(3000); assert.equal(f.sends(), 2);
});

test('the countdown shows 3, 2, 1 and clears after sending', () => {
  const f = fixture(); assert.equal(f.detector.remainingSeconds, null);
  f.detector.voiceDetected(); assert.equal(f.detector.remainingSeconds, 3);
  f.advance(1000); assert.equal(f.detector.remainingSeconds, 2);
  f.advance(1000); assert.equal(f.detector.remainingSeconds, 1);
  f.advance(1000); assert.equal(f.detector.remainingSeconds, null);
  assert.equal(f.sends(), 1);
});
test('speech and cancel both reset the visible countdown', () => {
  const f = fixture(); f.detector.voiceDetected(); f.advance(2000);
  assert.equal(f.detector.remainingSeconds, 1);
  f.detector.voiceDetected(); assert.equal(f.detector.remainingSeconds, 3);
  f.detector.reset(); assert.equal(f.detector.remainingSeconds, null);
});
