import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Trash2, UserPlus } from 'lucide-react';
import { listWorkers, deleteWorker } from '../utils/verifyApi';

const fmtDate = (stamp) => {
  const [d] = String(stamp || '').split(' ');
  const [y, m, day] = d.split('-');
  return y && m && day ? `${day}/${m}/${y}` : '-';
};

export default function RegisteredWorkers() {
  const [workers, setWorkers] = useState(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [target, setTarget] = useState(null);   // worker awaiting delete confirmation
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    listWorkers().then((d) => { setWorkers(d.workers); setError(''); }).catch((e) => setError(e.message));
  }, []);
  useEffect(load, [load]);

  const confirmDelete = async () => {
    if (!target) return;
    setBusy(true);
    try {
      const res = await deleteWorker(target.id);
      setNotice(res.message || `${target.name} removed from registered workers.`);
      setTarget(null);
      load();
    } catch (e) {
      setError(e.message);
      setTarget(null);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto w-full max-w-7xl flex-1 space-y-5 px-4 py-6 sm:px-6 lg:px-8">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          {/* <p className="text-[10px] font-black uppercase tracking-[.2em] text-blue-600">Worker database</p> */}
          <h1 className="text-2xl font-black sm:text-3xl">Registered Workers</h1>
          <p className="mt-1 text-sm text-slate-500">Registrations stay here permanently until an administrator deletes them.</p>
        </div>
        <Link to="/register-worker" className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-xs font-black text-white"><UserPlus size={15} /> Register Worker</Link>
      </div>

      {error && <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm font-semibold text-rose-700">{error}</div>}
      {notice && <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm font-semibold text-emerald-700">✓ {notice}</div>}

      <div className="overflow-x-auto rounded-2xl border bg-white shadow-sm">
        <table className="w-full min-w-[640px] text-left text-sm">
          <thead className="bg-slate-50 text-[10px] font-black uppercase tracking-wider text-slate-400">
            <tr><th className="px-4 py-3">Photo</th><th className="px-4 py-3">Name</th><th className="px-4 py-3">Worker ID</th><th className="px-4 py-3">Mobile</th><th className="px-4 py-3">Registered On</th><th className="px-4 py-3 text-right">Action</th></tr>
          </thead>
          <tbody className="divide-y">
            {workers === null && !error && <tr><td colSpan={6} className="px-4 py-8 text-center text-slate-400">Loading…</td></tr>}
            {workers && workers.length === 0 && <tr><td colSpan={6} className="px-4 py-8 text-center text-slate-400">No workers registered yet.</td></tr>}
            {(workers || []).map((w) => (
              <tr key={w.id}>
                <td className="px-4 py-3"><img src={w.image} alt={w.name} className="h-14 w-14 rounded-xl border object-cover" /></td>
                <td className="px-4 py-3 font-black">{w.name}</td>
                <td className="px-4 py-3 font-bold text-slate-500">{w.code}</td>
                <td className="px-4 py-3 font-bold">{w.mobile}</td>
                <td className="px-4 py-3 font-bold text-slate-500">{fmtDate(w.created_at)}</td>
                <td className="px-4 py-3 text-right">
                  <button onClick={() => setTarget(w)} className="inline-flex items-center gap-1.5 rounded-lg border border-rose-200 px-3 py-1.5 text-xs font-black text-rose-600 hover:bg-rose-50"><Trash2 size={13} /> Delete</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {target && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/60 p-4" role="dialog" aria-modal="true">
          <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-2xl">
            <h3 className="text-lg font-black">Delete worker?</h3>
            <p className="mt-2 text-sm text-slate-600">Are you sure you want to permanently delete this worker?</p>
            <div className="mt-3 flex items-center gap-3 rounded-xl bg-slate-50 p-3">
              <img src={target.image} alt={target.name} className="h-12 w-12 rounded-lg object-cover" />
              <div className="text-sm"><p className="font-black">{target.name}</p><p className="text-xs text-slate-500">{target.mobile}</p></div>
            </div>
            <p className="mt-3 text-xs text-slate-400">Name, mobile number, face photo and face data are erased and cannot be recovered. Past PPE alerts are kept.</p>
            <div className="mt-5 flex justify-end gap-2">
              <button onClick={() => setTarget(null)} disabled={busy} className="rounded-xl border px-4 py-2.5 text-xs font-black">Cancel</button>
              <button onClick={confirmDelete} disabled={busy} className="rounded-xl bg-rose-600 px-4 py-2.5 text-xs font-black text-white disabled:opacity-50">{busy ? 'Deleting…' : 'Delete'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
