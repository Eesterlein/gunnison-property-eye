import { useParams, Link, useNavigate } from "react-router-dom";
import { useState, useEffect } from "react";
import api from "../api";

export default function ParcelDetail() {
  const { id } = useParams();
  const navigate = useNavigate();

  const [parcel, setParcel] = useState(null);
  const [detections, setDetections] = useState([]);
  const [flags, setFlags] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // Flag review state
  const [reviewingFlag, setReviewingFlag] = useState(null); // flag id
  const [reviewNotes, setReviewNotes] = useState("");
  const [reviewLoading, setReviewLoading] = useState(false);

  useEffect(() => {
    loadAll();
  }, [id]);

  async function loadAll() {
    setLoading(true);
    setError("");
    try {
      const [parcelRes, detRes, flagRes] = await Promise.all([
        api.get(`/api/parcels/${id}`),
        api.get(`/api/detections/?parcel_id=${id}&limit=10`),
        api.get(`/api/flags/?parcel_id=${id}&limit=20`),
      ]);
      setParcel(parcelRes.data);
      setDetections(detRes.data.detections || []);
      setFlags(flagRes.data.flags || []);
    } catch (err) {
      if (err.response?.status === 404) setError("Parcel not found");
      else setError("Failed to load parcel data");
    } finally {
      setLoading(false);
    }
  }

  async function handleReview(flagId, status) {
    setReviewLoading(true);
    try {
      const res = await api.patch(`/api/flags/${flagId}`, {
        status,
        notes: reviewNotes || null,
      });
      setFlags((prev) =>
        prev.map((f) => (f.id === flagId ? res.data : f))
      );
      setReviewingFlag(null);
      setReviewNotes("");
    } catch {
      // keep form open on error
    } finally {
      setReviewLoading(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full text-slate-400 text-sm">
        Loading…
      </div>
    );
  }

  if (error) {
    return (
      <div className="max-w-2xl mx-auto p-6">
        <Link to="/map" className="text-sm text-blue-600 hover:underline mb-4 block">
          ← Back to map
        </Link>
        <p className="text-red-600">{error}</p>
      </div>
    );
  }

  const pendingFlags = flags.filter((f) => f.status === "pending");

  return (
    <div className="max-w-3xl mx-auto p-6 space-y-6 overflow-y-auto h-full">
      <Link to="/map" className="text-sm text-blue-600 hover:underline block">
        ← Back to map
      </Link>

      {/* Parcel header */}
      <div className="bg-white border border-slate-200 rounded-lg p-5 space-y-1">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-lg font-semibold text-slate-800">
              {parcel.situs_address || "No address on file"}
            </h1>
            <p className="text-sm text-slate-500">APN: {parcel.apn}</p>
          </div>
          {pendingFlags.length > 0 && (
            <span className="bg-orange-100 text-orange-700 border border-orange-200 text-xs font-medium rounded px-2 py-1 shrink-0">
              {pendingFlags.length} pending flag{pendingFlags.length !== 1 ? "s" : ""}
            </span>
          )}
        </div>
        <div className="grid grid-cols-2 gap-x-6 gap-y-1 mt-3 text-sm text-slate-600">
          <p><span className="text-slate-400">Owner:</span> {parcel.owner_name || "—"}</p>
          <p><span className="text-slate-400">Jurisdiction:</span> {parcel.jurisdiction || "—"}</p>
          <p><span className="text-slate-400">Acres:</span> {parcel.acres ?? "—"}</p>
          <p><span className="text-slate-400">Land use:</span> {parcel.land_use_code || "—"}</p>
          {parcel.last_scan_date && (
            <p><span className="text-slate-400">Last scan:</span> {new Date(parcel.last_scan_date).toLocaleDateString()}</p>
          )}
        </div>
      </div>

      {/* Flags for review */}
      {flags.length > 0 && (
        <div>
          <h2 className="font-semibold text-slate-700 mb-3">Flags</h2>
          <div className="space-y-3">
            {flags.map((flag) => (
              <div
                key={flag.id}
                className={`border rounded-lg p-4 text-sm space-y-2 ${
                  flag.status === "pending"
                    ? "border-orange-200 bg-orange-50"
                    : flag.status === "confirmed"
                    ? "border-red-200 bg-red-50"
                    : "border-slate-200 bg-slate-50"
                }`}
              >
                <div className="flex items-center justify-between">
                  <span
                    className={`capitalize font-medium ${
                      flag.status === "pending"
                        ? "text-orange-700"
                        : flag.status === "confirmed"
                        ? "text-red-700"
                        : "text-slate-500"
                    }`}
                  >
                    {flag.status}
                  </span>
                  <span className="text-xs text-slate-400">
                    {new Date(flag.created_at).toLocaleDateString()}
                  </span>
                </div>

                {flag.reviewed_by && (
                  <p className="text-xs text-slate-500">
                    Reviewed by {flag.reviewed_by}
                    {flag.reviewed_at && ` on ${new Date(flag.reviewed_at).toLocaleDateString()}`}
                  </p>
                )}
                {flag.notes && (
                  <p className="text-slate-600 italic text-xs">"{flag.notes}"</p>
                )}

                {/* Review form */}
                {flag.status === "pending" && (
                  <>
                    {reviewingFlag === flag.id ? (
                      <div className="pt-2 space-y-2 border-t border-orange-200">
                        <textarea
                          value={reviewNotes}
                          onChange={(e) => setReviewNotes(e.target.value)}
                          placeholder="Optional notes…"
                          rows={2}
                          className="w-full border border-slate-300 rounded px-2 py-1.5 text-sm resize-none"
                        />
                        <div className="flex gap-2">
                          <button
                            disabled={reviewLoading}
                            onClick={() => handleReview(flag.id, "confirmed")}
                            className="flex-1 bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white rounded px-3 py-1.5 text-xs font-medium"
                          >
                            Confirm change
                          </button>
                          <button
                            disabled={reviewLoading}
                            onClick={() => handleReview(flag.id, "dismissed")}
                            className="flex-1 bg-slate-200 hover:bg-slate-300 disabled:opacity-50 text-slate-700 rounded px-3 py-1.5 text-xs font-medium"
                          >
                            Dismiss
                          </button>
                          <button
                            onClick={() => {
                              setReviewingFlag(null);
                              setReviewNotes("");
                            }}
                            className="px-2 text-slate-400 hover:text-slate-600 text-xs"
                          >
                            ✕
                          </button>
                        </div>
                      </div>
                    ) : (
                      <button
                        onClick={() => setReviewingFlag(flag.id)}
                        className="text-xs text-orange-700 hover:text-orange-900 font-medium underline"
                      >
                        Review this flag
                      </button>
                    )}
                  </>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Detection history */}
      {detections.length > 0 && (
        <div>
          <h2 className="font-semibold text-slate-700 mb-3">Detection History</h2>
          <div className="space-y-3">
            {detections.map((d) => (
              <div
                key={d.id}
                className={`border rounded-lg p-4 text-sm ${
                  d.flagged ? "border-orange-200 bg-orange-50" : "border-slate-200"
                }`}
              >
                <div className="flex items-center justify-between mb-2">
                  <span className="font-medium text-slate-700">
                    Scan #{d.scan_id}
                  </span>
                  {d.flagged && (
                    <span className="text-xs bg-orange-500 text-white rounded px-2 py-0.5 font-medium">
                      Flagged
                    </span>
                  )}
                </div>
                <div className="grid grid-cols-3 gap-2 text-xs text-slate-600">
                  <div>
                    <p className="text-slate-400 mb-0.5">NDBI before</p>
                    <p className="font-mono">{d.ndbi_before ?? "—"}</p>
                  </div>
                  <div>
                    <p className="text-slate-400 mb-0.5">NDBI after</p>
                    <p className="font-mono">{d.ndbi_after ?? "—"}</p>
                  </div>
                  <div>
                    <p className="text-slate-400 mb-0.5">Delta</p>
                    <p
                      className={`font-mono font-semibold ${
                        d.ndbi_delta > 0.15
                          ? "text-red-600"
                          : d.ndbi_delta > 0
                          ? "text-amber-600"
                          : "text-slate-600"
                      }`}
                    >
                      {d.ndbi_delta != null ? `+${d.ndbi_delta}` : "—"}
                    </p>
                  </div>
                  <div>
                    <p className="text-slate-400 mb-0.5">NDVI before</p>
                    <p className="font-mono">{d.ndvi_before ?? "—"}</p>
                  </div>
                  <div>
                    <p className="text-slate-400 mb-0.5">NDVI after</p>
                    <p className="font-mono">{d.ndvi_after ?? "—"}</p>
                  </div>
                  <div>
                    <p className="text-slate-400 mb-0.5">Confidence</p>
                    <p className="font-mono">
                      {d.confidence_score != null
                        ? `${(d.confidence_score * 100).toFixed(0)}%`
                        : "—"}
                    </p>
                  </div>
                  {d.image_date_before && (
                    <div>
                      <p className="text-slate-400 mb-0.5">Image before</p>
                      <p>{new Date(d.image_date_before).toLocaleDateString()}</p>
                    </div>
                  )}
                  {d.image_date_after && (
                    <div>
                      <p className="text-slate-400 mb-0.5">Image after</p>
                      <p>{new Date(d.image_date_after).toLocaleDateString()}</p>
                    </div>
                  )}
                  {d.cloud_coverage_pct != null && (
                    <div>
                      <p className="text-slate-400 mb-0.5">Cloud cover</p>
                      <p>{d.cloud_coverage_pct}%</p>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {flags.length === 0 && detections.length === 0 && (
        <div className="text-center text-slate-400 text-sm py-8">
          No detection data yet for this parcel.
        </div>
      )}
    </div>
  );
}
