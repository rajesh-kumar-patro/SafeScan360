import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import AuthLayout, { Field, inputClass } from '../auth/AuthLayout';
import { signUpRequest } from '../auth/authApi';

// Sign Up (NEW). Client-side checks give instant feedback; the backend re-validates everything
// (it is the authority) and stores the password only as a salted scrypt hash.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[A-Za-z]{2,}$/;

function validate(f) {
  const e = {};
  const name = f.name.trim();
  if (name.length < 2) e.name = 'Enter your full name (at least 2 characters).';
  if (!f.email.trim()) e.email = 'Email is required.';
  else if (!EMAIL_RE.test(f.email.trim())) e.email = 'Enter a valid email address.';
  const digits = f.mobile.replace(/\D/g, '');
  if (!f.mobile.trim()) e.mobile = 'Mobile number is required.';
  else if (/[^\d\s+\-().]/.test(f.mobile) || digits.length < 7 || digits.length > 15) e.mobile = 'Enter a valid mobile number (7-15 digits).';
  if (f.password.length < 8) e.password = 'Use at least 8 characters.';
  else if (!/[A-Za-z]/.test(f.password) || !/\d/.test(f.password)) e.password = 'Include at least one letter and one number.';
  if (!f.confirm_password) e.confirm_password = 'Please confirm your password.';
  else if (f.password !== f.confirm_password) e.confirm_password = 'Passwords do not match.';
  return e;
}

export default function SignUp() {
  const navigate = useNavigate();
  const [form, setForm] = useState({ name: '', email: '', mobile: '', password: '', confirm_password: '' });
  const [show, setShow] = useState(false);
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState('');
  const [busy, setBusy] = useState(false);

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    const found = validate(form);
    setErrors(found);
    setFormError('');
    if (Object.keys(found).length) return;

    setBusy(true);
    try {
      await signUpRequest({ ...form, name: form.name.trim(), email: form.email.trim() });
      // Registered. Ask them to sign in (email pre-filled, success banner shown there).
      navigate('/signin', { replace: true, state: { registered: true, email: form.email.trim() } });
    } catch (err) {
      setErrors(err.fields || {});                      // server-side field messages, e.g. duplicate email
      setFormError(err.message || 'Could not create the account.');
    } finally {
      setBusy(false);
    }
  };

  const input = (id, label, type, extra = {}) => (
    <Field id={id} label={label} error={errors[id]} hint={extra.hint}>
      <input id={id} type={type} value={form[id]} onChange={set(id)} autoComplete={extra.autoComplete}
        aria-invalid={Boolean(errors[id])} className={inputClass(errors[id])} placeholder={extra.placeholder} />
    </Field>
  );

  return (
    <AuthLayout title="Create your account" subtitle="Sign up to access SafeScan360.">
      {formError && (
        <div className="mb-4 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm font-semibold text-rose-700" role="alert">{formError}</div>
      )}
      <form onSubmit={submit} noValidate className="space-y-4">
        {input('name', 'Full Name', 'text', { autoComplete: 'name', placeholder: 'Your full name' })}
        {input('email', 'Email Address', 'email', { autoComplete: 'email', placeholder: 'you@company.com' })}
        {input('mobile', 'Mobile Number', 'tel', { autoComplete: 'tel', placeholder: '+91 98765 43210' })}
        <Field id="password" label="Password" error={errors.password} hint="At least 8 characters, with a letter and a number.">
          <div className="relative">
            <input id="password" type={show ? 'text' : 'password'} value={form.password} onChange={set('password')} autoComplete="new-password"
              aria-invalid={Boolean(errors.password)} className={`${inputClass(errors.password)} pr-16`} placeholder="Create a password" />
            <button type="button" onClick={() => setShow((v) => !v)}
              className="absolute inset-y-0 right-3 text-xs font-black text-slate-500 hover:text-slate-900">{show ? 'Hide' : 'Show'}</button>
          </div>
        </Field>
        <Field id="confirm_password" label="Confirm Password" error={errors.confirm_password}>
          <input id="confirm_password" type={show ? 'text' : 'password'} value={form.confirm_password} onChange={set('confirm_password')}
            autoComplete="new-password" aria-invalid={Boolean(errors.confirm_password)} className={inputClass(errors.confirm_password)} placeholder="Repeat the password" />
        </Field>
        <button type="submit" disabled={busy}
          className="w-full rounded-xl bg-blue-600 px-5 py-3.5 text-sm font-black text-white shadow-sm hover:bg-blue-700 disabled:bg-slate-300 transition">
          {busy ? 'Creating account…' : 'Sign Up'}
        </button>
      </form>
      <p className="mt-6 text-sm text-slate-500">
        Already have an account? <Link to="/signin" className="font-black text-blue-600 hover:underline">Sign in</Link>
      </p>
    </AuthLayout>
  );
}
