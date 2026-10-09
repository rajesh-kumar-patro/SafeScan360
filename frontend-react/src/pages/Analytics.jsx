
import React, { useEffect, useMemo, useState } from 'react';
import {
  BarChart3,
  TrendingUp,
  TrendingDown,
  AlertTriangle,
  Flame,
  CloudFog,
  ShieldCheck,
  RefreshCw,
  CalendarDays,
  Activity,
} from 'lucide-react';

import {
  ResponsiveContainer,
  LineChart,
  Line,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from 'recharts';

const RANGE_OPTIONS = [
  { label: 'Today', value: 1 },
  { label: '7 Days', value: 7 },
  { label: '30 Days', value: 30 },
];

const COLORS = [
  '#2563eb',
  '#f59e0b',
  '#ef4444',
  '#10b981',
  '#8b5cf6',
  '#06b6d4',
  '#ec4899',
  '#f97316',
];

function formatDate(date) {
  return date.toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
  });
}

function getDateKey(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');

  return `${year}-${month}-${day}`;
}

function normalizeDate(value) {
  if (!value) return null;

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return date;
}

function getIncidentType(item) {
  const type = String(item?.type || '').toUpperCase();
  const message = String(item?.message || '').toUpperCase();

  if (type.includes('FIRE') || message.includes('FIRE')) {
    return 'Fire';
  }

  if (type.includes('SMOKE') || message.includes('SMOKE')) {
    return 'Smoke';
  }

  if (
    type.includes('HELMET') ||
    message.includes('HELMET')
  ) {
    return 'No Helmet';
  }

  if (
    type.includes('BOOT') ||
    type.includes('SHOE') ||
    message.includes('BOOT') ||
    message.includes('SHOE')
  ) {
    return 'No Boots';
  }

  if (
    type.includes('GLOVE') ||
    message.includes('GLOVE')
  ) {
    return 'No Gloves';
  }

  if (
    type.includes('VEST') ||
    message.includes('VEST')
  ) {
    return 'No Vest';
  }

  if (
    type.includes('GOGGLE') ||
    type.includes('EYE') ||
    message.includes('GOGGLE') ||
    message.includes('EYE')
  ) {
    return 'No Goggles';
  }

  if (
    type.includes('PPE') ||
    type.includes('VIOLATION') ||
    message.includes('VIOLATION')
  ) {
    return 'PPE Violation';
  }

  return type || 'Other';
}

function getSeverity(item) {
  const severity = String(item?.severity || '').toUpperCase();

  if (severity.includes('CRITICAL')) return 'Critical';
  if (severity.includes('HIGH')) return 'High';
  if (severity.includes('MEDIUM')) return 'Medium';

  return 'Low';
}

function isViolation(item) {
  const type = String(item?.type || '').toUpperCase();

  return (
    type !== 'COMPLIANCE_OK' &&
    type !== 'OK' &&
    type !== 'COMPLIANT'
  );
}

export default function Analytics() {
  const [incidents, setIncidents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedRange, setSelectedRange] = useState(7);
  const [error, setError] = useState('');

  const loadAnalytics = async () => {
    try {
      setLoading(true);
      setError('');

      const response = await fetch('/api/incidents');

      if (!response.ok) {
        throw new Error('Unable to load incident data');
      }

      const data = await response.json();

      setIncidents(
        Array.isArray(data)
          ? data
          : data.incidents || []
      );
    } catch (err) {
      setError(err.message || 'Failed to load analytics');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadAnalytics();

    const timer = setInterval(loadAnalytics, 10000);

    return () => clearInterval(timer);
  }, []);

  /*
   * Filter incidents according to selected period.
   */
  const filteredIncidents = useMemo(() => {
    const now = new Date();

    const start = new Date(now);
    start.setHours(0, 0, 0, 0);
    start.setDate(start.getDate() - (selectedRange - 1));

    return incidents.filter((item) => {
      const date = normalizeDate(item.timestamp);

      if (!date) return false;

      return date >= start && date <= now;
    });
  }, [incidents, selectedRange]);

  /*
   * Daily violations.
   */
  const dailyData = useMemo(() => {
    const today = new Date();
    const days = [];

    for (let i = selectedRange - 1; i >= 0; i--) {
      const date = new Date(today);

      date.setHours(0, 0, 0, 0);
      date.setDate(date.getDate() - i);

      days.push({
        key: getDateKey(date),
        date: formatDate(date),
        violations: 0,
        fire: 0,
        smoke: 0,
        compliance: 0,
      });
    }

    const map = new Map(
      days.map((item) => [item.key, item])
    );

    filteredIncidents.forEach((incident) => {
      if (!isViolation(incident)) return;

      const date = normalizeDate(incident.timestamp);

      if (!date) return;

      const key = getDateKey(date);
      const day = map.get(key);

      if (!day) return;

      day.violations += 1;

      const type = getIncidentType(incident);

      if (type === 'Fire') {
        day.fire += 1;
      }

      if (type === 'Smoke') {
        day.smoke += 1;
      }
    });

    /*
     * Compliance is calculated from violation count.
     * If worker totals are unavailable, we don't invent
     * worker numbers.
     */
    days.forEach((day) => {
      day.compliance = 0;
    });

    return days;
  }, [filteredIncidents, selectedRange]);

  /*
   * Violation type distribution.
   */
  const violationTypeData = useMemo(() => {
    const counts = {};

    filteredIncidents.forEach((incident) => {
      if (!isViolation(incident)) return;

      const type = getIncidentType(incident);

      counts[type] = (counts[type] || 0) + 1;
    });

    return Object.entries(counts)
      .map(([name, value]) => ({
        name,
        value,
      }))
      .sort((a, b) => b.value - a.value);
  }, [filteredIncidents]);

  /*
   * Severity distribution.
   */
  const severityData = useMemo(() => {
    const counts = {
      Critical: 0,
      High: 0,
      Medium: 0,
      Low: 0,
    };

    filteredIncidents.forEach((incident) => {
      if (!isViolation(incident)) return;

      counts[getSeverity(incident)] += 1;
    });

    return Object.entries(counts)
      .filter(([, value]) => value > 0)
      .map(([name, value]) => ({
        name,
        value,
      }));
  }, [filteredIncidents]);

  /*
   * Fire vs Smoke.
   */
  const hazardData = useMemo(() => {
    return dailyData.map((day) => ({
      date: day.date,
      Fire: day.fire,
      Smoke: day.smoke,
    }));
  }, [dailyData]);

  /*
   * Summary.
   */
  const summary = useMemo(() => {
    const totalViolations = filteredIncidents.filter(isViolation).length;

    const fire = filteredIncidents.filter(
      (item) => getIncidentType(item) === 'Fire'
    ).length;

    const smoke = filteredIncidents.filter(
      (item) => getIncidentType(item) === 'Smoke'
    ).length;

    const typeCounts = {};

    filteredIncidents
      .filter(isViolation)
      .forEach((item) => {
        const type = getIncidentType(item);

        typeCounts[type] = (typeCounts[type] || 0) + 1;
      });

    let mostFrequent = 'None';

    Object.entries(typeCounts).forEach(
      ([type, count]) => {
        if (
          mostFrequent === 'None' ||
          count > typeCounts[mostFrequent]
        ) {
          mostFrequent = type;
        }
      }
    );

    const highestDay = dailyData.reduce(
      (highest, current) => {
        if (current.violations > highest.violations) {
          return current;
        }

        return highest;
      },
      {
        date: 'None',
        violations: 0,
      }
    );

    return {
      totalViolations,
      fire,
      smoke,
      mostFrequent,
      highestDay,
    };
  }, [filteredIncidents, dailyData]);

  /*
   * Increase/decrease compared with previous half
   * of selected period.
   */
  const trend = useMemo(() => {
    if (dailyData.length < 2) {
      return {
        current: 0,
        previous: 0,
        percentage: 0,
      };
    }

    const midpoint = Math.floor(dailyData.length / 2);

    const firstHalf = dailyData
      .slice(0, midpoint)
      .reduce(
        (sum, item) => sum + item.violations,
        0
      );

    const secondHalf = dailyData
      .slice(midpoint)
      .reduce(
        (sum, item) => sum + item.violations,
        0
      );

    if (firstHalf === 0) {
      return {
        current: secondHalf,
        previous: firstHalf,
        percentage: secondHalf > 0 ? 100 : 0,
      };
    }

    const percentage =
      ((secondHalf - firstHalf) / firstHalf) * 100;

    return {
      current: secondHalf,
      previous: firstHalf,
      percentage,
    };
  }, [dailyData]);

  const increasing = trend.percentage > 0;

  return (
    <div className="min-h-screen bg-slate-100 p-4 sm:p-6 lg:p-8">
      <div className="mx-auto max-w-[1500px]">

        {/* Header */}
        <div className="mb-6 flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">

          <div>
            <div className="flex items-center gap-2">
              <BarChart3
                size={22}
                className="text-blue-600"
              />

              <p className="text-[10px] font-black uppercase tracking-[0.2em] text-blue-600">
                Safety Intelligence
              </p>
            </div>

            <h1 className="mt-1 text-2xl font-black text-slate-950 sm:text-3xl">
              Safety Analytics
            </h1>

            <p className="mt-1 text-xs text-slate-500">
              Analyze violation trends, hazards and safety incidents.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">

            <div className="flex items-center gap-1 rounded-xl border border-slate-200 bg-white p-1 shadow-sm">

              {RANGE_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() =>
                    setSelectedRange(option.value)
                  }
                  className={`rounded-lg px-3 py-2 text-[10px] font-black transition ${
                    selectedRange === option.value
                      ? 'bg-blue-600 text-white'
                      : 'text-slate-600 hover:bg-slate-100'
                  }`}
                >
                  {option.label}
                </button>
              ))}

            </div>

            <button
              type="button"
              onClick={loadAnalytics}
              className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-xs font-black text-slate-700 shadow-sm hover:bg-slate-50"
            >
              <RefreshCw
                size={14}
                className={
                  loading ? 'animate-spin' : ''
                }
              />

              Refresh
            </button>

          </div>
        </div>

        {/* Error */}
        {error && (
          <div className="mb-5 rounded-xl border border-rose-200 bg-rose-50 p-4 text-xs font-bold text-rose-700">
            {error}
          </div>
        )}

        {/* Summary Cards */}
        <section className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-5">

          <SummaryCard
            title="Total Violations"
            value={summary.totalViolations}
            icon={AlertTriangle}
            iconClass="bg-amber-50 text-amber-600"
          />

          <SummaryCard
            title="Fire Events"
            value={summary.fire}
            icon={Flame}
            iconClass="bg-rose-50 text-rose-600"
          />

          <SummaryCard
            title="Smoke Events"
            value={summary.smoke}
            icon={CloudFog}
            iconClass="bg-orange-50 text-orange-600"
          />

          <SummaryCard
            title="Most Frequent"
            value={summary.mostFrequent}
            icon={Activity}
            iconClass="bg-blue-50 text-blue-600"
            smallValue
          />

          <SummaryCard
            title="Highest Violation Day"
            value={
              summary.highestDay.violations > 0
                ? `${summary.highestDay.date} (${summary.highestDay.violations})`
                : 'None'
            }
            icon={CalendarDays}
            iconClass="bg-violet-50 text-violet-600"
            smallValue
          />

        </section>

        {/* Trend Card */}
        <section className="mb-6 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">

          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">

            <div className="flex items-center gap-3">

              <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-blue-50 text-blue-600">
                {increasing ? (
                  <TrendingUp size={20} />
                ) : (
                  <TrendingDown size={20} />
                )}
              </div>

              <div>
                <p className="text-[10px] font-black uppercase tracking-[0.15em] text-slate-400">
                  Violation Trend
                </p>

                <h2 className="mt-1 text-lg font-black text-slate-900">
                  {increasing
                    ? 'Violations are increasing'
                    : 'Violations are decreasing'}
                </h2>
              </div>

            </div>

            <div
              className={`rounded-xl px-4 py-2 text-sm font-black ${
                increasing
                  ? 'bg-rose-50 text-rose-600'
                  : 'bg-emerald-50 text-emerald-600'
              }`}
            >
              {trend.percentage > 0 ? '+' : ''}
              {trend.percentage.toFixed(1)}%
            </div>

          </div>

          <div className="mt-5 h-[300px]">

            <ResponsiveContainer
              width="100%"
              height="100%"
            >
              <LineChart data={dailyData}>

                <CartesianGrid
                  strokeDasharray="3 3"
                  vertical={false}
                />

                <XAxis
                  dataKey="date"
                  tick={{ fontSize: 11 }}
                />

                <YAxis
                  allowDecimals={false}
                  tick={{ fontSize: 11 }}
                />

                <Tooltip />

                <Line
                  type="monotone"
                  dataKey="violations"
                  name="Violations"
                  stroke="#2563eb"
                  strokeWidth={3}
                  dot={{ r: 4 }}
                  activeDot={{ r: 6 }}
                />

              </LineChart>
            </ResponsiveContainer>

          </div>

        </section>

        {/* Charts Grid */}
        <section className="grid grid-cols-1 gap-5 xl:grid-cols-2">

          {/* Daily Bar */}
          <ChartCard
            title="Violations Per Day"
            description="Number of confirmed incidents recorded each day."
          >

            <ResponsiveContainer
              width="100%"
              height="100%"
            >
              <BarChart data={dailyData}>

                <CartesianGrid
                  strokeDasharray="3 3"
                  vertical={false}
                />

                <XAxis
                  dataKey="date"
                  tick={{ fontSize: 10 }}
                />

                <YAxis
                  allowDecimals={false}
                  tick={{ fontSize: 10 }}
                />

                <Tooltip />

                <Bar
                  dataKey="violations"
                  name="Violations"
                  fill="#f59e0b"
                  radius={[6, 6, 0, 0]}
                />

              </BarChart>
            </ResponsiveContainer>

          </ChartCard>

          {/* Violation Pie */}
          <ChartCard
            title="Violation Type Distribution"
            description="Breakdown of confirmed violation categories."
          >

            {violationTypeData.length === 0 ? (
              <EmptyChart />
            ) : (
              <ResponsiveContainer
                width="100%"
                height="100%"
              >
                <PieChart>

                  <Pie
                    data={violationTypeData}
                    dataKey="value"
                    nameKey="name"
                    cx="50%"
                    cy="50%"
                    outerRadius={100}
                    label
                  >
                    {violationTypeData.map(
                      (entry, index) => (
                        <Cell
                          key={`cell-${index}`}
                          fill={
                            COLORS[
                              index % COLORS.length
                            ]
                          }
                        />
                      )
                    )}
                  </Pie>

                  <Tooltip />

                  <Legend />

                </PieChart>
              </ResponsiveContainer>
            )}

          </ChartCard>

          {/* Severity Pie */}
          <ChartCard
            title="Severity Distribution"
            description="Incident count grouped by alert severity."
          >

            {severityData.length === 0 ? (
              <EmptyChart />
            ) : (
              <ResponsiveContainer
                width="100%"
                height="100%"
              >
                <PieChart>

                  <Pie
                    data={severityData}
                    dataKey="value"
                    nameKey="name"
                    cx="50%"
                    cy="50%"
                    innerRadius={60}
                    outerRadius={100}
                    label
                  >
                    {severityData.map(
                      (entry, index) => (
                        <Cell
                          key={`severity-${index}`}
                          fill={
                            COLORS[
                              index % COLORS.length
                            ]
                          }
                        />
                      )
                    )}
                  </Pie>

                  <Tooltip />

                  <Legend />

                </PieChart>
              </ResponsiveContainer>
            )}

          </ChartCard>

          {/* Fire Smoke */}
          <ChartCard
            title="Fire vs Smoke Events"
            description="Daily hazard events detected by the Fire/Smoke model."
          >

            <ResponsiveContainer
              width="100%"
              height="100%"
            >
              <BarChart data={hazardData}>

                <CartesianGrid
                  strokeDasharray="3 3"
                  vertical={false}
                />

                <XAxis
                  dataKey="date"
                  tick={{ fontSize: 10 }}
                />

                <YAxis
                  allowDecimals={false}
                  tick={{ fontSize: 10 }}
                />

                <Tooltip />

                <Legend />

                <Bar
                  dataKey="Fire"
                  fill="#ef4444"
                  radius={[5, 5, 0, 0]}
                />

                <Bar
                  dataKey="Smoke"
                  fill="#64748b"
                  radius={[5, 5, 0, 0]}
                />

              </BarChart>
            </ResponsiveContainer>

          </ChartCard>

        </section>

        {/* Compliance Information */}
        <section className="mt-5 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">

          <div className="flex items-center gap-3">

            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600">
              <ShieldCheck size={19} />
            </div>

            <div>
              <h2 className="text-sm font-black text-slate-900">
                Safety Analysis
              </h2>

              <p className="mt-1 text-[11px] text-slate-500">
                Analytics are calculated from recorded incident data.
              </p>
            </div>

          </div>

          <div className="mt-5 grid gap-3 md:grid-cols-3">

            <InfoBox
              label="Analysis Period"
              value={
                selectedRange === 1
                  ? 'Today'
                  : `Last ${selectedRange} days`
              }
            />

            <InfoBox
              label="Recorded Incidents"
              value={filteredIncidents.length}
            />

            <InfoBox
              label="Data Status"
              value={
                loading
                  ? 'Updating...'
                  : 'Live data'
              }
            />

          </div>

        </section>

      </div>
    </div>
  );
}

/*
 * Summary card
 */
function SummaryCard({
  title,
  value,
  icon: Icon,
  iconClass,
  smallValue = false,
}) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">

      <div
        className={`mb-3 flex h-9 w-9 items-center justify-center rounded-xl ${iconClass}`}
      >
        <Icon size={17} />
      </div>

      <p className="text-[10px] font-bold text-slate-500">
        {title}
      </p>

      <p
        className={`mt-1 font-black text-slate-950 ${
          smallValue
            ? 'text-sm leading-5'
            : 'text-2xl'
        }`}
      >
        {value}
      </p>

    </div>
  );
}

/*
 * Chart container
 */
function ChartCard({
  title,
  description,
  children,
}) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">

      <div className="mb-4">

        <h2 className="text-sm font-black text-slate-900">
          {title}
        </h2>

        <p className="mt-1 text-[11px] text-slate-500">
          {description}
        </p>

      </div>

      <div className="h-[320px]">
        {children}
      </div>

    </div>
  );
}

/*
 * Empty chart state
 */
function EmptyChart() {
  return (
    <div className="flex h-full items-center justify-center">

      <div className="text-center">

        <BarChart3
          size={32}
          className="mx-auto text-slate-300"
        />

        <p className="mt-3 text-xs font-black text-slate-500">
          No incident data
        </p>

        <p className="mt-1 text-[10px] text-slate-400">
          Confirmed incidents will appear here.
        </p>

      </div>

    </div>
  );
}

/*
 * Information box
 */
function InfoBox({ label, value }) {
  return (
    <div className="rounded-xl bg-slate-50 p-4">

      <p className="text-[10px] font-bold text-slate-400">
        {label}
      </p>

      <p className="mt-1 text-sm font-black text-slate-900">
        {value}
      </p>

    </div>
  );
}

