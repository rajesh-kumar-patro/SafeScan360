import React from 'react';
import { AlertTriangle } from 'lucide-react';

// Visual side of the real-time PPE-absence alarm (NEW). Renders the `ppe_status` object that the
// backend adds to every /api/live-stats reply (see backend/ppe_workflow.summarize_ppe_status).
// Same Tailwind look as the rest of the Live Detection page.
const LABELS = { helmet: 'Helmet', vest: 'Safety Vest', shoes: 'Safety Shoes', gloves: 'Gloves' };
const label = (k) => LABELS[k] || k;

export default function PpeAlertPanel({ status, voiceOn, voiceSupported, onToggleVoice, onTestVoice }) {
  const s = status || {};
  const missing = s.missing || [];
  const detected = s.detected || [];
  const state = s.status || 'NO_WORKER';

  const voiceControls = (
    <div className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        onClick={onToggleVoice}
        aria-pressed={voiceOn}
        className={`rounded-xl border px-3 py-2 text-[11px] font-black ${voiceOn ? 'bg-slate-950 text-white border-slate-950' : 'bg-white text-slate-600'}`}
      >
        {voiceOn ? '🔊 Voice alarm ON' : '🔇 Voice alarm OFF'}
      </button>
      <button
        type="button"
        onClick={onTestVoice}
        className="rounded-xl border bg-white px-3 py-2 text-[11px] font-black text-slate-600 hover:bg-slate-50"
      >
        Test voice
      </button>
    </div>
  );

  const unsupported = !voiceSupported && (
    <p className="mt-3 text-[11px] font-semibold text-amber-700">
      This browser has no speech support — only the alarm beep and this panel will be used. Chrome or Edge are recommended.
    </p>
  );

  if (state === 'PPE_MISSING') {
    return (
      <section role="alert" className="rounded-2xl border-2 border-rose-300 bg-rose-50 p-5 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="flex items-center gap-2 text-lg font-black text-rose-700 animate-pulse">
            <AlertTriangle size={20} /> ⚠️ PPE ALERT
          </h2>
          {voiceControls}
        </div>
        <p className="mt-1 text-sm font-bold text-rose-700">{s.announcement}</p>
        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <p className="text-[10px] font-black uppercase tracking-wider text-rose-500">Missing</p>
            <ul className="mt-2 space-y-1.5">
              {missing.map((k) => (
                <li key={k} className="rounded-lg bg-white border border-rose-200 px-3 py-2 text-sm font-black text-rose-700">❌ {label(k)}</li>
              ))}
            </ul>
          </div>
          <div>
            <p className="text-[10px] font-black uppercase tracking-wider text-emerald-600">Detected</p>
            <ul className="mt-2 space-y-1.5">
              {detected.map((k) => (
                <li key={k} className="rounded-lg bg-white border border-emerald-200 px-3 py-2 text-sm font-black text-emerald-700">✅ {label(k)}</li>
              ))}
              {!detected.length && <li className="text-xs font-semibold text-slate-400">Nothing confirmed yet.</li>}
            </ul>
          </div>
        </div>
        {unsupported}
      </section>
    );
  }

  const calm = {
    ALL_PPE_DETECTED: ['border-emerald-200 bg-emerald-50', 'text-emerald-700', '✅ ALL PPE DETECTED', 'Every required item is present for everyone in view.'],
    CHECKING: ['border-amber-200 bg-amber-50', 'text-amber-700', 'Checking PPE…', 'Assessing the worker in view — no alert yet.'],
    NO_WORKER: ['border-slate-200 bg-white', 'text-slate-500', 'No worker in view', 'The PPE check starts when a person enters the camera view.'],
  }[state] || ['border-slate-200 bg-white', 'text-slate-500', 'No worker in view', ''];

  return (
    <section className={`rounded-2xl border p-5 shadow-sm ${calm[0]}`}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className={`text-lg font-black ${calm[1]}`}>{calm[2]}</h2>
          <p className="mt-1 text-xs font-semibold text-slate-500">{calm[3]}</p>
        </div>
        {voiceControls}
      </div>
      {state === 'ALL_PPE_DETECTED' && (
        <div className="mt-3 flex flex-wrap gap-2">
          {detected.map((k) => (
            <span key={k} className="rounded-lg bg-white border border-emerald-200 px-3 py-1.5 text-xs font-black text-emerald-700">✅ {label(k)}</span>
          ))}
        </div>
      )}
      {unsupported}
    </section>
  );
}
