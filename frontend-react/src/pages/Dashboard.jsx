import React, { useEffect, useMemo, useState } from 'react';
import { NavLink, Link } from 'react-router-dom';

import {
  LayoutDashboard,
  Image as ImageIcon,
  Video,
  Camera,
  Bell,
  BarChart3,
  Settings,
  Home,
  Users,
  ShieldCheck,
  AlertTriangle,
  Flame,
  CloudFog,
  RefreshCw,
  Menu,
  X,
  ChevronRight,
  Activity,
  Clock3,
} from 'lucide-react';

const fallbackStats = {
  total_workers: 0,
  compliant: 0,
  violations: 0,
  hazards: 0,
  compliance_pct: '0%',
};

const menuItems = [
  {
    label: 'Dashboard',
    to: '/dashboard',
    icon: LayoutDashboard,
  },
  {
    label: 'Image Detection',
    to: '/image',
    icon: ImageIcon,
  },
  {
    label: 'Video Audit',
    to: '/video',
    icon: Video,
  },
  {
    label: 'Live Detection',
    to: '/live',
    icon: Camera,
  },
  {
    label: 'Work Verification',
    to: '/verify',
    icon: ShieldCheck,
  },
  {
    label: 'Alerts & Violations',
    to: '/incident-archive',
    icon: Bell,
  },
];

const utilityItems = [
  {
    label: 'Analytics',
    to: '/analytics',
    icon: BarChart3,
  },
  {
    label: 'Settings',
    icon: Settings,
  },
];

export default function Dashboard() {
  const [stats, setStats] = useState(fallbackStats);
  const [incidents, setIncidents] = useState([]);
  const [loading, setLoading] = useState(true);

  // Mobile sidebar state
  const [mobileOpen, setMobileOpen] = useState(false);

  const [modelStatus, setModelStatus] = useState(null);

  const loadDashboard = async () => {
    try {
      const [statsRes, incidentsRes, modelRes] = await Promise.all([
        fetch('/api/live-stats'),
        fetch('/api/incidents'),
        fetch('/api/models/status'),
      ]);

      if (statsRes.ok) {
        setStats({
          ...fallbackStats,
          ...(await statsRes.json()),
        });
      }

      if (modelRes.ok) {
        setModelStatus(await modelRes.json());
      }

      if (incidentsRes.ok) {
        const data = await incidentsRes.json();
        setIncidents(data.incidents || []);
      }
    } catch (error) {
      // Dashboard remains usable when backend is offline.
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadDashboard();

    const timer = setInterval(loadDashboard, 5000);

    return () => clearInterval(timer);
  }, []);

  const violations = useMemo(
    () =>
      incidents
        .filter((item) => item.type !== 'COMPLIANCE_OK')
        .slice(0, 8),
    [incidents]
  );

  const compliance = Math.min(
    parseFloat(stats.compliance_pct) || 0,
    100
  );

  const fireEvents = incidents.filter(
    (item) => item.type === 'FIRE'
  ).length;

  const smokeEvents = incidents.filter(
    (item) => item.type === 'SMOKE'
  ).length;

  const statCards = [
    {
      label: 'Workers',
      value: stats.total_workers ?? 0,
      icon: Users,
      cls: 'text-blue-700 bg-blue-50 border-blue-100',
    },
    {
      label: 'Compliant',
      value: stats.compliant ?? 0,
      icon: ShieldCheck,
      cls: 'text-emerald-700 bg-emerald-50 border-emerald-100',
    },
    {
      label: 'Violations',
      value: stats.violations ?? 0,
      icon: AlertTriangle,
      cls: 'text-amber-700 bg-amber-50 border-amber-100',
    },
    {
      label: 'Hazards',
      value: stats.hazards ?? 0,
      icon: Flame,
      cls: 'text-rose-700 bg-rose-50 border-rose-100',
    },
    {
      label: 'Fire Events',
      value: fireEvents,
      icon: Flame,
      cls: 'text-red-700 bg-red-50 border-red-100',
    },
    {
      label: 'Smoke Events',
      value: smokeEvents,
      icon: CloudFog,
      cls: 'text-amber-700 bg-amber-50 border-amber-100',
    },
  ];

  /*
   * SIDEBAR
   *
   * The only important change here is the X button.
   * It appears only on mobile using lg:hidden.
   */
  const sidebar = (
    <aside className="flex h-full w-[270px] shrink-0 flex-col border-r border-slate-200 bg-white">

      {/* Sidebar Header */}
      <div className="border-b border-slate-100 px-5 py-5">

        <div className="flex items-start justify-between gap-3">

          <div>
            <p className="text-[10px] font-black uppercase tracking-[0.2em] text-blue-600">
              Safety Operations
            </p>

            <h2 className="mt-1 text-lg font-black text-slate-900">
              Command Center
            </h2>
          </div>

          {/* MOBILE CLOSE BUTTON */}
          <button
            type="button"
            onClick={() => setMobileOpen(false)}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-slate-50 text-slate-600 transition hover:border-red-200 hover:bg-red-50 hover:text-red-600 lg:hidden"
            aria-label="Close sidebar"
          >
            <X size={18} />
          </button>

        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-3 py-4">

        {/* Monitoring */}
        <p className="px-3 pb-2 text-[10px] font-black uppercase tracking-[0.18em] text-slate-400">
          Monitoring
        </p>

        <nav className="space-y-1">

          {menuItems.map(({ label, to, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              onClick={() => setMobileOpen(false)}
              className={({ isActive }) =>
                `group flex items-center gap-3 rounded-xl px-3 py-3 text-xs font-bold transition ${
                  isActive
                    ? 'bg-blue-50 text-blue-700 shadow-sm ring-1 ring-blue-100'
                    : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
                }`
              }
            >
              <Icon size={17} />

              <span className="flex-1">
                {label}
              </span>

              <ChevronRight
                size={14}
                className="opacity-0 transition group-hover:opacity-60"
              />
            </NavLink>
          ))}

        </nav>

        {/* System */}
        <p className="px-3 pb-2 pt-7 text-[10px] font-black uppercase tracking-[0.18em] text-slate-400">
          System
        </p>

        <nav className="space-y-1">

          {/* Analytics */}
          <NavLink
            to="/analytics"
            onClick={() => setMobileOpen(false)}
            className={({ isActive }) =>
              `group flex items-center gap-3 rounded-xl px-3 py-3 text-xs font-bold transition ${
                isActive
                  ? 'bg-blue-50 text-blue-700 shadow-sm ring-1 ring-blue-100'
                  : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
              }`
            }
          >
            <BarChart3 size={17} />

            <span className="flex-1">
              Analytics
            </span>

            <ChevronRight
              size={14}
              className="opacity-0 transition group-hover:opacity-60"
            />
          </NavLink>

          {/* Settings */}
          <button
            type="button"
            className="flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left text-xs font-bold text-slate-500 transition hover:bg-slate-50 hover:text-slate-900"
          >
            <Settings size={17} />

            <span className="flex-1">
              Settings
            </span>
          </button>

        </nav>
      </div>

      {/* Back to Home */}
      <div className="border-t border-slate-100 p-3">
        <Link
          to="/"
          onClick={() => setMobileOpen(false)}
          className="flex items-center gap-3 rounded-xl px-3 py-3 text-xs font-bold text-slate-500 hover:bg-slate-50 hover:text-slate-900"
        >
          <Home size={17} />

          <span>
            Back to Home
          </span>
        </Link>
      </div>

    </aside>
  );

  return (
    <div className="flex min-h-[calc(100vh-70px)] w-full bg-slate-100">

      {/* =========================================================
          DESKTOP SIDEBAR
          ========================================================= */}
      <div className="hidden lg:block">
        {sidebar}
      </div>


      {/* =========================================================
          MOBILE SIDEBAR
          ========================================================= */}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">

          {/* Dark overlay */}
          <button
            type="button"
            className="absolute inset-0 bg-slate-950/50"
            onClick={() => setMobileOpen(false)}
            aria-label="Close sidebar overlay"
          />

          {/* Sidebar */}
          <div className="relative h-full w-[285px] shadow-2xl">
            {sidebar}
          </div>

        </div>
      )}


      {/* =========================================================
          MAIN CONTENT
          ========================================================= */}
      <main className="min-w-0 flex-1 p-4 sm:p-6 lg:p-7">

        <div className="mx-auto max-w-[1500px]">

          {/* Header */}
          <div className="mb-5 flex items-center justify-between gap-4">

            <div className="flex items-center gap-3">

              {/* MOBILE MENU BUTTON */}
              <button
                type="button"
                onClick={() => setMobileOpen(true)}
                className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-700 lg:hidden"
                aria-label="Open dashboard sidebar"
              >
                <Menu size={18} />
              </button>

              <div>
                <p className="text-[10px] font-black uppercase tracking-[0.2em] text-blue-600">
                  Live Operations
                </p>

                <h1 className="text-xl font-black text-slate-950 sm:text-2xl">
                  Safety Dashboard
                </h1>
              </div>

            </div>

            <button
              type="button"
              onClick={loadDashboard}
              className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-700 shadow-sm hover:bg-slate-50"
            >
              <RefreshCw
                size={14}
                className={loading ? 'animate-spin' : ''}
              />

              <span className="hidden sm:inline">
                Refresh
              </span>
            </button>

          </div>


          {/* Model Status */}
          <section className="mb-5 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">

            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">

              <div>
                <p className="text-[10px] font-black uppercase tracking-[.18em] text-blue-600">
                  Model Status 
                </p>

                <h2 className="mt-1 text-sm font-black">
                  Two-model inference engine
                </h2>
              </div>

              <div className="flex flex-wrap gap-2 text-[10px] font-black">

                <span className="rounded-full bg-emerald-50 px-3 py-1 text-emerald-700">
                  PPE {modelStatus?.ppe_model ? '✓ Loaded' : '—'}
                </span>

                <span className="rounded-full bg-emerald-50 px-3 py-1 text-emerald-700">
                  Fire/Smoke{' '}
                  {modelStatus?.fire_smoke_model
                    ? '✓ Loaded'
                    : '—'}
                </span>

                <span className="rounded-full bg-slate-100 px-3 py-1 text-slate-700">
                  Device: {modelStatus?.device || '—'}
                </span>

              </div>

            </div>

            {modelStatus && (
              <p className="mt-3 text-[11px] text-slate-500">
                PPE:{' '}
                {(modelStatus.ppe_classes || []).join(', ')}
                {' · '}
                Fire/Smoke:{' '}
                {(modelStatus.fire_smoke_classes || []).join(', ')}
              </p>
            )}

          </section>


          {/* Statistics */}
          <section className="mb-5 grid grid-cols-2 gap-3 xl:grid-cols-3 2xl:grid-cols-6">

            {statCards.map(
              ({ label, value, icon: Icon, cls }) => (
                <div
                  key={label}
                  className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"
                >

                  <div
                    className={`mb-3 flex h-9 w-9 items-center justify-center rounded-xl border ${cls}`}
                  >
                    <Icon size={18} />
                  </div>

                  <p className="text-[11px] font-semibold text-slate-500">
                    {label}
                  </p>

                  <p className="mt-1 text-2xl font-black text-slate-950">
                    {value}
                  </p>

                </div>
              )
            )}

          </section>


          <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_390px]">

            {/* Main operations area */}
            <section className="space-y-5">

              {/* Detection Center */}
              <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">

                <div className="flex items-center justify-between gap-3">

                  <div>
                    <p className="text-[10px] font-black uppercase tracking-[0.18em] text-blue-600">
                      Detection Center
                    </p>

                    <h2 className="mt-1 text-lg font-black text-slate-900">
                      Choose monitoring mode
                    </h2>
                  </div>

                  <span className="rounded-full bg-emerald-50 px-3 py-1 text-[10px] font-black text-emerald-700">
                    {compliance.toFixed(1)}% compliance
                  </span>

                </div>


                <div className="mt-5 grid grid-cols-1 gap-3 md:grid-cols-3">

                  {[
                    [
                      'Image Detection',
                      'Inspect a safety photo',
                      '/image',
                      ImageIcon,
                    ],
                    [
                      'Video Audit',
                      'Analyze recorded CCTV',
                      '/video',
                      Video,
                    ],
                    [
                      'Live Detection',
                      'Monitor camera feed',
                      '/live',
                      Camera,
                    ],
                  ].map(([title, text, to, Icon]) => (
                    <Link
                      key={to}
                      to={to}
                      className="group rounded-xl border border-slate-200 bg-slate-50 p-4 transition hover:-translate-y-0.5 hover:border-blue-300 hover:bg-white hover:shadow-md"
                    >

                      <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-100 text-blue-700">
                        <Icon size={19} />
                      </div>

                      <h3 className="mt-4 text-sm font-black text-slate-900">
                        {title}
                      </h3>

                      <p className="mt-1 text-[11px] leading-relaxed text-slate-500">
                        {text}
                      </p>

                      <span className="mt-3 inline-block text-[10px] font-black uppercase tracking-wider text-blue-700">
                        Open →
                      </span>

                    </Link>
                  ))}

                </div>

              </div>


              {/* Safety Overview */}
              <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">

                <div className="flex items-center justify-between border-b border-slate-100 p-5">

                  <div className="flex items-center gap-2">

                    <Activity
                      size={17}
                      className="text-blue-600"
                    />

                    <div>
                      <h2 className="text-sm font-black text-slate-900">
                        Safety Overview
                      </h2>

                      <p className="text-[11px] text-slate-500">
                        Current site compliance status
                      </p>
                    </div>

                  </div>

                  <span className="text-[10px] font-bold text-slate-400">
                    AUTO REFRESH 5s
                  </span>

                </div>


                <div className="grid gap-5 p-5 md:grid-cols-2">

                  <div>

                    <div className="mb-2 flex justify-between text-xs font-bold">

                      <span className="text-slate-500">
                        PPE compliance
                      </span>

                      <span>
                        {stats.compliance_pct || '0%'}
                      </span>

                    </div>

                    <div className="h-3 overflow-hidden rounded-full bg-slate-100">

                      <div
                        className="h-full rounded-full bg-emerald-500 transition-all"
                        style={{
                          width: `${compliance}%`,
                        }}
                      />

                    </div>

                  </div>


                  <div className="grid grid-cols-2 gap-3">

                    <div className="rounded-xl bg-slate-50 p-3">

                      <p className="text-[10px] text-slate-500">
                        Active violations
                      </p>

                      <p className="mt-1 text-xl font-black text-amber-600">
                        {stats.violations ?? 0}
                      </p>

                    </div>


                    <div className="rounded-xl bg-slate-50 p-3">

                      <p className="text-[10px] text-slate-500">
                        Active hazards
                      </p>

                      <p className="mt-1 text-xl font-black text-rose-600">
                        {stats.hazards ?? 0}
                      </p>

                    </div>

                  </div>

                </div>

              </div>

            </section>


            {/* Right-side violation panel */}
            <aside className="h-fit overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm xl:sticky xl:top-24">

              <div className="border-b border-slate-100 bg-slate-950 p-5 text-white">

                <div className="flex items-center justify-between">

                  <div className="flex items-center gap-2">

                    <Bell
                      size={17}
                      className="text-amber-400"
                    />

                    <div>

                      <h2 className="text-sm font-black">
                        Live Violations
                      </h2>

                      <p className="text-[10px] text-slate-400">
                        Latest safety incidents
                      </p>

                    </div>

                  </div>

                  <span className="rounded-full bg-rose-500/15 px-2.5 py-1 text-[10px] font-black text-rose-300">
                    {violations.length} ACTIVE
                  </span>

                </div>

              </div>


              <div className="max-h-[610px] overflow-y-auto p-3 custom-scroll">

                {violations.length === 0 ? (

                  <div className="rounded-xl border border-dashed border-slate-200 p-8 text-center">

                    <ShieldCheck
                      size={28}
                      className="mx-auto text-emerald-500"
                    />

                    <p className="mt-3 text-xs font-black text-slate-700">
                      No violations recorded
                    </p>

                    <p className="mt-1 text-[10px] leading-relaxed text-slate-400">
                      The system is ready to display confirmed PPE
                      and hazard incidents here.
                    </p>

                  </div>

                ) : (

                  <div className="space-y-2">

                    {violations.map((item, index) => {

                      const critical =
                        item.severity === 'CRITICAL' ||
                        String(item.type).includes('FIRE');

                      return (
                        <div
                          key={item.id || index}
                          className={`rounded-xl border p-3 ${
                            critical
                              ? 'border-rose-200 bg-rose-50'
                              : 'border-amber-200 bg-amber-50/60'
                          }`}
                        >

                          <div className="flex items-start gap-3">

                            <div
                              className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${
                                critical
                                  ? 'bg-rose-100 text-rose-600'
                                  : 'bg-amber-100 text-amber-600'
                              }`}
                            >

                              {critical ? (
                                <Flame size={16} />
                              ) : (
                                <AlertTriangle size={16} />
                              )}

                            </div>


                            <div className="min-w-0 flex-1">

                              <div className="flex items-start justify-between gap-2">

                                <p className="truncate text-xs font-black text-slate-900">
                                  {item.type || 'PPE Violation'}
                                </p>

                                <span
                                  className={`shrink-0 text-[9px] font-black uppercase ${
                                    critical
                                      ? 'text-rose-600'
                                      : 'text-amber-700'
                                  }`}
                                >
                                  {item.severity || 'HIGH'}
                                </span>

                              </div>


                              <p className="mt-1 text-[10px] leading-relaxed text-slate-600">
                                {item.message ||
                                  'Safety violation detected.'}
                              </p>


                              <div className="mt-2 flex items-center gap-1 text-[9px] font-semibold text-slate-400">

                                <Clock3 size={11} />

                                {item.timestamp || 'Recent'}

                              </div>

                            </div>

                          </div>

                        </div>
                      );
                    })}

                  </div>

                )}

              </div>


              <div className="border-t border-slate-100 p-3">

                <Link
                  to="/incident-archive"
                  className="flex w-full items-center justify-center rounded-xl bg-slate-900 px-4 py-3 text-[10px] font-black uppercase tracking-wider text-white hover:bg-slate-800"
                >
                  View All Violations
                </Link>

              </div>

            </aside>

          </div>

        </div>

      </main>

    </div>
  );
}