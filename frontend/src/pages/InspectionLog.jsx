/**
 * InspectionLog — Phase 5
 *
 * Table of all flagged parcels, sortable and filterable by status.
 * Staff can bulk-review flags or click through to ParcelDetail.
 *
 * TODO Phase 5:
 *  - Fetch from /api/flags with status filter
 *  - Table: APN, address, owner, NDBI delta, confidence, status, date flagged
 *  - Quick action buttons: Confirm / Dismiss without leaving the list
 *  - Export to CSV
 */
import { Link } from "react-router-dom";

const STATUS_COLORS = {
  pending: "bg-amber-100 text-amber-800",
  confirmed: "bg-red-100 text-red-800",
  dismissed: "bg-slate-100 text-slate-600",
  investigated: "bg-green-100 text-green-800",
};

export default function InspectionLog() {
  // TODO Phase 5: replace with real data from /api/flags
  const flags = [];

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-semibold text-slate-800">Flagged Parcels</h1>
        <div className="flex gap-2">
          <select className="border border-slate-300 rounded px-2 py-1.5 text-sm" disabled>
            <option>All statuses</option>
            <option>Pending</option>
            <option>Confirmed</option>
            <option>Dismissed</option>
            <option>Investigated</option>
          </select>
          <button
            className="px-3 py-1.5 text-sm border border-slate-300 rounded text-slate-600 hover:bg-slate-50 disabled:opacity-50"
            disabled
          >
            Export CSV
          </button>
        </div>
      </div>

      {flags.length === 0 ? (
        <div className="bg-slate-100 rounded p-10 text-center text-slate-500">
          <p className="font-medium">No flagged parcels yet</p>
          <p className="text-sm mt-1">
            Flags are created automatically after a detection scan runs — Phase 3.
          </p>
        </div>
      ) : (
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="bg-slate-50 border-b border-slate-200">
              <th className="text-left px-3 py-2 font-medium text-slate-600">APN</th>
              <th className="text-left px-3 py-2 font-medium text-slate-600">Address</th>
              <th className="text-left px-3 py-2 font-medium text-slate-600">Owner</th>
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
                <td className="px-3 py-2">{flag.parcel?.situs_address}</td>
                <td className="px-3 py-2">{flag.parcel?.owner_name}</td>
                <td className="px-3 py-2">{flag.detection?.ndbi_delta?.toFixed(3)}</td>
                <td className="px-3 py-2">{(flag.detection?.confidence_score * 100).toFixed(0)}%</td>
                <td className="px-3 py-2">
                  <span className={`text-xs px-2 py-0.5 rounded-full ${STATUS_COLORS[flag.status]}`}>
                    {flag.status}
                  </span>
                </td>
                <td className="px-3 py-2 text-slate-500">
                  {new Date(flag.created_at).toLocaleDateString()}
                </td>
                <td className="px-3 py-2">
                  <Link
                    to={`/parcels/${flag.parcel_id}`}
                    className="text-blue-600 hover:underline text-xs"
                  >
                    Review
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
