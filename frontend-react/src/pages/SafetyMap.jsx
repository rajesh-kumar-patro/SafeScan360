import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, Camera, MapPinned, ShieldCheck, Users, Volume2, VolumeX } from 'lucide-react';
import { playSiren } from '../utils/audio';

const blank = {
  active_tracks: 0,
  workers: [],
  camera_map: [],
  camera_source: 'CP Plus RTSP',
};

const zoneNames = [
  ['top-left', 'Top Left'],
  ['top-center', 'Top Center'],
  ['top-right', 'Top Right'],
  ['middle-left', 'Middle Left'],
  ['middle-center', 'Center'],
  ['middle-right', 'Middle Right'],
  ['bottom-left', 'Bottom Left'],
  ['bottom-center', 'Bottom Center'],
  ['bottom-right', 'Bottom Right'],
];

export default function SafetyMap() {
  const [state, setState] = useState(blank);
  const [stats, setStats] = useState({});
  const [error, setError] = useState('');
  const [alarmEnabled, setAlarmEnabled] = useState(false);
  const previousAlarm = useRef(false);

  useEffect(() => {
    let alive = true;

    const load = async () => {
      try {
        const [trackRes, statsRes] = await Promise.all([
          fetch('/api/live-tracking/state', { cache: 'no-store' }),
          fetch('/api/live-stats', { cache: 'no-store' }),
        ]);
        if (!trackRes.ok) throw new Error('Tracking service is not available.');
        const track = await trackRes.json();
        const live = statsRes.ok ? await statsRes.json() : {};
        if (!alive) return;
        setState(track || blank);
        setStats(live || {});
        setError('');

        const active = Boolean((live?.hazards || 0) || (live?.violations || 0));
        if (alarmEnabled && active && !previousAlarm.current) playSiren();
        previousAlarm.current = active;
      } catch (e) {
        if (alive) setError('Start the Live Detection camera to populate the worker map.');
      }
    };

    load();
    const timer = setInterval(load, 700);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [alarmEnabled]);

  const workers = state.workers || [];
  const unsafe = workers.filter((w) => !w.compliant);
  const verified = workers.filter((w) => w.verified);

  const grouped = useMemo(() => {
    const map = {};
    workers.forEach((w) => {
      if (!map[w.zone]) map[w.zone] = [];
      map[w.zone].push(w);
    });
    return map;
  }, [workers]);

  const alarm = Boolean(stats.fire || stats.smoke || stats.violations);

  return (
    <div className="mx-auto w-full max-w-7xl flex-1 space-y-5 px-4 py-6 sm:px-6 lg:px-8">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-[10px] font-black uppercase tracking-[.2em] text-blue-600">Live worker positioning</p>
          <h1 className="text-2xl font-black sm:text-3xl">Safety Map</h1>
          <p className="mt-1 max-w-3xl text-sm text-slate-500">
            A camera-floor map showing where each tracked worker is currently located. Positions are relative to the camera frame, not GPS.
          </p>
        </div>
        <button
          onClick={() => setAlarmEnabled((v) => !v)}
          className={`inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-xs font-black ${alarmEnabled ? 'bg-rose-600 text-white' : 'border bg-white text-slate-700'}`}
        >
          {alarmEnabled ? <Volume2 size={15} /> : <VolumeX size={15} />}
          {alarmEnabled ? 'Alarm Enabled' : 'Enable Alarm'}
        </button>
      </div>

      {error && <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm font-semibold text-amber-800">{error}</div>}

      {alarm && (
        <div className="flex items-center gap-3 rounded-2xl border border-rose-300 bg-rose-600 p-4 text-white shadow-lg animate-pulse">
          <AlertTriangle size={22} />
          <div>
            <p className="font-black">
              {stats.fire ? 'FIRE ALARM — CRITICAL' : stats.smoke ? 'SMOKE ALARM — HIGH PRIORITY' : 'PPE SAFETY ALARM'}
            </p>
            <p className="text-xs font-semibold opacity-90">
              {stats.fire ? 'Fire detected by the Fire/Smoke model.' : stats.smoke ? 'Smoke detected by the Fire/Smoke model.' : 'A tracked worker is missing required PPE.'}
            </p>
          </div>
        </div>
      )}

      <section className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {[
          ['Tracked Workers', state.active_tracks || 0, Users],
          ['Verified', verified.length, ShieldCheck],
          ['Unsafe', unsafe.length, AlertTriangle],
          ['Hazards', stats.hazards || 0, MapPinned],
        ].map(([label, value, Icon]) => (
          <div key={label} className="rounded-2xl border bg-white p-4 shadow-sm">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-slate-100 text-slate-700"><Icon size={18} /></div>
            <p className="mt-3 text-[11px] font-semibold text-slate-500">{label}</p>
            <p className="mt-1 text-2xl font-black">{value}</p>
          </div>
        ))}
      </section>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
        <section className="rounded-2xl border bg-white p-4 shadow-sm">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h2 className="font-black">Camera Floor Map</h2>
              <p className="text-[11px] text-slate-500">{state.camera_source || 'CP Plus RTSP'} · live relative positions</p>
            </div>
            <span className="inline-flex items-center gap-2 rounded-full bg-emerald-50 px-3 py-1 text-[10px] font-black text-emerald-700">
              <span className="h-2 w-2 rounded-full bg-emerald-500" /> LIVE
            </span>
          </div>

          <div className="relative aspect-[16/10] overflow-hidden rounded-2xl border-2 border-slate-300 bg-slate-100">
            <div className="absolute inset-0 grid grid-cols-3 grid-rows-3">
              {zoneNames.map(([zone, label]) => (
                <div key={zone} className="relative border border-slate-300/80">
                  <span className="absolute left-2 top-2 text-[9px] font-black uppercase tracking-wider text-slate-400">{label}</span>
                </div>
              ))}
            </div>

            {workers.map((w) => (
              <div
                key={w.track_id}
                className={`absolute -translate-x-1/2 -translate-y-1/2 transition-all duration-300 ${w.compliant ? '' : 'animate-pulse'}`}
                style={{ left: `${(w.position?.x || 0.5) * 100}%`, top: `${(w.position?.y || 0.5) * 100}%` }}
                title={`${w.worker_name} · ${w.zone}`}
              >
                <div className={`flex h-11 w-11 items-center justify-center rounded-full border-4 text-xs font-black shadow-lg ${w.compliant ? 'border-emerald-500 bg-emerald-100 text-emerald-800' : 'border-rose-500 bg-rose-100 text-rose-800'}`}>
                  #{w.track_id}
                </div>
                <div className="mt-1 whitespace-nowrap rounded-md bg-slate-950 px-2 py-1 text-[9px] font-black text-white shadow">
                  {w.worker_name} · {w.zone}
                </div>
              </div>
            ))}

            {workers.length === 0 && (
              <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
                <Camera size={38} className="text-slate-400" />
                <p className="mt-2 text-sm font-black text-slate-500">No tracked workers</p>
                <p className="text-xs text-slate-400">Start Live Detection to populate this map.</p>
              </div>
            )}

            {stats.fire && <div className="absolute right-3 top-3 rounded-xl bg-rose-600 px-3 py-2 text-xs font-black text-white shadow-lg">🔥 FIRE</div>}
            {!stats.fire && stats.smoke && <div className="absolute right-3 top-3 rounded-xl bg-amber-500 px-3 py-2 text-xs font-black text-white shadow-lg">💨 SMOKE</div>}
          </div>

          <div className="mt-4 flex flex-wrap gap-3 text-[10px] font-black">
            <span className="inline-flex items-center gap-2"><span className="h-3 w-3 rounded-full bg-emerald-500" /> Safe</span>
            <span className="inline-flex items-center gap-2"><span className="h-3 w-3 rounded-full bg-rose-500" /> PPE violation</span>
            <span className="inline-flex items-center gap-2"><span className="h-3 w-3 rounded-full bg-slate-400" /> Relative camera zone</span>
          </div>
        </section>

        <section className="rounded-2xl border bg-white p-4 shadow-sm">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="font-black">Tracked Workers</h2>
            <span className="text-[10px] font-black text-slate-400">{workers.length} active</span>
          </div>
          <div className="space-y-3">
            {workers.map((w) => (
              <article key={w.track_id} className={`rounded-xl border p-3 ${w.compliant ? 'border-emerald-100 bg-emerald-50/50' : 'border-rose-200 bg-rose-50'}`}>
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="text-sm font-black">{w.worker_name}</p>
                    <p className="text-[10px] font-bold text-slate-500">Track #{w.track_id} · {w.zone}</p>
                  </div>
                  <span className={`rounded-full px-2 py-1 text-[9px] font-black ${w.compliant ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-700'}`}>
                    {w.compliant ? 'SAFE' : w.risk}
                  </span>
                </div>
                <div className="mt-3 grid grid-cols-4 gap-1 text-[9px] font-black">
                  {[
                    ['Helmet', w.helmet],
                    ['Vest', w.vest],
                    ['Gloves', w.gloves],
                    ['Shoes', w.shoes],
                  ].map(([item, ok]) => (
                    <div key={item} className={`rounded-lg p-2 text-center ${ok ? 'bg-white text-emerald-700' : 'bg-rose-100 text-rose-700'}`}>
                      {ok ? '✓' : '✗'} {item}
                    </div>
                  ))}
                </div>
                {!w.verified && <p className="mt-2 text-[10px] font-black text-rose-700">⚠ Unknown / not matched to registration</p>}
              </article>
            ))}
            {!workers.length && <p className="py-8 text-center text-xs font-semibold text-slate-400">No active tracks.</p>}
          </div>
        </section>
      </div>
    </div>
  );
}
