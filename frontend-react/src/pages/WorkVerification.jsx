import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import LiveVerificationPanel from '../components/verification/LiveVerificationPanel';
import { getWorkflowStatus } from '../utils/verifyApi';

// Live Detection of registered workers: face verification -> PPE -> alert. Registration lives on its own pages.
export default function WorkVerification() {
  const [status, setStatus] = useState(null);
  const [statusError, setStatusError] = useState('');

  useEffect(() => {
    getWorkflowStatus().then(setStatus).catch((e) => setStatusError(e.message));
  }, []);

  const warnings = [];
  if (statusError) warnings.push(statusError);
  if (status && !status.face_service.ready) warnings.push(status.face_service.reason);
  if (status && !status.ppe_model.ready) warnings.push('PPE detection unavailable. ' + status.ppe_model.reason);

  return (
    <div className="mx-auto w-full max-w-7xl flex-1 space-y-5 px-4 py-6 sm:px-6 lg:px-8">
      <div>
        <p className="text-[10px] font-black uppercase tracking-[.2em] text-blue-600">Face verification + PPE compliance</p>
        <h1 className="text-2xl font-black sm:text-3xl">Live Verification</h1>
        <p className="mt-1 text-sm text-slate-500">
          The camera compares each face with the permanently registered workers, then checks helmet, vest, gloves and shoes.
          Workers are added only on <Link to="/register-worker" className="font-bold text-blue-600 underline">Register Worker</Link>
          {status ? ` (${status.registered_people} registered)` : ''}; violations are listed under <Link to="/alerts" className="font-bold text-blue-600 underline">Alerts</Link>.
        </p>
      </div>
      {warnings.map((w) => <div key={w} className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm font-semibold text-amber-800">{w}</div>)}
      {status && !status.email_configured && (
        <div className="rounded-xl border border-slate-200 bg-white p-3 text-xs font-semibold text-slate-500">Email alerts are not configured (SMTP settings missing in .env): violations are stored as alerts but no email is sent.</div>
      )}
      <LiveVerificationPanel />
    </div>
  );
}
