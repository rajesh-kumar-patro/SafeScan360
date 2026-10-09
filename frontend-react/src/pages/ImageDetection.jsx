import React, { useState } from 'react';
import { AlertTriangle, CheckCircle2, Download, UploadCloud, Flame, CloudFog, Clock3 } from 'lucide-react';
import { playSiren } from '../utils/audio';

const initial = { total_workers: 0, compliant: 0, violations: 0, hazards: 0, fire: false, smoke: false, processing_ms: 0, compliance_pct: '0%', workers: [], events: [] };

export default function ImageDetection() {
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [result, setResult] = useState(null);
  const [stats, setStats] = useState(initial);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const analyze = async () => {
    if (!file) return setError('Select an image first.');
    setLoading(true); setError('');
    const body = new FormData(); body.append('file', file);
    try {
      const res = await fetch('/api/detect-image', { method: 'POST', body });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || 'Image analysis failed.');
      setResult(data.annotated_image); setStats(data.stats || initial);
      if (data.stats?.hazards) playSiren();
    } catch (e) { setError(e.message || 'Backend connection failed.'); }
    finally { setLoading(false); }
  };

  const select = (e) => { const f = e.target.files?.[0]; if (!f) return; setFile(f); setResult(null); setError(''); setPreview(URL.createObjectURL(f)); };

  return <div className="w-full max-w-7xl mx-auto px-4 py-6 sm:px-6 lg:px-8 space-y-5 flex-1">
    <div className="flex flex-col gap-2"><p className="text-[10px] font-black uppercase tracking-[.2em] text-blue-600">AI inspection</p><h1 className="text-2xl sm:text-3xl font-black text-slate-950">Image Detection</h1><p className="text-sm text-slate-500">PPE + Fire + Smoke analysis using the two trained SafeScan360 models.</p></div>
    {error && <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm font-semibold text-rose-700">{error}</div>}
    {(stats.fire || stats.smoke) && <div className="rounded-xl bg-rose-600 p-3 text-white font-black text-sm flex items-center gap-2 animate-pulse"><AlertTriangle size={17}/> {stats.fire ? 'FIRE DETECTED — CRITICAL' : 'SMOKE DETECTED — HIGH PRIORITY'}</div>}
    <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_360px] gap-5">
      <section className="space-y-4">
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm flex flex-col sm:flex-row gap-3 sm:items-center sm:justify-between">
          <input type="file" accept=".jpg,.jpeg,.png,.webp,image/*" onChange={select} className="min-w-0 text-xs text-slate-500 file:mr-3 file:rounded-xl file:border-0 file:bg-blue-600 file:px-4 file:py-2 file:text-white file:font-bold"/>
          <button onClick={analyze} disabled={!file || loading} className="rounded-xl bg-blue-600 px-5 py-2.5 text-xs font-black text-white disabled:bg-slate-300">{loading ? 'Analyzing…' : 'Analyze Image'}</button>
        </div>
        <div className="min-h-[360px] rounded-2xl border border-slate-200 bg-white p-3 shadow-sm flex items-center justify-center">
          {result ? <img src={result} alt="Annotated detection" className="max-h-[620px] max-w-full rounded-xl object-contain"/> : preview ? <img src={preview} alt="Selected" className="max-h-[620px] max-w-full rounded-xl object-contain opacity-70"/> : <div className="text-center text-slate-400"><UploadCloud size={40} className="mx-auto mb-2 text-slate-300"/><p className="text-xs">Select a site image to start inspection.</p></div>}
        </div>
        {result && <a href={result} download="safescan360-annotated.jpg" className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-xs font-bold text-slate-700"><Download size={15}/> Download annotated image</a>}
      </section>
      <aside className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          {[["Workers",stats.total_workers],['Compliant',stats.compliant],['Violations',stats.violations],['Hazards',stats.hazards]].map(([k,v])=><div key={k} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"><p className="text-[11px] text-slate-500">{k}</p><p className="mt-1 text-2xl font-black">{v}</p></div>)}
        </div>
        <div className="rounded-2xl bg-slate-950 p-5 text-white shadow-xl space-y-3">
          <h2 className="font-black">Hazard status</h2>
          <div className="flex items-center justify-between rounded-xl bg-white/5 p-3"><span className="flex items-center gap-2 text-sm"><Flame size={16}/> Fire</span><b className={stats.fire?'text-rose-400':'text-emerald-400'}>{stats.fire?'DETECTED':'CLEAR'}</b></div>
          <div className="flex items-center justify-between rounded-xl bg-white/5 p-3"><span className="flex items-center gap-2 text-sm"><CloudFog size={16}/> Smoke</span><b className={stats.smoke?'text-amber-400':'text-emerald-400'}>{stats.smoke?'DETECTED':'CLEAR'}</b></div>
          <div className="flex items-center justify-between rounded-xl bg-white/5 p-3"><span>Compliance</span><b>{stats.compliance_pct}</b></div>
          <div className="flex items-center justify-between rounded-xl bg-white/5 p-3"><span className="flex items-center gap-2"><Clock3 size={15}/> Processing</span><b>{stats.processing_ms} ms</b></div>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><h2 className="font-black text-sm mb-3">Worker evidence</h2>{stats.workers?.length ? stats.workers.map(w=><div key={w.worker_id} className="mb-2 rounded-xl bg-slate-50 p-3 text-xs"><div className="flex justify-between font-black"><span>{w.worker_id}</span>{w.compliant?<CheckCircle2 size={15} className="text-emerald-600"/>:<AlertTriangle size={15} className="text-amber-600"/>}</div><p className="mt-1 text-slate-500">{w.compliant?'No explicit missing-PPE evidence.':w.missing.join(', ')}</p></div>) : <p className="text-xs text-slate-400">No workers detected.</p>}</div>
      </aside>
    </div>
  </div>;
}
