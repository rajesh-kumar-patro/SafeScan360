import React, { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import AuthLayout, { Field, inputClass } from '../auth/AuthLayout';
import { useAuth } from '../auth/AuthContext';

// Sign In (NEW). On success the backend sets the session cookie and we go to the existing dashboard.
export default function SignIn() {
  const { signIn } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const justRegistered = Boolean(location.state && location.state.registered);

  const [email, setEmail] = useState((location.state && location.state.email) || '');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    const next = {};
    if (!email.trim()) next.email = 'Email is required.';
    else if (!/^\S+@\S+\.\S+$/.test(email.trim())) next.email = 'Enter a valid email address.';
    if (!password) next.password = 'Password is required.';
    setErrors(next);
    setFormError('');
    if (Object.keys(next).length) return;

    setBusy(true);
    try {
      await signIn(email.trim(), password);
      navigate('/dashboard', { replace: true });   // existing main application
    } catch (err) {
      setFormError(err.message || 'Could not sign in.');   // e.g. "Invalid email or password."
      setPassword('');
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthLayout title="Sign In" subtitle="Welcome back. Enter your account details to continue.">
      {justRegistered && (
        <div className="mb-4 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm font-semibold text-emerald-700" role="status">
          Account created successfully. Please sign in.
        </div>
      )}
      {formError && (
        <div className="mb-4 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm font-semibold text-rose-700" role="alert">{formError}</div>
      )}
      <form onSubmit={submit} noValidate className="space-y-4">
        <Field id="email" label="Email" error={errors.email}>
          <input id="email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)}
            aria-invalid={Boolean(errors.email)} className={inputClass(errors.email)} placeholder="you@company.com" />
        </Field>
        <Field id="password" label="Password" error={errors.password}>
          <div className="relative">
            <input id="password" type={show ? 'text' : 'password'} autoComplete="current-password" value={password}
              onChange={(e) => setPassword(e.target.value)} aria-invalid={Boolean(errors.password)}
              className={`${inputClass(errors.password)} pr-16`} placeholder="Your password" />
            <button type="button" onClick={() => setShow((v) => !v)}
              className="absolute inset-y-0 right-3 text-xs font-black text-slate-500 hover:text-slate-900">{show ? 'Hide' : 'Show'}</button>
          </div>
        </Field>
        <button type="submit" disabled={busy}
          className="w-full rounded-xl bg-blue-600 px-5 py-3.5 text-sm font-black text-white shadow-sm hover:bg-blue-700 disabled:bg-slate-300 transition">
          {busy ? 'Signing in…' : 'Sign In'}
        </button>
      </form>
      <p className="mt-6 text-sm text-slate-500">
        New here? <Link to="/signup" className="font-black text-blue-600 hover:underline">Create an account</Link>
      </p>
    </AuthLayout>
  );
}
