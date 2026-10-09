import React, { useEffect, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, Download, Upload, LoaderCircle, Flame, CloudFog } from 'lucide-react';
import { playSiren } from '../utils/audio';

export default function VideoAudit() {
  const [file, setFile] = useState(null); const [job, setJob] = useState(null); const [error, setError] = useState(''); const [videoUrl, setVideoUrl] = useState(''); const [polling, setPolling] = useState(false); const [summary, setSummary] = useState(null); const timer = useRef(null);
  useEffect(()=>()=>clearInterval(timer.current),[]);
  const start = async () => {
    if (!file) return setError('Select a video first.'); setError(''); setVideoUrl(''); setSummary(null); setPolling(true);
    const body=new FormData(); body.append('file',file);
    try { const res=await fetch('/api/detect/video',{method:'POST',body}); const data=await res.json(); if(!res.ok) throw new Error(data.detail||'Upload failed'); setJob(data); poll(data.job_id); } catch(e){setError(e.message);setPolling(false);}
  };
  const poll=(id)=>{ clearInterval(timer.current); timer.current=setInterval(async()=>{ try {const res=await fetch(`/api/video/status/${id}`); const data=await res.json(); setJob(data); if(data.status==='completed'){clearInterval(timer.current);setPolling(false);setSummary(data.result);setVideoUrl(`${data.video_url}?t=${Date.now()}`);if(data.result?.active_hazards)playSiren();} if(data.status==='failed'){clearInterval(timer.current);setPolling(false);setError(data.error||'Video processing failed.');}}catch(e){clearInterval(timer.current);setPolling(false);setError('Cannot reach backend.');}},1000)};
  const progress=Number(job?.progress||0);
  return <div className="w-full max-w-7xl mx-auto px-4 py-6 sm:px-6 lg:px-8 space-y-5 flex-1">
    <div><p className="text-[10px] font-black uppercase tracking-[.2em] text-blue-600">Recorded CCTV</p><h1 className="text-2xl sm:text-3xl font-black">Video Audit</h1><p className="mt-1 text-sm text-slate-500">Background processing keeps the dashboard responsive while PPE, fire and smoke are analyzed.</p></div>
    {error&&<div className="rounded-xl bg-rose-50 border border-rose-200 p-3 text-sm font-semibold text-rose-700">{error}</div>}
    <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_360px] gap-5">
      <section className="space-y-4">
        <div className="rounded-2xl border bg-white p-4 shadow-sm flex flex-col sm:flex-row gap-3 sm:items-center sm:justify-between"><input type="file" accept=".mp4,.avi,.mov,.mkv,video/*" onChange={e=>setFile(e.target.files?.[0]||null)} className="text-xs file:mr-3 file:rounded-xl file:border-0 file:bg-blue-600 file:px-4 file:py-2 file:text-white file:font-bold"/><button onClick={start} disabled={!file||polling} className="inline-flex justify-center items-center gap-2 rounded-xl bg-blue-600 px-5 py-2.5 text-xs font-black text-white disabled:bg-slate-300">{polling?<><LoaderCircle size={15} className="animate-spin"/> Processing {progress}%</>:<><Upload size={15}/> Analyze Video</>}</button></div>
        {job && <div className="rounded-2xl border bg-white p-4 shadow-sm"><div className="flex justify-between text-xs font-black mb-2"><span>{job.status?.toUpperCase()}</span><span>{progress}%</span></div><div className="h-2 rounded-full bg-slate-100 overflow-hidden"><div className="h-full bg-blue-600 transition-all" style={{width:`${progress}%`}}/></div><p className="mt-2 text-[11px] text-slate-500">Frames processed: {job.frames_processed||0} · Processing FPS: {job.processing_fps||0}</p></div>}
        <div className="rounded-2xl border bg-black p-3 shadow-sm min-h-[360px] flex items-center justify-center">{videoUrl?<video key={videoUrl} referrerPolicy="no-referrer" controls playsInline className="w-full rounded-xl" src={videoUrl}/> : <div className="text-center text-slate-500"><p className="text-sm">Processed video will appear here.</p></div>}</div>
        {videoUrl&&<a href={videoUrl} download className="inline-flex items-center gap-2 rounded-xl border bg-white px-4 py-2 text-xs font-bold"><Download size={15}/> Download processed video</a>}
      </section>
      <aside className="space-y-4">
        <div className="grid grid-cols-2 gap-3">{[["Compliance",summary?`${summary.compliance_pct}%`:'—'],['Hazards',summary?.active_hazards??'—'],['Processed FPS',summary?.processing_fps??'—'],['Frames',summary?.frames_processed??'—']].map(([a,b])=><div key={a} className="rounded-2xl border bg-white p-4 shadow-sm"><p className="text-[11px] text-slate-500">{a}</p><p className="mt-1 text-2xl font-black">{b}</p></div>)}</div>
        <div className="rounded-2xl bg-slate-950 p-5 text-white"><h2 className="font-black mb-3">Processing details</h2>{summary?<div className="space-y-2 text-xs"><p>Original FPS: <b>{summary.original_fps}</b></p><p>Duration: <b>{summary.duration_seconds}s</b></p><p>Processing time: <b>{summary.processing_seconds}s</b></p><p>FFmpeg: <b>{summary.ffmpeg_used?'Used':'Fallback codec'}</b></p></div>:<p className="text-xs text-slate-400">Run a video audit to see real measurements.</p>}</div>
        <div className="rounded-2xl border bg-white p-5 shadow-sm"><h2 className="font-black text-sm mb-3">Detection modes</h2><div className="space-y-2 text-xs"><p className="flex gap-2"><CheckCircle2 size={15} className="text-emerald-600"/> PPE compliance</p><p className="flex gap-2"><Flame size={15} className="text-rose-600"/> Fire hazard</p><p className="flex gap-2"><CloudFog size={15} className="text-amber-600"/> Smoke warning</p></div></div>
      </aside>
    </div>
  </div>;
}
