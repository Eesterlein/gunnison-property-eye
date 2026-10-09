/**
 * InspectionLog — Phase 5
 *
 * Table of all flagged parcels, sortable and filterable by status.
 * Staff can bulk-review flags or click through to ParcelDetail.
 */
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import api from "../api";
import { DEMO, FLAGS_LABEL } from "../demo";

const STATUS_COLORS = {
  pending: "bg-amber-100 text-amber-800",
  confirmed: "bg-red-100 text-red-800",
  dismissed: "bg-slate-100 text-slate-600",
  investigated: "bg-green-100 text-green-800",
};

function toCsv(flags) {
  const header = ["APN", "Address", ...(DEMO ? [] : ["Owner", "Vacant on books"]), "Built change", "NDBI Delta", "Confidence", "Status", "Flagged"];
  const rows = flags.map((f) => [
    f.parcel?.apn ?? "",
    f.parcel?.situs_address ?? "",
    ...(DEMO ? [] : [f.parcel?.owner_name ?? ""]),
    ...(DEMO ? [] : [f.parcel?.improvements_value === 0 ? "yes" : "no"]),
    f.detection?.built_local_delta ?? "",
    f.detection?.ndbi_delta ?? "",
    f.detection?.confidence_score != null ? Math.round(f.detection.confidence_score * 100) : "",
    f.status,
    new Date(f.created_at).toLocaleDateString(),
  ]);
  return [header, ...rows]
    .map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(","))
    .join("\n");
}

export default function InspectionLog() {
  const [flags, setFlags] = useState([]);
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [updatingId, setUpdatingId] = useState(null);

  useEffect(() => {
    loadFlags();
  }, [status]);

  async function loadFlags() {
    setLoading(true);
    setError("");
    try {
      const res = await api.get("/api/flags/", { params: status ? { status } : {} });
      setFlags(res.data.flags);
    } catch (e) {
      console.error("Failed to load flags", e);
      setError("Failed to load flagged parcels.");
    } finally {
      setLoading(false);
    }
  }

  async function updateStatus(flagId, newStatus) {
    setUpdatingId(flagId);
    try {
      const res = await api.patch(`/api/flags/${flagId}`, { status: newStatus });
      setFlags((prev) => prev.map((f) => (f.id === flagId ? { ...f, ...res.data } : f)));
    } catch (e) {
      console.error("Failed to update flag", e);
    } finally {
      setUpdatingId(null);
    }
  }

  function exportCsv() {
    const blob = new Blob([toCsv(flags)], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `flagged-parcels-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-semibold text-slate-800">{FLAGS_LABEL}</h1>
        <div className="flex gap-2">
          <select
            className="border border-slate-300 rounded px-2 py-1.5 text-sm"
            value={status}
            onChange={(e) => setStatus(e.target.value)}
          >
            <option value="">All statuses</option>
            <option value="pending">Pending</option>
            <option value="confirmed">Confirmed</option>
            <option value="dismissed">Dismissed</option>
            <option value="investigated">Investigated</option>
          </select>
          <button
            className="px-3 py-1.5 text-sm border border-slate-300 rounded text-slate-600 hover:bg-slate-50 disabled:opacity-50"
            onClick={exportCsv}
            disabled={flags.length === 0}
          >
            Export CSV
          </button>
        </div>
      </div>

      {loading ? (
        <div className="text-center text-slate-500 py-10">Loading…</div>
      ) : error ? (
        <div className="bg-red-50 text-red-700 rounded p-4 text-sm">{error}</div>
      ) : flags.length === 0 ? (
        <div className="bg-slate-100 rounded p-10 text-center text-slate-500">
          <p className="font-medium">No flagged parcels{status ? ` with status "${status}"` : ""}</p>
          <p className="text-sm mt-1">Flags are created automatically after a detection scan runs.</p>
        </div>
      ) : (
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="bg-slate-50 border-b border-slate-200">
              <th className="text-left px-3 py-2 font-medium text-slate-600">APN</th>
              <th className="text-left px-3 py-2 font-medium text-slate-600">Address</th>
              {!DEMO && <th className="text-left px-3 py-2 font-medium text-slate-600">Owner</th>}
              <th className="text-left px-3 py-2 font-medium text-slate-600" title="Parcel-specific change in the probability that the land is built-up, after subtracting change in the surrounding area">Built change</th>
              <th className="text-left px-3 py-2 font-medium text-slate-600">NDBI Delta</th>
              <th className="text-left px-3 py-2 font-medium text-slate-600">Confidence</th>
              <th className="text-left px-3 py-2 font-medium text-slate-600">Status</th>
              <th className="text-left px-3 py-2 font-medium text-slate-600">Flagged</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {flags.map((flag) => (
              <tr key={flag.id} className="border-b border-slate-100 hover:bg-slate-50">
                <td className="px-3 py-2 font-mono text-xs">{flag.parcel?.apn}</td>
                <td className="px-3 py-2">
                  {flag.parcel?.situs_address}
                  {!DEMO && flag.parcel?.improvements_value === 0 && (
                    <span
                      className="ml-2 text-[10px] font-medium bg-red-100 text-red-700 rounded px-1.5 py-0.5 whitespace-nowrap"
                      title="Assessor carries $0 in improvements on this parcel"
                    >
                      Vacant on books
                    </span>
                  )}
                </td>
                {!DEMO && <td className="px-3 py-2">{flag.parcel?.owner_name}</td>}
                <td className="px-3 py-2">
                  {flag.detection?.built_local_delta != null
                    ? `+${(flag.detection.built_local_delta * 100).toFixed(0)} pts`
                    : "—"}
                </td>
                <td className="px-3 py-2">{flag.detection?.ndbi_delta?.toFixed(3)}</td>
                <td className="px-3 py-2">
                  {flag.detection?.confidence_score != null
                    ? `${(flag.detection.confidence_score * 100).toFixed(0)}%`
                    : "—"}
                </td>
                <td className="px-3 py-2">
                  <span className={`text-xs px-2 py-0.5 rounded-full ${STATUS_COLORS[flag.status]}`}>
                    {flag.status}
                  </span>
                </td>
                <td className="px-3 py-2 text-slate-500">
                  {new Date(flag.created_at).toLocaleDateString()}
                </td>
                <td className="px-3 py-2">
                  <div className="flex items-center gap-2">
                    {!DEMO && flag.status === "pending" && (
                      <>
                        <button
                          className="text-xs text-green-700 hover:underline disabled:opacity-50"
                          disabled={updatingId === flag.id}
                          onClick={() => updateStatus(flag.id, "confirmed")}
                        >
                          Confirm
                        </button>
                        <button
                          className="text-xs text-slate-500 hover:underline disabled:opacity-50"
                          disabled={updatingId === flag.id}
                          onClick={() => updateStatus(flag.id, "dismissed")}
                        >
                          Dismiss
                        </button>
                      </>
                    )}
                    <Link
                      to={`/parcels/${flag.parcel_id}`}
                      className="text-blue-600 hover:underline text-xs"
                    >
                      Review
                    </Link>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
