import React, { useEffect, useRef, useState } from 'react';
import { Users, Camera } from 'lucide-react';
import { registerPerson } from '../../utils/verifyApi';

const inputCls = 'mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-semibold outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100';
const labelCls = 'text-[10px] font-black uppercase tracking-wider text-slate-500';

export default function RegisterPerson({ onRegistered, showStep = false }) {
  const [name, setName] = useState('');
  const [mobile, setMobile] = useState('');
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [saved, setSaved] = useState(null);
  const fileRef = useRef(null);
  const [camOpen, setCamOpen] = useState(false);
  const videoRef = useRef(null);
  const streamRef = useRef(null);

  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);

  // Optional: capture the registration photo with this computer's camera (admin side only).
  const stopCam = () => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setCamOpen(false);
  };
  useEffect(() => stopCam, []);

  const openCam = async () => {
    setError(null);
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error('no-media');
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 1280 } }, audio: false });
      streamRef.current = stream;
      setCamOpen(true);
      requestAnimationFrame(() => { if (videoRef.current) { videoRef.current.srcObject = stream; videoRef.current.play().catch(() => {}); } });
    } catch {
      setError({ message: 'Camera unavailable. Please check your camera connection (or upload a photo instead).' });
    }
  };

  const snap = () => {
    const v = videoRef.current;
    if (!v || !v.videoWidth) return;
    const c = document.createElement('canvas');
    c.width = v.videoWidth; c.height = v.videoHeight;
    c.getContext('2d').drawImage(v, 0, 0);
    c.toBlob((blob) => {
      if (!blob) return;
      const f = new File([blob], 'capture.jpg', { type: 'image/jpeg' });
      setFile(f); setSaved(null); setError(null);
      setPreview(URL.createObjectURL(f));
      stopCam();
    }, 'image/jpeg', 0.92);
  };

  const pick = (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setFile(f); setError(null); setSaved(null);
    setPreview(URL.createObjectURL(f));
  };

  const submit = async (confirmDuplicateFace = false) => {
    if (!name.trim() || !mobile.trim() || !file) {
      setError({ message: 'Enter full name, mobile number and a face photo.' });
      return;
    }
    setBusy(true); setError(null);
    const body = new FormData();
    body.append('name', name.trim());
    body.append('mobile', mobile.trim());
    body.append('photo', file);
    body.append('confirm_duplicate_face', confirmDuplicateFace ? 'true' : 'false');
    try {
      const data = await registerPerson(body);
      setSaved(data.person);
      onRegistered?.(data.person);
      setName(''); setMobile(''); setFile(null); setPreview(null);
      if (fileRef.current) fileRef.current.value = '';
    } catch (e) {
      setError({ message: e.message, code: e.code });
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="rounded-2xl border bg-white p-5 shadow-sm">
      <div className="mb-4 flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-600 text-white"><Users size={19} /></div>
        <div>
          <p className="text-[10px] font-black uppercase tracking-[.2em] text-blue-600">{showStep ? 'Step 1' : 'Administrator'}</p>
          <h2 className="font-black">Register Worker</h2>
        </div>
      </div>

      <div className="space-y-3">
        <label className="block"><span className={labelCls}>Full name</span>
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} placeholder="e.g. John Doe" className={inputCls} />
        </label>
        <label className="block"><span className={labelCls}>Mobile number</span>
          <input value={mobile} onChange={(e) => setMobile(e.target.value)} inputMode="tel" maxLength={20} placeholder="e.g. 9876543210" className={inputCls} />
        </label>
        <div>
          <span className={labelCls}>Face photo</span>
          <div className="mt-1 flex items-center gap-3">
            <div className="flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-dashed border-slate-300 bg-slate-50 text-[10px] font-bold text-slate-400">
              {preview ? <img src={preview} alt="Selected face" className="h-full w-full object-cover" /> : 'No photo'}
            </div>
            <div className="min-w-0 flex-1">
              <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" capture="user" onChange={pick}
                className="block w-full text-xs file:mr-3 file:rounded-lg file:border-0 file:bg-blue-50 file:px-3 file:py-2 file:text-xs file:font-black file:text-blue-700" />
              <p className="mt-1 text-[11px] text-slate-400">Clear, front-facing photo with only one person.</p>
              <button type="button" onClick={camOpen ? stopCam : openCam} className="mt-2 inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-[11px] font-black text-slate-600 hover:bg-slate-50">
                <Camera size={13} /> {camOpen ? 'Close camera' : 'Capture with camera'}
              </button>
            </div>
          </div>
          {camOpen && (
            <div className="mt-3 overflow-hidden rounded-xl bg-slate-950">
              <video ref={videoRef} muted playsInline className="w-full" style={{ transform: 'scaleX(-1)' }} />
              <button type="button" onClick={snap} className="w-full bg-blue-600 px-4 py-2.5 text-xs font-black text-white">Take photo</button>
            </div>
          )}
        </div>
      </div>

      {error && (
        <div className="mt-4 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm font-semibold text-rose-700">
          {error.message}
          {error.code === 'DUPLICATE_FACE' && (
            <button onClick={() => submit(true)} disabled={busy} className="mt-2 block rounded-lg border border-rose-300 bg-white px-3 py-1.5 text-xs font-black text-rose-700 disabled:opacity-50">
              This is a different person - register anyway
            </button>
          )}
        </div>
      )}

      {saved && (
        <div className="mt-4 flex items-center gap-3 rounded-xl border border-emerald-200 bg-emerald-50 p-3">
          <img src={saved.image} alt={saved.name} className="h-14 w-14 rounded-lg object-cover" />
          <div className="min-w-0 text-sm">
            <p className="font-black text-emerald-700">✓ Worker registered</p>
            <p className="truncate font-bold">{saved.name} · {saved.mobile}</p>
            <p className="text-xs text-slate-500">Worker ID {saved.code} · stored permanently until an administrator deletes it</p>
          </div>
        </div>
      )}

      <button onClick={() => submit(false)} disabled={busy}
        className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 py-3 text-xs font-black text-white disabled:bg-slate-300">
        {busy ? <><span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" /> Registering…</> : 'Register Worker'}
      </button>
    </section>
  );
}
