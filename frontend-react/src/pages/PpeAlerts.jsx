import React, { useEffect, useState } from 'react';
import { listAlerts } from '../utils/verifyApi';

const EMAIL = {
  sent: ['Sent', 'bg-emerald-100 text-emerald-700'],
  failed: ['Failed - alert stored', 'bg-rose-100 text-rose-700'],
  pending: ['Sending…', 'bg-blue-100 text-blue-700'],
  not_configured: ['Not configured', 'bg-slate-100 text-slate-500'],
};

const fmtDate = (d) => { const [y, m, day] = String(d || '').split('-'); return y && m && day ? `${day}/${m}/${y}` : '-'; };
const fmtTime = (t) => {
  const [h, m] = String(t || '').split(':').map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return '-';
  return `${String(((h + 11) % 12) + 1).padStart(2, '0')}:${String(m).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`;
};
const title = (s) => s.charAt(0).toUpperCase() + s.slice(1);

export default function PpeAlerts() {
  const [alerts, setAlerts] = useState(null);
  const [retention, setRetention] = useState(0);
  const [error, setError] = useState('');
  const [view, setView] = useState(null);

  useEffect(() => {
    let alive = true;
    const load = () => listAlerts()
      .then((d) => { if (alive) { setAlerts(d.alerts); setRetention(d.retention_hours); setError(''); } })
      .catch((e) => alive && setError(e.message));
    load();
    const t = setInterval(load, 5000);
    return () => { alive = false; clearInterval(t); };
  }, []);

  return (
    <div className="mx-auto w-full max-w-7xl flex-1 space-y-5 px-4 py-6 sm:px-6 lg:px-8">
      <div>
        {/* <p className="text-[10px] font-black uppercase tracking-[.2em] text-blue-600">Violation history</p> */}
        <h1 className="text-2xl font-black sm:text-3xl">PPE Alerts</h1>
        <p className="mt-1 text-sm text-slate-500">
          Every verified worker with incomplete PPE. {retention > 0 ? `Alerts are kept for ${retention} hours (same retention as the incident archive).` : 'Alerts are kept until removed.'}
          {' '}The snapshot here is the camera capture - not the worker&apos;s registration photo.
        </p>
      </div>
      {error && <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm font-semibold text-rose-700">{error}</div>}
      {alerts && alerts.length === 0 && <div className="rounded-2xl border bg-white p-8 text-center text-sm font-semibold text-slate-400">No PPE alerts.</div>}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {(alerts || []).map((a) => {
          const [label, tone] = EMAIL[a.email_status] || EMAIL.pending;
          return (
            <article key={a.id} className="flex gap-4 rounded-2xl border bg-white p-4 shadow-sm">
              {a.image_url
                ? <button onClick={() => setView(a)} className="shrink-0"><img src={a.image_url} alt="Captured snapshot" className="h-28 w-36 rounded-xl border object-cover" /></button>
                : <div className="flex h-28 w-36 shrink-0 items-center justify-center rounded-xl border bg-slate-50 text-xs text-slate-400">No image</div>}
              <div className="min-w-0 flex-1 text-sm">
                <div className="flex items-start justify-between gap-2">
                  <p className="truncate font-black">{a.worker_name}</p>
                  <span className="shrink-0 text-[10px] font-black text-slate-400">ALERT #{a.id}</span>
                </div>
                <p className="text-xs text-slate-500">Worker ID {a.worker_id || '-'} · {a.mobile || '-'}</p>
                <p className="mt-1 text-xs font-bold text-slate-500">{fmtDate(a.date)} · {fmtTime(a.time)}</p>
                <p className="mt-1 font-black text-rose-600">Compliance: {a.compliance_percentage}%</p>
                <p className="font-bold text-rose-700">Missing: {a.missing_ppe.map(title).join(', ') || '-'}</p>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <span className={`rounded-full px-2.5 py-0.5 text-[10px] font-black ${tone}`}>Email: {label}</span>
                  {a.image_url && <button onClick={() => setView(a)} className="rounded-lg border px-2.5 py-1 text-[11px] font-black text-blue-700 hover:bg-blue-50">View Image</button>}
                </div>
              </div>
            </article>
          );
        })}
      </div>

      {view && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/70 p-4" onClick={() => setView(null)} role="dialog" aria-modal="true">
          <div className="max-h-full w-full max-w-3xl overflow-auto rounded-2xl bg-white p-4 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <img src={view.image_url} alt="Captured snapshot" className="w-full rounded-xl" />
            <p className="mt-3 text-sm font-black">{view.worker_name} · {view.compliance_percentage}% · Missing: {view.missing_ppe.map(title).join(', ')}</p>
            <button onClick={() => setView(null)} className="mt-3 rounded-xl border px-4 py-2 text-xs font-black">Close</button>
          </div>
        </div>
      )}
    </div>
  );
}
