import React from 'react';
import { Link } from 'react-router-dom';
import AuthLayout from '../auth/AuthLayout';

// First screen a logged-out visitor sees (NEW): choose Sign In or Sign Up.
export default function Welcome() {
  return (
    <AuthLayout title="Welcome to SafeScan360" subtitle="Sign in to open the safety dashboard, or create an account if you are new.">
      <div className="space-y-3">
        <Link to="/signin" className="block w-full rounded-xl bg-blue-600 px-5 py-3.5 text-center text-sm font-black text-white shadow-sm hover:bg-blue-700 transition">
          Sign In
        </Link>
        <Link to="/signup" className="block w-full rounded-xl border-2 border-slate-900 bg-white px-5 py-3.5 text-center text-sm font-black text-slate-900 hover:bg-slate-900 hover:text-white transition">
          Sign Up
        </Link>
      </div>
      <p className="mt-6 text-xs text-slate-400">You need an account to access live detection, worker verification, alerts and analytics.</p>
    </AuthLayout>
  );
}
