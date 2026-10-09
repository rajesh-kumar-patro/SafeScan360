import React, { useEffect, useState } from 'react';

export default function IncidentArchive() {
  const [incidents, setIncidents] = useState([]);
  const [loading, setLoading] = useState(true);

  const fetchIncidents = async () => {
    try {
      const res = await fetch('/api/incidents');
      const data = await res.json();
      setIncidents(data.incidents || []);
    } catch (error) {
      setIncidents([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchIncidents();
    const timer = setInterval(fetchIncidents, 15000);
    return () => clearInterval(timer);
  }, []);

  const sourceCounts = ['image', 'live', 'video'].reduce((acc, source) => {
    acc[source] = incidents.filter((incident) => incident.source === source).length;
    return acc;
  }, {});

  const handleDelete = async (incidentId) => {
    try {
      const res = await fetch(`/api/incidents/${incidentId}`, { method: 'DELETE' });
      const data = await res.json();
      if (data.status === 'deleted') {
        setIncidents((prev) => prev.filter((incident) => incident.id !== incidentId));
      }
    } catch (error) {
      console.error('Delete failed', error);
    }
  };

  return (
    <div className="max-w-7xl mx-auto p-6 flex-1 w-full space-y-6">
      <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-5">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-blue-600">Safety archive</p>
            <h2 className="text-2xl font-black text-slate-800 mt-1">Incident screenshots and alerts</h2>
          </div>
          <span className="px-3 py-1 rounded-full border border-slate-200 bg-slate-50 text-[10px] font-bold uppercase tracking-[0.18em] text-slate-600">
            {incidents.length} captured
          </span>
        </div>

        <div className="mt-4 grid grid-cols-1 sm:grid-cols-3 gap-3">
          {['image', 'live', 'video'].map((source) => (
            <div key={source} className="rounded-xl border border-slate-200 bg-slate-50 p-3">
              <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-500">{source}</p>
              <div className="mt-1 text-xl font-black text-slate-800">{sourceCounts[source] || 0}</div>
            </div>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-5 text-sm text-slate-500">Loading incidents...</div>
      ) : incidents.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-10 text-center text-slate-500 text-sm">
          No detected incidents have been stored yet.
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {incidents.map((incident) => (
            <div key={incident.id} className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
              <div className="p-4 border-b border-slate-200 bg-slate-50">
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-500">{incident.source}</p>
                    <h3 className="text-lg font-extrabold text-slate-800 mt-1">{incident.type}</h3>
                  </div>
                  <span className={`px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-[0.12em] ${
                    incident.severity === 'CRITICAL'
                      ? 'bg-rose-100 text-rose-700 border border-rose-200'
                      : incident.severity === 'HIGH'
                        ? 'bg-amber-100 text-amber-700 border border-amber-200'
                        : 'bg-emerald-100 text-emerald-700 border border-emerald-200'
                  }`}>
                    {incident.severity}
                  </span>
                </div>
              </div>

              {incident.screenshot_url ? (
                <img src={incident.screenshot_url} alt={incident.message} className="w-full h-72 object-cover border-b border-slate-200" />
              ) : (
                <div className="h-72 flex items-center justify-center bg-slate-100 text-sm text-slate-500">No screenshot attached</div>
              )}

              <div className="p-4 space-y-3">
                <p className="text-sm font-semibold text-slate-700">{incident.message}</p>
                <div className="text-[11px] text-slate-500 space-y-1">
                  <div><span className="font-bold text-slate-600">Time:</span> {incident.timestamp}</div>
                  <div><span className="font-bold text-slate-600">Details:</span> {JSON.stringify(incident.details || {})}</div>
                </div>

                <div className="flex items-center gap-3 pt-2">
                  {incident.screenshot_url && (
                    <a
                      href={incident.screenshot_url}
                      download
                      className="inline-flex items-center justify-center px-3 py-2 text-[10px] font-bold uppercase tracking-[0.14em] text-blue-700 bg-blue-50 border border-blue-200 rounded-lg"
                    >
                      Download
                    </a>
                  )}
                  <button
                    onClick={() => handleDelete(incident.id)}
                    className="inline-flex items-center justify-center px-3 py-2 text-[10px] font-bold uppercase tracking-[0.14em] text-rose-700 bg-rose-50 border border-rose-200 rounded-lg"
                  >
                    Delete
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
