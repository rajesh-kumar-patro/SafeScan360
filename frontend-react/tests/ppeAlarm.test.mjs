// Run:  node --test tests/        (Node 18+; no browser needed - speech, beep, clock are faked)
import test from 'node:test';
import assert from 'node:assert/strict';
import { PpeVoiceAlarm } from '../src/utils/ppeAlarm.js';

function rig(extra = {}) {
  const spoken = []; let beeps = 0; let clock = 0; const queue = [];
  const synth = {
    speaking: false, pending: false,
    speak(u) { spoken.push(u.text); this.speaking = true; },
    cancel() { this.speaking = false; this.pending = false; },
  };
  class Utterance { constructor(text) { this.text = text; } }
  const alarm = new PpeVoiceAlarm({
    synth, Utterance, beep: () => { beeps += 1; }, now: () => clock,
    schedule: (fn) => queue.push(fn),            // manual: flush() runs what "setTimeout" would
    ...extra,
  });
  return {
    alarm, spoken, synth, queue,
    get beeps() { return beeps; },
    at(ms) { clock = ms; },
    flush() { while (queue.length) queue.shift()(); },
    done() { synth.speaking = false; },          // utterance finished
  };
}
const st = (missing, text) => ({ missing, announcement: text, signature: missing.join('|') });
const HELMET = st(['helmet'], 'Warning. Helmet is missing.');
const HELMET_GLOVES = st(['helmet', 'gloves'], 'Warning. Helmet and gloves are missing.');
const CLEAR = { status: 'ALL_PPE_DETECTED', missing: [], announcement: '', signature: '' };

test('spec timeline: 0s speak, 1s silent, 4s speak again', () => {
  const r = rig();
  r.at(0);    assert.equal(r.alarm.update(HELMET), 'spoke'); r.flush(); r.done();
  r.at(1000); assert.equal(r.alarm.update(HELMET), 'cooldown'); r.flush();
  r.at(3900); assert.equal(r.alarm.update(HELMET), 'cooldown');
  r.at(4000); assert.equal(r.alarm.update(HELMET), 'spoke'); r.flush();
  assert.deepEqual(r.spoken, ['Warning. Helmet is missing.', 'Warning. Helmet is missing.']);
  assert.equal(r.beeps, 2);
});

test('polling every 500 ms for 3.9 s speaks exactly once', () => {
  const r = rig();
  for (let t = 0; t < 4000; t += 500) { r.at(t); r.alarm.update(HELMET); r.flush(); r.done(); }
  assert.equal(r.spoken.length, 1);
});

test('a changed warning is announced (after the minimum gap)', () => {
  const r = rig();
  r.at(0); r.alarm.update(HELMET); r.flush(); r.done();
  r.at(500);  assert.equal(r.alarm.update(HELMET_GLOVES), 'cooldown');   // too soon after the last one
  r.at(1600); assert.equal(r.alarm.update(HELMET_GLOVES), 'spoke'); r.flush();
  assert.equal(r.spoken.at(-1), 'Warning. Helmet and gloves are missing.');
});

test('all PPE detected: silence, and speech in progress is cancelled', () => {
  const r = rig();
  r.at(0); r.alarm.update(HELMET); r.flush();           // voice has started and is still talking
  assert.equal(r.synth.speaking, true);
  r.at(500); assert.equal(r.alarm.update(CLEAR), 'clear');
  assert.equal(r.synth.speaking, false);
  for (let t = 1000; t < 10000; t += 500) { r.at(t); assert.equal(r.alarm.update(CLEAR), 'clear'); }
  assert.equal(r.spoken.length, 1);
});

test('warning withdrawn while the beep plays is never spoken', () => {
  const r = rig();
  r.at(0); r.alarm.update(HELMET);                       // voice scheduled, not yet started
  r.at(200); r.alarm.update(CLEAR); r.flush();
  assert.equal(r.spoken.length, 0);
  r.at(300); assert.equal(r.alarm.update(HELMET), 'spoke');   // and a new warning is not blocked by the withdrawn one
  r.flush(); assert.equal(r.spoken.length, 1);
});

test('missing -> OK -> missing flicker does not restart the cooldown', () => {
  const r = rig();
  r.at(0); r.alarm.update(HELMET); r.flush(); r.done();
  r.at(500); r.alarm.update(CLEAR);
  r.at(900); assert.equal(r.alarm.update(HELMET), 'cooldown');
  r.at(4000); assert.equal(r.alarm.update(HELMET), 'spoke');
});

test('helmet fixed but gloves missing -> only the gloves warning', () => {
  const r = rig();
  r.at(0); r.alarm.update(HELMET_GLOVES); r.flush(); r.done();
  r.at(2000); r.alarm.update(st(['gloves'], 'Warning. Gloves are missing.')); r.flush();
  assert.equal(r.spoken.at(-1), 'Warning. Gloves are missing.');
});

test('does not talk over itself while the same warning is still being spoken', () => {
  const r = rig();
  r.at(0); r.alarm.update(HELMET); r.flush();            // still speaking
  r.at(4000); assert.equal(r.alarm.update(HELMET), 'busy');
  r.done(); r.at(4500); assert.equal(r.alarm.update(HELMET), 'spoke');
});

test('disabled / stop() / missing or malformed status', () => {
  const r = rig({ enabled: false });
  assert.equal(r.alarm.update(HELMET), 'disabled');
  r.alarm.setEnabled(true);
  assert.equal(r.alarm.update(undefined), 'clear');
  assert.equal(r.alarm.update({}), 'clear');
  r.at(0); r.alarm.update(HELMET); r.alarm.stop(); r.flush();
  assert.equal(r.spoken.length, 0);                      // stop() invalidated the scheduled voice
  r.at(10); assert.equal(r.alarm.update(HELMET), 'spoke'); // and reset the cooldown
});

test('no speech support: beeps only, never throws', () => {
  const r = rig({ synth: null });
  assert.equal(r.alarm.supported, false);
  r.at(0); assert.equal(r.alarm.update(HELMET), 'spoke');
  assert.equal(r.beeps, 1);
});

// ---- feed(): freshness of backend results ------------------------------------------------------
const frame = (seq, status, extra = {}) => ({ frame_seq: seq, ppe_status: status, ...extra });

test('feed: first reply after start is only a baseline (stale last frame of the old session is ignored)', () => {
  const r = rig();
  r.at(0);    assert.equal(r.alarm.feed(frame(41, HELMET)), 'clear');      // old session's last result
  r.at(500);  assert.equal(r.alarm.feed(frame(41, HELMET)), 'clear');      // stream not producing yet
  r.at(1000); assert.equal(r.alarm.feed(frame(42, HELMET)), 'spoke');      // first genuinely new frame
});

test('feed: a dead stream / camera error stops the repeating warning', () => {
  const r = rig();
  r.at(0); r.alarm.feed(frame(1, HELMET));
  r.at(500); assert.equal(r.alarm.feed(frame(2, HELMET)), 'spoke'); r.flush(); r.done();
  r.at(4500); assert.equal(r.alarm.feed(frame(3, HELMET)), 'spoke'); r.flush(); r.done();   // still live: repeats after 4 s
  r.at(8000); assert.equal(r.alarm.feed(frame(3, HELMET)), 'clear');                         // frame_seq frozen > 3 s
  r.at(9000); assert.equal(r.alarm.feed(frame(4, HELMET, { camera_error: 'boom' })), 'clear');
  assert.equal(r.spoken.length, 2);
});

test('feed: backend without frame_seq still works', () => {
  const r = rig();
  r.at(0); assert.equal(r.alarm.feed({ ppe_status: HELMET }), 'spoke');
});
