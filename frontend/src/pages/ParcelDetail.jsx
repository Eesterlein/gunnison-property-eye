import { useParams, Link, useNavigate } from "react-router-dom";
import { useState, useEffect } from "react";
import api from "../api";
import { DEMO, FLAGS_LABEL } from "../demo";

// Plain-language explanations for the detection jargon, shown on hover.
const TERM_INFO = {
  ndbi: "Normalized Difference Built-up Index — a satellite measurement that highlights rooftops, pavement, and other built surfaces. Higher values usually mean more built-up area.",
  delta: "The change in NDBI between the before and after periods. A large positive jump suggests new construction — parcels above the flagging threshold get flagged for review.",
  ndvi: "Normalized Difference Vegetation Index — measures plant/vegetation health. Used as a check: if vegetation increased a lot instead, the NDBI change is probably plant growth, not construction.",
  confidence: "How far the parcel's built-up change exceeded the flagging threshold, scaled 0–100% (older scans: the NDBI change). Not a certainty score — always confirm visually or in person.",
  cloudCover: "Percent of the satellite image that was cloudy. Cloudy pixels are filtered out before computing these numbers; very high cloud cover means less reliable data went into the result.",
  imageDate: "Date of the clearest satellite pass used within this period's 6-month comparison window.",
  built: "Probability (0–100%) that the parcel's interior is built-up — roofs, pavement — from Google Dynamic World, which is trained to tell buildings apart from grass, shrubs and bare ground.",
  builtLocal: "How much more built-up the parcel became than the land around it. Change in the surrounding ring (a new road, a whole subdivision going in) is subtracted, so this reflects change on this parcel only.",
  vacant: "The assessor's records carry $0 in improvements on this parcel. A newly detected building here is the strongest lead for unreported construction.",
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

// Satellite years (after the newest aerial flight) are ~10m and blurry —
// always say so wherever a year is shown, so blur isn't mistaken for change.
const isSatellite = (y) => y.source === "sentinel2";
const yearTag = (y) => (isSatellite(y) ? `${y.year} · satellite` : `${y.year}`);
const flightLabel = (y) =>
  isSatellite(y)
    ? `satellite composite, ${y.date_start} – ${y.date_end}, ~10m per pixel`
    : y.date_start === y.date_end
    ? `aerial, flown ${y.date_start}`
    : `aerial, flown ${y.date_start} – ${y.date_end}`;

// Two aligned images with a draggable divider: left year underneath, right
// year clipped on top. `fit` sizes it to the viewport for the full-screen view.
// Click or drag anywhere on the image to move the divider (pointer events,
// not an invisible <input type="range">, which only responds when grabbed at
// its thumb); arrow keys nudge it when focused.
function SwipeCompare({ before, after, fit = false }) {
  const [split, setSplit] = useState(50);
  const [dragging, setDragging] = useState(false);
  // Until both images arrive, the bottom one shows through on both sides —
  // which would look like "no change". Track loads per URL pair.
  const [loaded, setLoaded] = useState({});
  const bothLoaded = loaded[before.url] && loaded[after.url];
  const markLoaded = (url) => () => setLoaded((prev) => ({ ...prev, [url]: true }));
  const imgClass = fit ? "block max-w-full max-h-[80vh]" : "w-full block";

  function moveTo(e) {
    const rect = e.currentTarget.getBoundingClientRect();
    const pct = ((e.clientX - rect.left) / rect.width) * 100;
    setSplit(Math.min(100, Math.max(0, pct)));
  }

  function handleKeyDown(e) {
    const step = e.shiftKey ? 10 : 2;
    if (e.key === "ArrowLeft") setSplit((s) => Math.max(0, s - step));
    else if (e.key === "ArrowRight") setSplit((s) => Math.min(100, s + step));
    else return;
    e.preventDefault();
  }

  return (
    <div
      role="slider"
      tabIndex={0}
      aria-label="Swipe between years"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(split)}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        setDragging(true);
        moveTo(e);
      }}
      onPointerMove={(e) => dragging && moveTo(e)}
      onPointerUp={() => setDragging(false)}
      onPointerCancel={() => setDragging(false)}
      onKeyDown={handleKeyDown}
      className={`relative select-none overflow-hidden bg-slate-100 cursor-ew-resize touch-none focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${
        fit ? "inline-block rounded" : "rounded border border-slate-200"
      }`}
    >
      <img
        src={before.url}
        alt={`Aerial photo ${before.year}`}
        className={imgClass}
        onLoad={markLoaded(before.url)}
        draggable={false}
      />
      <img
        src={after.url}
        alt={`Aerial photo ${after.year}`}
        className="absolute inset-0 w-full h-full"
        style={{ clipPath: `inset(0 0 0 ${split}%)` }}
        onLoad={markLoaded(after.url)}
        draggable={false}
      />
      {!bothLoaded && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/50 text-white text-sm z-10">
          Loading photos…
        </div>
      )}
      <div className="absolute top-0 bottom-0 pointer-events-none" style={{ left: `${split}%` }}>
        <div className="absolute top-0 bottom-0 -translate-x-1/2 w-0.5 bg-white shadow" />
        <div className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2 w-8 h-8 rounded-full bg-white shadow-md flex items-center justify-center text-slate-600 text-xs">
          ◀▶
        </div>
      </div>
      <span className="absolute top-2 left-2 bg-black/60 text-white text-xs rounded px-1.5 py-0.5 pointer-events-none">{yearTag(before)}</span>
      <span className="absolute top-2 right-2 bg-black/60 text-white text-xs rounded px-1.5 py-0.5 pointer-events-none">{yearTag(after)}</span>
    </div>
  );
}

function YearSelect({ label, value, onChange, years, dark = false }) {
  return (
    <label className="flex items-center gap-1.5">
      {label}
      <select
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className={`border rounded px-1.5 py-1 ${
          dark ? "bg-slate-800 border-slate-600 text-white" : "border-slate-300"
        }`}
      >
        {years.map((y) => (
          <option key={y.year} value={y.year}>{yearTag(y)}</option>
        ))}
      </select>
    </label>
  );
}

// Full-screen swipe comparison using large renders framed tightly on the
// parcel. Fetched on demand — each close-up image is several MB.
function AerialCloseup({ parcelId, years, beforeYear, afterYear, setBeforeYear, setAfterYear, onClose }) {
  const [closeup, setCloseup] = useState(null); // { [year]: entry }
  const [error, setError] = useState("");

  useEffect(() => {
    setCloseup(null);
    setError("");
    api
      .get(`/api/parcels/${parcelId}/aerial-closeup`, { params: { years: `${beforeYear},${afterYear}` } })
      .then((res) => setCloseup(Object.fromEntries(res.data.years.map((y) => [y.year, y]))))
      .catch(() => setError("Failed to load close-up photos."));
  }, [parcelId, beforeYear, afterYear]);

  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const before = closeup?.[beforeYear];
  const after = closeup?.[afterYear];

  return (
    <div className="fixed inset-0 bg-black/90 flex flex-col items-center justify-center p-4 z-50" onClick={onClose}>
      <div className="w-full max-w-7xl flex flex-col items-center gap-2" onClick={(e) => e.stopPropagation()}>
        <div className="w-full flex flex-wrap items-center justify-between gap-3 text-xs text-white/80">
          <div className="flex items-center gap-3">
            <YearSelect label="Left" value={beforeYear} onChange={setBeforeYear} years={years} dark />
            <YearSelect label="Right" value={afterYear} onChange={setAfterYear} years={years} dark />
            <span className="text-white/50">Drag across the image to swipe between years.</span>
          </div>
          <button onClick={onClose} className="text-white/70 hover:text-white text-sm">
            Close ✕
          </button>
        </div>
        {error ? (
          <p className="text-red-400 text-sm py-20">{error}</p>
        ) : !before || !after ? (
          <p className="text-white/60 text-sm py-20">Loading close-up photos…</p>
        ) : (
          <SwipeCompare before={before} after={after} fit />
        )}
        {before && after && (
          <p className="text-white/50 text-[11px]">
            Left: {flightLabel(before)}. Right: {flightLabel(after)}. Parcel outline in yellow.
            Aerial years are USDA NAIP (2023 ≈ 0.3m per pixel, older 0.6–1m); satellite years are
            Sentinel-2, far blurrier — use them only for large, obvious changes. Credits: USDA
            Farm Service Agency NAIP; contains modified Copernicus Sentinel data.
          </p>
        )}
      </div>
    </div>
  );
}

// Dated high-resolution NAIP aerial photos for every flight year (plus ~10m
// satellite composites for newer seasons), with a swipe comparison between
// two chosen years. All years are rendered over the
// same extent, so the two images line up exactly when overlaid.
function AerialHistory({ parcelId }) {
  const [years, setYears] = useState(null); // null = loading
  const [error, setError] = useState("");
  const [beforeYear, setBeforeYear] = useState(null);
  const [afterYear, setAfterYear] = useState(null);
  const [closeupOpen, setCloseupOpen] = useState(false);

  useEffect(() => {
    setYears(null);
    setError("");
    api
      .get(`/api/parcels/${parcelId}/aerial-history`)
      .then((res) => {
        const ys = res.data.years || [];
        setYears(ys);
        // Default to the two newest sharp aerial years; staff can switch to
        // the blurrier satellite years for anything newer.
        const aerial = ys.filter((y) => !isSatellite(y));
        const pair = aerial.length >= 2 ? aerial.slice(-2) : ys.slice(-2);
        if (pair.length === 2) {
          setBeforeYear(pair[0].year);
          setAfterYear(pair[1].year);
        }
      })
      .catch(() => setError("Failed to load aerial photos."));
  }, [parcelId]);

  if (error) return <p className="text-xs text-red-600">{error}</p>;
  if (years === null) return <p className="text-xs text-slate-400">Loading aerial photos…</p>;
  if (years.length < 2) {
    return <p className="text-xs text-slate-400 italic">Not enough aerial photo years cover this parcel.</p>;
  }

  const before = years.find((y) => y.year === beforeYear);
  const after = years.find((y) => y.year === afterYear);
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3 text-xs text-slate-600">
        <YearSelect label="Left" value={beforeYear} onChange={setBeforeYear} years={years} />
        <YearSelect label="Right" value={afterYear} onChange={setAfterYear} years={years} />
        <span className="text-slate-400">Click or drag across the photo to swipe between years.</span>
        <button
          onClick={() => setCloseupOpen(true)}
          className="ml-auto bg-blue-600 hover:bg-blue-700 text-white rounded px-3 py-1.5 text-xs font-medium"
        >
          🔍 View closer
        </button>
      </div>

      <SwipeCompare before={before} after={after} />
      <p className="text-[11px] text-slate-400">
        Left: {before.year} ({flightLabel(before)}). Right: {after.year} ({flightLabel(after)}).
        Parcel outline in yellow. Aerial photos (USDA NAIP, roughly 0.3–1m per pixel) are flown
        about every two years; years after the newest flight are Sentinel-2 satellite composites
        (~10m per pixel, much blurrier) until the next aerial flight is published.
        Aerial photos: USDA Farm Service Agency NAIP. Satellite: contains modified Copernicus
        Sentinel data.
      </p>

      {/* Every year at a glance — click to put a year on the left */}
      <div className="flex gap-2 overflow-x-auto pb-1">
        {years.map((y) => (
          <button
            key={y.year}
            onClick={() => setBeforeYear(y.year)}
            className={`shrink-0 w-24 text-left rounded border p-0.5 ${
              y.year === beforeYear || y.year === afterYear
                ? "border-blue-500"
                : "border-slate-200 hover:border-slate-400"
            }`}
          >
            <img src={y.url} alt={`Aerial photo ${y.year}`} loading="lazy" className="w-full rounded-sm" />
            <span className="block text-[11px] text-slate-600 px-0.5">
              {y.year}
              {isSatellite(y) && <span className="text-amber-700"> · satellite</span>}
            </span>
          </button>
        ))}
      </div>
      <p className="text-[11px] text-slate-400">Click a year above to compare it on the left.</p>

      {closeupOpen && (
        <AerialCloseup
          parcelId={parcelId}
          years={years}
          beforeYear={beforeYear}
          afterYear={afterYear}
          setBeforeYear={setBeforeYear}
          setAfterYear={setAfterYear}
          onClose={() => setCloseupOpen(false)}
        />
      )}
    </div>
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
            ← Back to {FLAGS_LABEL.toLowerCase()}
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
          ← Back to {FLAGS_LABEL.toLowerCase()}
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
          {!DEMO && <p><span className="text-slate-400">Owner:</span> {parcel.owner_name || "—"}</p>}
          <p><span className="text-slate-400">Jurisdiction:</span> {parcel.jurisdiction || "—"}</p>
          <p><span className="text-slate-400">Acres:</span> {parcel.acres ?? "—"}</p>
          <p><span className="text-slate-400">Land use:</span> {parcel.land_use_code || "—"}</p>
          {/* Hidden in the public demo: "vacant on the books" next to a detected
              change at a real address reads like an accusation */}
          {!DEMO && <p>
            <span className="text-slate-400">Improvements (assessor):</span>{" "}
            {parcel.improvements_value == null ? (
              "—"
            ) : parcel.improvements_value === 0 ? (
              <span className="text-red-700 font-medium">
                <InfoLabel term="vacant">$0 — vacant on books</InfoLabel>
              </span>
            ) : (
              `$${Math.round(parcel.improvements_value).toLocaleString()}`
            )}
          </p>}
          {parcel.last_scan_date && (
            <p><span className="text-slate-400">Last scan:</span> {new Date(parcel.last_scan_date).toLocaleDateString()}</p>
          )}
        </div>
      </div>

      {/* Aerial photo history */}
      <div className="bg-white border border-slate-200 rounded-lg p-5">
        <h2 className="font-semibold text-slate-700 mb-3">Aerial Photo History</h2>
        <AerialHistory parcelId={id} />
      </div>

      {/* Flags for review */}
      {flags.length > 0 && (
        <div>
          <h2 className="font-semibold text-slate-700 mb-3">{DEMO ? "Detected Changes" : "Flags"}</h2>
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
                {!DEMO && flag.status === "pending" && (
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
          <h2 className="font-semibold text-slate-700 mb-1">Detection History</h2>
          <p className="text-[11px] text-slate-400 mb-3">
            Measured with Dynamic World V1 (© Google LLC and World Resources Institute) and
            Copernicus Sentinel-2 data, processed in Google Earth Engine.
          </p>
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
                  {d.built_local_delta != null && (
                    <>
                      <div>
                        <p className="text-slate-400 mb-0.5"><InfoLabel term="built">Built before</InfoLabel></p>
                        <p className="font-mono">{d.built_before != null ? `${(d.built_before * 100).toFixed(0)}%` : "—"}</p>
                      </div>
                      <div>
                        <p className="text-slate-400 mb-0.5"><InfoLabel term="built">Built after</InfoLabel></p>
                        <p className="font-mono">{d.built_after != null ? `${(d.built_after * 100).toFixed(0)}%` : "—"}</p>
                      </div>
                      <div>
                        <p className="text-slate-400 mb-0.5"><InfoLabel term="builtLocal">Change vs. surroundings</InfoLabel></p>
                        <p className={`font-mono font-semibold ${d.built_local_delta > 0.15 ? "text-red-600" : "text-slate-600"}`}>
                          {`${d.built_local_delta > 0 ? "+" : ""}${(d.built_local_delta * 100).toFixed(0)} pts`}
                        </p>
                      </div>
                    </>
                  )}
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
                        Sentinel-2 satellite imagery, ~10m per pixel — the same seasons the
                        scan compared, but too coarse for roofline or additions. Use Aerial
                        Photo History above for detail. Click an image to enlarge.
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
