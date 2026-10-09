import React, { useEffect, useRef, useState } from 'react';
import { Camera, CameraOff, AlertTriangle, Flame, CloudFog, Activity, Mail, MapPinned, Users } from 'lucide-react';
import { playSiren } from '../utils/audio';

const blank = { total_workers: 0, compliant: 0, violations: 0, hazards: 0, fire: false, smoke: false, compliance_pct: '0%', fps: 0, latency_ms: 0, events: [], camera_source: 'CP Plus RTSP' };

export default function LiveDetection() {
  const statsTimerRef = useRef(null), previousAlertRef = useRef(false);
  const [running, setRunning] = useState(false), [stats, setStats] = useState(blank), [error, setError] = useState('');
  const [emailNote, setEmailNote] = useState('Email alerts are enabled for detected violations and hazards when SMTP is configured.');
  const [streamUrl, setStreamUrl] = useState('');

  const stop = () => {
    clearInterval(statsTimerRef.current);
    statsTimerRef.current = null;
    setRunning(false);
    setStreamUrl('');
    setStats(blank);
    previousAlertRef.current = false;
  };

  const pollStats = async () => {
    try {
      const res = await fetch('/api/live-stats', { cache: 'no-store' });
      const data = await res.json();
      if (!res.ok) return;
      setStats(data);
      if (data.camera_error) {
        setError(data.camera_error);
      }
      const alertActive = Boolean(data.violations || data.hazards);
      if (data.hazards && !previousAlertRef.current) playSiren();
      previousAlertRef.current = alertActive;
      if (alertActive) {
        setEmailNote('Detection found. Evidence image is being recorded and an email alert is queued when SMTP is configured.');
      }
    } catch (e) {}
  };

  const start = async () => {
    try {
      setError('');
      const statusRes = await fetch('/api/camera/status', { cache: 'no-store' });
      const status = await statusRes.json();
      if (!status.configured) {
        setError('CP Plus RTSP URL is not configured. Add CAMERA_RTSP_URL to the backend .env file.');
        return;
      }
      setStreamUrl(`/api/cpplus/live?t=${Date.now()}`);
      setRunning(true);
      clearInterval(statsTimerRef.current);
      statsTimerRef.current = setInterval(pollStats, 500);
      await pollStats();
    } catch (e) {
      setError('Could not start the CP Plus live stream. Make sure the FastAPI backend is running.');
      stop();
    }
  };

  const handleStreamError = () => {
    if (running) {
      setError('CP Plus camera stream could not be opened. Check the camera IP, RTSP username/password, RTSP path, and local network connection.');
    }
  };

  useEffect(() => () => stop(), []);

  return (
    <div className="w-full max-w-7xl mx-auto px-4 py-6 sm:px-6 lg:px-8 space-y-5 flex-1">
      <div>
        <h1 className="text-2xl sm:text-3xl font-black">Live Detection</h1>
        <p className="mt-1 text-sm text-slate-500">
          Live video is received from the CP Plus IP camera through RTSP. FastAPI runs the PPE and Fire/Smoke models and sends the annotated stream to this dashboard.
        </p>
      </div>

      {error && <div className="rounded-xl bg-rose-50 border border-rose-200 p-3 text-sm font-semibold text-rose-700">{error}</div>}
      {stats.hazards > 0 && (
        <div className="rounded-xl bg-rose-600 text-white p-3 font-black flex items-center gap-2 animate-pulse">
          <AlertTriangle size={17} /> {stats.fire ? 'FIRE DETECTED — CRITICAL' : 'SMOKE DETECTED — HIGH PRIORITY'}
        </div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
        <section className="rounded-2xl border bg-white p-3 shadow-sm">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-black">CP Plus Camera Feed</h2>
            <span className={`rounded-full px-3 py-1 text-[10px] font-black ${running ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>
              {running ? 'CAMERA ON' : 'CAMERA OFF'}
            </span>
          </div>
          <div className="relative aspect-video rounded-xl bg-slate-950 overflow-hidden flex items-center justify-center">
            {streamUrl ? (
              <img src={streamUrl} onError={handleStreamError} alt="CP Plus live annotated detection" className="w-full h-full object-contain" />
            ) : (
              <div className="text-center text-slate-400 text-sm font-bold">
                <Camera size={30} className="mx-auto mb-2 opacity-60" />
                Press Start Camera
              </div>
            )}
            <div className="absolute left-3 top-3 rounded-full bg-black/70 px-3 py-1 text-[10px] font-black text-white">
              {running ? 'CP PLUS + AI LIVE' : 'STOPPED'}
            </div>
          </div>
          <div className="flex gap-2 mt-3">
            <button onClick={start} disabled={running} className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-xs font-black text-white disabled:bg-slate-300">
              <Camera size={15} /> Start Camera
            </button>
            <button onClick={stop} disabled={!running} className="inline-flex items-center gap-2 rounded-xl border px-4 py-2.5 text-xs font-black disabled:opacity-40">
              <CameraOff size={15} /> Stop
            </button>
          </div>
        </section>

        <section className="rounded-2xl border bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-black">AI Detection Status</h2>
            <span className="text-[10px] font-black text-slate-500">LIVE RESULT</span>
          </div>
          <div className="grid grid-cols-2 gap-3">
            {[
              ['Camera', stats.camera_source || 'CP Plus RTSP'],
              ['Workers', stats.total_workers || 0],
              ['Tracked', stats.tracking?.active_tracks || 0],
              ['Verified', stats.registered_workers_in_view || 0],
              ['Violations', stats.violations || 0],
              ['Fire', stats.fire ? 'DETECTED' : 'SAFE'],
              ['Smoke', stats.smoke ? 'DETECTED' : 'SAFE'],
            ].map(([k, v]) => (
              <div key={k} className="rounded-xl border bg-slate-50 p-4">
                <p className="text-[10px] uppercase font-black tracking-wider text-slate-400">{k}</p>
                <p className="mt-1 text-sm font-black">{v}</p>
              </div>
            ))}
          </div>
          <a href="/safety-map" className="mt-4 inline-flex items-center gap-2 rounded-xl bg-slate-950 px-4 py-2.5 text-xs font-black text-white hover:bg-slate-800">
            <MapPinned size={15} /> Open Live Safety Map
          </a>
          <div className="mt-4 rounded-xl bg-slate-950 p-4 text-white">
            <p className="text-xs font-black">RTSP → FastAPI → YOLO → Dashboard</p>
            <p className="mt-1 text-xs text-slate-400">The camera stream is processed on the backend. The browser does not access the laptop webcam.</p>
          </div>
        </section>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        {[
          ['FPS', stats.fps || 0],
          ['Latency', `${stats.latency_ms || 0} ms`],
          ['Workers', stats.total_workers || 0],
          ['Compliant', stats.compliant || 0],
          ['Violations', stats.violations || 0],
          ['Hazards', stats.hazards || 0],
        ].map(([k, v]) => (
          <div key={k} className="rounded-2xl border bg-white p-4 shadow-sm">
            <p className="text-[11px] text-slate-500">{k}</p>
            <p className="mt-1 text-xl font-black">{v}</p>
          </div>
        ))}
      </div>

      <section className="rounded-2xl border bg-white p-5 shadow-sm">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="font-black flex items-center gap-2">
              <Users size={17} /> Multi-worker tracking
            </h2>
            <p className="mt-1 text-xs text-slate-500">Each person keeps a persistent track ID while moving through the camera.</p>
          </div>
          <a href="/safety-map" className="inline-flex items-center gap-2 rounded-xl border px-3 py-2 text-[10px] font-black text-blue-700">
            <MapPinned size={14} /> Map
          </a>
        </div>
        <div className="mt-4 grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-3">
          {(stats.workers || []).map((w) => (
            <div key={w.track_id} className={`rounded-xl border p-3 ${w.compliant ? 'border-emerald-100 bg-emerald-50/50' : 'border-rose-200 bg-rose-50'}`}>
              <div className="flex items-center justify-between">
                <span className="text-sm font-black">{w.worker_name}</span>
                <span className="text-[10px] font-black">#{w.track_id}</span>
              </div>
              <p className="mt-1 text-[10px] font-bold text-slate-500">
                {w.verified ? 'Verified worker' : 'Unknown person'} · {w.zone}
              </p>
              <p className={`mt-2 text-xs font-black ${w.compliant ? 'text-emerald-700' : 'text-rose-700'}`}>
                {w.compliant ? 'SAFE' : 'MISSING: ' + (w.missing || []).join(', ')}
              </p>
            </div>
          ))}
          {!(stats.workers || []).length && <p className="text-xs font-semibold text-slate-400">No active worker tracks.</p>}
        </div>
      </section>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <div className="rounded-2xl bg-slate-950 p-5 text-white space-y-3">
          <h2 className="font-black">Hazard monitor</h2>
          <p className="flex justify-between text-sm">
            <span className="flex gap-2">
              <Flame size={16} /> Fire
            </span>
            <b className={stats.fire ? 'text-rose-400' : 'text-emerald-400'}>{stats.fire ? 'YES' : 'NO'}</b>
          </p>
          <p className="flex justify-between text-sm">
            <span className="flex gap-2">
              <CloudFog size={16} /> Smoke
            </span>
            <b className={stats.smoke ? 'text-amber-400' : 'text-emerald-400'}>{stats.smoke ? 'YES' : 'NO'}</b>
          </p>
          <p className="flex justify-between text-sm">
            <span className="flex gap-2">
              <Activity size={16} /> Compliance
            </span>
            <b>{stats.compliance_pct}</b>
          </p>
        </div>
        <div className="rounded-2xl border bg-white p-5 shadow-sm">
          <h2 className="font-black flex items-center gap-2">
            <Mail size={17} /> Email alerts
          </h2>
          <p className="mt-2 text-sm text-slate-500">{emailNote}</p>
          <p className="mt-2 text-xs text-slate-400">Alerts are debounced to avoid sending an email for every frame of the same ongoing event.</p>
        </div>
      </div>
    </div>
  );
}