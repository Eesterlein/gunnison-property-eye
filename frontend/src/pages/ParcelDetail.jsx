import { useParams, Link, useNavigate } from "react-router-dom";
import { useState, useEffect } from "react";
import api from "../api";

// Plain-language explanations for the detection jargon, shown on hover.
const TERM_INFO = {
  ndbi: "Normalized Difference Built-up Index — a satellite measurement that highlights rooftops, pavement, and other built surfaces. Higher values usually mean more built-up area.",
  delta: "The change in NDBI between the before and after periods. A large positive jump suggests new construction — parcels above the flagging threshold get flagged for review.",
  ndvi: "Normalized Difference Vegetation Index — measures plant/vegetation health. Used as a check: if vegetation increased a lot instead, the NDBI change is probably plant growth, not construction.",
  confidence: "How far the NDBI change exceeded the flagging threshold, scaled 0–100%. Not a certainty score — always confirm visually or in person.",
  cloudCover: "Percent of the satellite image that was cloudy. Cloudy pixels are filtered out before computing these numbers; very high cloud cover means less reliable data went into the result.",
  imageDate: "Date of the clearest satellite pass used within this period's 6-month comparison window.",
};

function InfoLabel({ children, term }) {
  return (
    <span className="relative inline-flex items-center gap-1 group/tip cursor-help">
      {children}
      <span className="text-slate-300 border border-slate-300 rounded-full w-3 h-3 flex items-center justify-center text-[8px] leading-none shrink-0">
        ?
      </span>
      <span className="hidden group-hover/tip:block absolute top-full left-0 mt-1 w-52 bg-slate-800 text-white text-[11px] leading-snug rounded px-2 py-1.5 z-20 normal-case font-normal">
        {TERM_INFO[term]}
      </span>
    </span>
  );
}

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

  // Satellite imagery state, keyed by scan_id
  const [imagery, setImagery] = useState({});
  const [lightbox, setLightbox] = useState(null); // { beforeUrl, afterUrl, beforeRange, afterRange }

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

  async function loadImagery(scanId) {
    setImagery((prev) => ({ ...prev, [scanId]: { loading: true } }));
    try {
      const res = await api.get(`/api/parcels/${id}/imagery`, { params: { scan_id: scanId } });
      setImagery((prev) => ({ ...prev, [scanId]: { loading: false, ...res.data } }));
    } catch {
      setImagery((prev) => ({
        ...prev,
        [scanId]: { loading: false, error: "Failed to load satellite imagery." },
      }));
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
        <div className="flex gap-4 mb-4">
          <Link to="/map" className="text-sm text-blue-600 hover:underline">
            ← Back to map
          </Link>
          <Link to="/inspections" className="text-sm text-blue-600 hover:underline">
            ← Back to flagged parcels
          </Link>
        </div>
        <p className="text-red-600">{error}</p>
      </div>
    );
  }

  const pendingFlags = flags.filter((f) => f.status === "pending");

  return (
    <div className="max-w-3xl mx-auto p-6 space-y-6 overflow-y-auto h-full">
      <div className="flex gap-4">
        <Link to="/map" className="text-sm text-blue-600 hover:underline">
          ← Back to map
        </Link>
        <Link to="/inspections" className="text-sm text-blue-600 hover:underline">
          ← Back to flagged parcels
        </Link>
      </div>

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
                <div className="grid grid-cols-3 gap-x-2 gap-y-3 text-xs text-slate-600">
                  <div>
                    <p className="text-slate-400 mb-0.5"><InfoLabel term="ndbi">NDBI before</InfoLabel></p>
                    <p className="font-mono">{d.ndbi_before ?? "—"}</p>
                  </div>
                  <div>
                    <p className="text-slate-400 mb-0.5"><InfoLabel term="ndbi">NDBI after</InfoLabel></p>
                    <p className="font-mono">{d.ndbi_after ?? "—"}</p>
                  </div>
                  <div>
                    <p className="text-slate-400 mb-0.5"><InfoLabel term="delta">Delta</InfoLabel></p>
                    <p
                      className={`font-mono font-semibold ${
                        d.ndbi_delta > 0.15
                          ? "text-red-600"
                          : d.ndbi_delta > 0
                          ? "text-amber-600"
                          : "text-slate-600"
                      }`}
                    >
                      {d.ndbi_delta != null ? `${d.ndbi_delta > 0 ? "+" : ""}${d.ndbi_delta}` : "—"}
                    </p>
                  </div>
                  <div>
                    <p className="text-slate-400 mb-0.5"><InfoLabel term="ndvi">NDVI before</InfoLabel></p>
                    <p className="font-mono">{d.ndvi_before ?? "—"}</p>
                  </div>
                  <div>
                    <p className="text-slate-400 mb-0.5"><InfoLabel term="ndvi">NDVI after</InfoLabel></p>
                    <p className="font-mono">{d.ndvi_after ?? "—"}</p>
                  </div>
                  <div>
                    <p className="text-slate-400 mb-0.5"><InfoLabel term="confidence">Confidence</InfoLabel></p>
                    <p className="font-mono">
                      {d.confidence_score != null
                        ? `${(d.confidence_score * 100).toFixed(0)}%`
                        : "—"}
                    </p>
                  </div>
                  {d.image_date_before && (
                    <div>
                      <p className="text-slate-400 mb-0.5"><InfoLabel term="imageDate">Image before</InfoLabel></p>
                      <p>{new Date(d.image_date_before).toLocaleDateString()}</p>
                    </div>
                  )}
                  {d.image_date_after && (
                    <div>
                      <p className="text-slate-400 mb-0.5"><InfoLabel term="imageDate">Image after</InfoLabel></p>
                      <p>{new Date(d.image_date_after).toLocaleDateString()}</p>
                    </div>
                  )}
                  {d.cloud_coverage_pct != null && (
                    <div>
                      <p className="text-slate-400 mb-0.5"><InfoLabel term="cloudCover">Cloud cover</InfoLabel></p>
                      <p>{d.cloud_coverage_pct}%</p>
                    </div>
                  )}
                </div>

                {/* Satellite imagery */}
                <div className="mt-3 pt-3 border-t border-slate-200">
                  {!imagery[d.scan_id] ? (
                    <button
                      onClick={() => loadImagery(d.scan_id)}
                      className="text-xs text-blue-600 hover:underline font-medium"
                    >
                      View satellite imagery
                    </button>
                  ) : imagery[d.scan_id].loading ? (
                    <p className="text-xs text-slate-400">Loading satellite imagery…</p>
                  ) : imagery[d.scan_id].error ? (
                    <p className="text-xs text-red-600">{imagery[d.scan_id].error}</p>
                  ) : (
                    <>
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <p className="text-xs text-slate-400 mb-1">
                            Before ({imagery[d.scan_id].before_range?.join(" – ")})
                          </p>
                          {imagery[d.scan_id].before_url ? (
                            <img
                              src={imagery[d.scan_id].before_url}
                              alt="Before satellite imagery"
                              onClick={() => setLightbox(imagery[d.scan_id])}
                              className="w-full rounded border border-slate-200 cursor-zoom-in hover:opacity-90 transition-opacity"
                            />
                          ) : (
                            <p className="text-xs text-slate-400 italic">No clear imagery available</p>
                          )}
                        </div>
                        <div>
                          <p className="text-xs text-slate-400 mb-1">
                            After ({imagery[d.scan_id].after_range?.join(" – ")})
                          </p>
                          {imagery[d.scan_id].after_url ? (
                            <img
                              src={imagery[d.scan_id].after_url}
                              alt="After satellite imagery"
                              onClick={() => setLightbox(imagery[d.scan_id])}
                              className="w-full rounded border border-slate-200 cursor-zoom-in hover:opacity-90 transition-opacity"
                            />
                          ) : (
                            <p className="text-xs text-slate-400 italic">No clear imagery available</p>
                          )}
                        </div>
                      </div>
                      <p className="text-[11px] text-slate-400 mt-1.5">
                        Sentinel-2 satellite imagery, ~10m per pixel — enough to sanity-check a
                        large change, not fine detail like roofline or additions. Click an image
                        to enlarge.
                      </p>
                    </>
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

      {/* Imagery lightbox */}
      {lightbox && (
        <div
          className="fixed inset-0 bg-black/80 flex items-center justify-center p-6 z-50"
          onClick={() => setLightbox(null)}
        >
          <div className="max-w-5xl w-full" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-2">
              <p className="text-white text-sm">
                Sentinel-2 satellite imagery, ~10m per pixel
              </p>
              <button
                onClick={() => setLightbox(null)}
                className="text-white/70 hover:text-white text-sm"
              >
                Close ✕
              </button>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-white/70 text-xs mb-1">
                  Before ({lightbox.before_range?.join(" – ")})
                </p>
                {lightbox.before_url ? (
                  <img src={lightbox.before_url} alt="Before satellite imagery" className="w-full rounded" />
                ) : (
                  <p className="text-white/50 text-xs italic">No clear imagery available</p>
                )}
              </div>
              <div>
                <p className="text-white/70 text-xs mb-1">
                  After ({lightbox.after_range?.join(" – ")})
                </p>
                {lightbox.after_url ? (
                  <img src={lightbox.after_url} alt="After satellite imagery" className="w-full rounded" />
                ) : (
                  <p className="text-white/50 text-xs italic">No clear imagery available</p>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
