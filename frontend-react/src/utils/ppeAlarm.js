// Real-time PPE-absence voice alarm (NEW).
//
// The backend (live_tracking.py -> ppe_workflow.summarize_ppe_status) already puts a compact
// `ppe_status` object in every /api/live-stats reply:
//   { status, missing:[...], detected:[...], announcement:"Warning. Helmet is missing.", signature:"helmet" }
// This controller only decides WHEN to speak it. Speech runs in the browser through the Web Speech
// API (asynchronous, off the video path), so it cannot slow down the live detection stream.
//
// Rules
//  * the same warning is not repeated until COOLDOWN_MS has passed (default 4 s);
//  * a DIFFERENT warning (the set of missing items changed) is announced right away, but never
//    closer than MIN_GAP_MS after the previous announcement;
//  * a short flicker "missing -> OK -> missing" of the same item does not restart the cooldown;
//  * when nothing is missing any more, speech in progress is cancelled and nothing new is spoken.

export const COOLDOWN_MS = 4000;
export const MIN_GAP_MS = 1500;
export const STALE_AFTER_MS = 3000;   // no new frame for this long => the result is stale, stay silent
const BEEP_LEAD_MS = 380;      // let the alarm tone finish before the voice starts
const CANCEL_SETTLE_MS = 90;   // some browsers drop a speak() issued in the same tick as cancel()

let sharedAudioCtx = null;     // one AudioContext for the whole page (browsers cap how many can exist)

/** Short two-tone alarm beep. Silent no-op when Web Audio is unavailable or blocked. */
export function playAlarmBeep() {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    if (!sharedAudioCtx) sharedAudioCtx = new Ctx();
    const ctx = sharedAudioCtx;
    if (ctx.state === 'suspended') ctx.resume();
    const t0 = ctx.currentTime;
    [[880, 0], [660, 0.18]].forEach(([freq, offset]) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'square';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, t0 + offset);
      gain.gain.exponentialRampToValueAtTime(0.18, t0 + offset + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + offset + 0.16);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(t0 + offset);
      osc.stop(t0 + offset + 0.17);
    });
  } catch { /* audio is a convenience; never break detection */ }
}

export class PpeVoiceAlarm {
  /**
   * All collaborators are injectable so the logic can be unit-tested without a browser.
   * @param {object} [opts]
   */
  constructor(opts = {}) {
    const hasWindow = typeof window !== 'undefined';
    this.synth = 'synth' in opts ? opts.synth : (hasWindow ? window.speechSynthesis : null);
    this.Utterance = opts.Utterance || (hasWindow ? window.SpeechSynthesisUtterance : null);
    this.beep = opts.beep || playAlarmBeep;
    this.now = opts.now || (() => Date.now());
    this.schedule = opts.schedule || ((fn, ms) => setTimeout(fn, ms));
    this.cooldownMs = opts.cooldownMs ?? COOLDOWN_MS;
    this.minGapMs = opts.minGapMs ?? MIN_GAP_MS;
    this.enabled = opts.enabled ?? true;
    this.lastSignature = null;     // what was last announced (kept across short "all clear" gaps)
    this.lastSpokenAt = -Infinity;
    this.generation = 0;           // lets a stop()/clear invalidate a speak that is still scheduled
    this.pending = false;          // a speak() is scheduled (beep playing) but the voice has not started
    this.seq = null;               // last frame_seq seen from the backend
    this.seqChangedAt = 0;         // when it last changed (0 = no fresh frame seen yet)
  }

  get supported() { return Boolean(this.synth && this.Utterance); }

  setEnabled(on) {
    this.enabled = Boolean(on);
    if (!this.enabled) this.stop();
  }

  /** Cancel any speech and forget what was announced (camera stopped / voice switched off). */
  stop() {
    this.generation += 1;
    this.lastSignature = null;
    this.lastSpokenAt = -Infinity;
    this.pending = false;
    this.seq = null;
    this.seqChangedAt = 0;
    this._cancelSpeech();
  }

  _cancelSpeech() {
    try { if (this.synth) this.synth.cancel(); } catch { /* ignore */ }
  }

  _isSpeaking() {
    return Boolean(this.synth && (this.synth.speaking || this.synth.pending));
  }

  /** Speak one sentence now (used by the "Test voice" button too). */
  speak(text, { withBeep = true } = {}) {
    const gen = this.generation;
    if (withBeep) this.beep();
    if (!this.supported) return false;
    const wasBusy = this._isSpeaking();
    if (wasBusy) this._cancelSpeech();
    this.pending = true;
    this.schedule(() => {
      if (gen !== this.generation) return;          // cleared / stopped in the meantime
      this.pending = false;
      try {
        const u = new this.Utterance(text);
        u.lang = 'en-US';
        u.rate = 1;
        u.volume = 1;
        this.synth.speak(u);
      } catch { /* ignore */ }
    }, Math.max(withBeep ? BEEP_LEAD_MS : 0, wasBusy ? CANCEL_SETTLE_MS : 0));
    return true;
  }

  /**
   * Feed a whole /api/live-stats reply. Only a FRESH result may raise the alarm: the backend keeps
   * the last result after a stream stops or the camera drops, and that must not keep shouting.
   * Fresh = `frame_seq` has advanced within STALE_AFTER_MS. The first reply after (re)start is only a
   * baseline (it may still be the previous session's last frame).
   */
  feed(stats, nowMs = this.now()) {
    if (!this.enabled) return 'disabled';
    const data = stats || {};
    if (data.frame_seq !== undefined && data.frame_seq !== this.seq) {
      this.seqChangedAt = this.seq === null ? 0 : nowMs;
      this.seq = data.frame_seq;
    }
    const fresh = data.frame_seq === undefined || (this.seqChangedAt > 0 && nowMs - this.seqChangedAt < STALE_AFTER_MS);
    return this.update(fresh && !data.camera_error ? data.ppe_status : null, nowMs);
  }

  /**
   * Feed every polled `ppe_status`. Cheap: a couple of comparisons per call.
   * Returns what happened (handy for tests / debugging):
   *   'disabled' | 'clear' | 'spoke' | 'cooldown' | 'busy'
   */
  update(ppeStatus, nowMs = this.now()) {
    if (!this.enabled) return 'disabled';

    const missing = ppeStatus && Array.isArray(ppeStatus.missing) ? ppeStatus.missing : [];
    const text = ppeStatus && ppeStatus.announcement;
    if (!missing.length || !text) {
      // All PPE detected (or nobody in view / still checking): stop the warning, stay silent.
      this.generation += 1;                          // also drops a voice that is scheduled but not started
      if (this.pending) {                            // warning withdrawn before it was ever spoken
        this.pending = false;
        this.lastSignature = null;
        this.lastSpokenAt = -Infinity;
      }
      if (this._isSpeaking()) this._cancelSpeech();
      return 'clear';
    }

    const signature = ppeStatus.signature || missing.join('|');
    const changed = signature !== this.lastSignature;
    const since = nowMs - this.lastSpokenAt;
    if (since < (changed ? this.minGapMs : this.cooldownMs)) return 'cooldown';
    if (!changed && this._isSpeaking()) return 'busy';

    this.lastSignature = signature;
    this.lastSpokenAt = nowMs;
    this.speak(text);
    return 'spoke';
  }
}
