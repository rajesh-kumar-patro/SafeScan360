import React from 'react';
import { Link } from 'react-router-dom';
import { Image, Video, Camera, ShieldCheck, X } from 'lucide-react';

const options = [
  { path: '/image', icon: Image, title: 'Image Detection', text: 'Inspect a photo for PPE compliance and safety hazards.' },
  { path: '/video', icon: Video, title: 'Video Detection', text: 'Upload recorded CCTV footage and run a safety audit.' },
  { path: '/live', icon: Camera, title: 'Live Detection', text: 'Monitor a connected camera feed in real time.' },
  { path: '/verify', icon: ShieldCheck, title: 'Work Verification', text: 'Verify a registered worker\'s face, then check PPE before work is allowed.' },
];

export default function DetectionModal({ isOpen, onClose }) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-950/70 p-4 backdrop-blur-sm" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="w-full max-w-xl overflow-hidden rounded-3xl border border-blue-800 bg-gradient-to-br from-blue-950 to-slate-950 text-white shadow-2xl">
        <div className="flex items-start justify-between gap-4 border-b border-blue-800/80 p-5 sm:p-6">
          <div>
            <p className="text-[10px] font-black uppercase tracking-[0.2em] text-blue-300">SafeScan360</p>
            <h3 className="mt-1 text-xl font-black">Choose Detection Mode</h3>
            <p className="mt-1 text-xs text-blue-200">Select how you want to inspect the workplace.</p>
          </div>
          <button onClick={onClose} aria-label="Close detection menu" className="rounded-xl p-2 text-blue-300 hover:bg-white/10 hover:text-white transition">
            <X size={20} />
          </button>
        </div>

        <div className="grid gap-3 p-4 sm:p-5">
          {options.map(({ path, icon: Icon, title, text }, index) => (
            <Link
              key={path}
              to={path}
              onClick={onClose}
              className="group flex items-center gap-4 rounded-2xl border border-blue-800/80 bg-blue-900/30 p-4 transition hover:border-blue-400 hover:bg-blue-800/50"
            >
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-blue-600 text-white shadow-lg group-hover:scale-105 transition">
                <Icon size={20} />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-[9px] font-black text-blue-300">0{index + 1}</span>
                  <h4 className="text-sm font-black">{title}</h4>
                </div>
                <p className="mt-1 text-xs leading-relaxed text-blue-200">{text}</p>
              </div>
            </Link>
          ))}
        </div>

        <div className="border-t border-blue-800/80 px-5 py-3 text-center text-[10px] text-blue-300">
          You can also access all three modes from the Dashboard.
        </div>
      </div>
    </div>
  );
}
