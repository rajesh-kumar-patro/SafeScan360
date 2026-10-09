import React, { useState } from 'react';
import { Link, NavLink, useNavigate } from 'react-router-dom';
import { Menu, X } from 'lucide-react';
import img from '../assets/ppe-logo.png';
import { useAuth } from '../auth/AuthContext';

const links = [
  { label: 'Home', to: '/' },
  { label: 'Dashboard', to: '/dashboard' },
  { label: 'Live Detection', to: '/live' },
  { label: 'Safety Map', to: '/safety-map' },
  { label: 'Verify', to: '/verify' },
  { label: 'Register', to: '/register-worker' },
  { label: 'Workers', to: '/workers' },
  { label: 'Alerts', to: '/alerts' },
  { label: 'Incidents', to: '/incident-archive' },
  // { label: 'Features', to: '/#features' },
  // { label: 'How It Works', to: '/#how-it-works' },
  // { label: 'About', to: '/#about' },
];

export default function Navbar({ onOpenModal }) {
  const [open, setOpen] = useState(false);

  const closeMenu = () => setOpen(false);

  // NEW: Logout clears the server session, then returns to the Sign In page.
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const handleLogout = async () => {
    closeMenu();
    await signOut();
    navigate('/signin', { replace: true });
  };

  return (
    <header className="sticky top-0 z-50 border-b border-blue-900/10 bg-black text-white shadow-md">
      <div className="mx-auto flex min-h-[70px] w-full max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
        <Link to="/" onClick={closeMenu} className="flex min-w-0 items-center gap-3">
          <div className="h-12 w-12 shrink-0 overflow-hidden rounded-xl bg-white/5 flex items-center justify-center">
            <img src={img} alt="SafeScan 360" className="h-full w-full object-contain p-1" />
          </div>
          <div className="min-w-0">
            <h1 className="truncate text-sm font-extrabold tracking-wide">SafeScan<span className="text-blue-200">360</span></h1>
            <p className="hidden text-[10px] font-medium text-blue-100 sm:block">Smart Industrial Safety Prototype</p>
          </div>
        </Link>

        <nav className="hidden items-center gap-4 xl:flex text-[11px] font-bold uppercase tracking-wider text-blue-100">
          {links.map((link) => (
            link.to.startsWith('/#') ? (
              <a key={link.label} href={link.to} className="hover:text-white transition">{link.label}</a>
            ) : (
              <NavLink
                key={link.label}
                to={link.to}
                className={({ isActive }) => `transition hover:text-white ${isActive ? 'text-white' : ''}`}
              >
                {link.label}
              </NavLink>
            )
          ))}
        </nav>

        <div className="flex items-center gap-2">
          {user && (
            <span className="hidden 2xl:inline max-w-[140px] truncate text-[11px] font-bold text-blue-100" title={user.email}>{user.name}</span>
          )}
          <button onClick={handleLogout} className="hidden sm:inline-flex rounded-xl border border-blue-300/40 px-4 py-2.5 text-xs font-bold text-white hover:bg-white/10 transition">
            Logout
          </button>
          <button onClick={onOpenModal} className="hidden sm:inline-flex rounded-xl bg-white px-4 py-2.5 text-xs font-bold text-blue-700 shadow-sm hover:bg-blue-50 transition">
            Start Detection
          </button>
          <button
            onClick={() => setOpen((value) => !value)}
            className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-blue-800 bg-blue-950/60 xl:hidden"
            aria-label="Toggle navigation"
          >
            {open ? <X size={19} /> : <Menu size={19} />}
          </button>
        </div>
      </div>

      {open && (
        <div className="border-t border-blue-900 bg-slate-950 px-4 py-4 xl:hidden">
          <nav className="mx-auto max-w-7xl space-y-1">
            {links.map((link) => (
              link.to.startsWith('/#') ? (
                <a key={link.label} href={link.to} onClick={closeMenu} className="block rounded-xl px-4 py-3 text-xs font-bold uppercase tracking-wider text-blue-100 hover:bg-blue-900/60">{link.label}</a>
              ) : (
                <Link key={link.label} to={link.to} onClick={closeMenu} className="block rounded-xl px-4 py-3 text-xs font-bold uppercase tracking-wider text-blue-100 hover:bg-blue-900/60">{link.label}</Link>
              )
            ))}
            <button onClick={() => { closeMenu(); onOpenModal(); }} className="mt-2 w-full rounded-xl bg-white px-4 py-3 text-xs font-bold text-blue-700">Start Detection</button>
            <button onClick={handleLogout} className="mt-2 w-full rounded-xl border border-blue-300/40 px-4 py-3 text-xs font-bold text-white">Logout{user ? ` (${user.name})` : ''}</button>
          </nav>
        </div>
      )}
    </header>
  );
}
