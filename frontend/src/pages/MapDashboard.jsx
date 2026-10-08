import { useState, useCallback, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import Map, { Source, Layer, NavigationControl } from "react-map-gl/maplibre";
import "maplibre-gl/dist/maplibre-gl.css";
import api from "../api";
import { DEMO } from "../demo";

const INITIAL_VIEW = {
  longitude: -106.925,
  latitude: 38.545,
  zoom: 10,
};

const TIPG_BASE = import.meta.env.VITE_TIPG_URL ?? "http://localhost:8002/api";
const PARCEL_TILES_URL = `${TIPG_BASE}/collections/public.parcels/tiles/WebMercatorQuad/{z}/{x}/{y}`;

// Default parcel fill
const parcelFillLayer = {
  id: "parcels-fill",
  type: "fill",
  "source-layer": "default",
  paint: { "fill-color": "#3b82f6", "fill-opacity": 0.15 },
};

const parcelLineLayer = {
  id: "parcels-line",
  type: "line",
  "source-layer": "default",
  paint: { "line-color": "#1d4ed8", "line-width": 0.5, "line-opacity": 0.6 },
};

// Esri World Imagery — free, no API key required, standard satellite basemap
// for open-source GIS apps.
const SATELLITE_STYLE = {
  version: 8,
  sources: {
    "esri-satellite": {
      type: "raster",
      tiles: [
        "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
      ],
      tileSize: 256,
      attribution: "Esri, Maxar, Earthstar Geographics, and the GIS User Community",
    },
  },
  layers: [
    { id: "esri-satellite-layer", type: "raster", source: "esri-satellite", minzoom: 0, maxzoom: 19 },
  ],
};

const BASEMAP_OPTIONS = {
  streets: {
    label: "Streets",
    // Voyager has more labeling/detail than the previous default (Positron),
    // which was nearly blank at county zoom levels.
    style: "https://basemaps.cartocdn.com/gl/voyager-gl-style/style.json",
  },
  satellite: {
    label: "Satellite",
    style: SATELLITE_STYLE,
  },
};
const DEFAULT_BASEMAP = "streets";


// Earliest season with usable Sentinel-2 SR Harmonized coverage.
const MIN_SEASON_YEAR = 2017;

// A season year Y is only valid once Y+1's Oct 31 has already elapsed —
// otherwise the "after" comparison window (auto-computed as the same
// months one year later) would be built from an incomplete/future season.
function getLatestValidSeasonYear() {
  const now = new Date();
  let year = now.getFullYear() - 1;
  while (new Date(year + 1, 9, 31) > now) {
    year -= 1;
  }
  return year;
}

const LATEST_VALID_SEASON_YEAR = getLatestValidSeasonYear();
const SEASON_YEAR_OPTIONS = Array.from(
  { length: LATEST_VALID_SEASON_YEAR - MIN_SEASON_YEAR + 1 },
  (_, i) => LATEST_VALID_SEASON_YEAR - i
);

// Backend timestamps are naive UTC (no "Z" suffix) — parse them as UTC
// explicitly, otherwise the browser reads them as local time and skews
// elapsed-time math by the local UTC offset.
function parseUtc(dateStr) {
  if (!dateStr) return null;
  return new Date(dateStr.endsWith("Z") ? dateStr : dateStr + "Z");
}

function formatDuration(ms) {
  const totalMinutes = Math.max(1, Math.round(ms / 60000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return hours === 0 ? `${minutes}m` : `${hours}h ${minutes}m`;
}

// Extrapolates from progress-so-far — accurate once a few checkpoints have
// committed, rough right at the start of a scan.
function estimateTimeRemaining(scan) {
  if (!scan.started_at || !scan.total_parcels || !scan.parcels_scanned) return null;
  const elapsedMs = Date.now() - parseUtc(scan.started_at).getTime();
  const remaining = scan.total_parcels - scan.parcels_scanned;
  if (elapsedMs <= 0 || scan.parcels_scanned <= 0 || remaining <= 0) return null;
  return (remaining / scan.parcels_scanned) * elapsedMs;
}

export default function MapDashboard() {
  const navigate = useNavigate();
  const [viewState, setViewState] = useState(INITIAL_VIEW);
  const [hoveredParcel, setHoveredParcel] = useState(null);
  const [basemap, setBasemap] = useState(DEFAULT_BASEMAP);

  // Flags state
  const [flaggedIds, setFlaggedIds] = useState([]);
  const [flaggedGeojson, setFlaggedGeojson] = useState({ type: "FeatureCollection", features: [] });
  const [pendingCount, setPendingCount] = useState(0);
  const [filterMode, setFilterMode] = useState("all"); // "all" | "flagged"

  // Scan form
  const [showScanForm, setShowScanForm] = useState(false);
  const [scanYear, setScanYear] = useState(LATEST_VALID_SEASON_YEAR);
  const [scanLimit, setScanLimit] = useState("");
  const [scanStatus, setScanStatus] = useState(null); // null | "submitting" | "running" | "error"
  const [lastScan, setLastScan] = useState(null);
  const [scanError, setScanError] = useState("");

  // Load flagged parcel IDs and last scan on mount
  useEffect(() => {
    loadFlaggedIds();
    loadLastScan();
  }, []);

  async function loadFlaggedIds() {
    try {
      const [idsRes, geojsonRes] = await Promise.all([
        api.get("/api/flags/flagged-parcel-ids"),
        api.get("/api/parcels/flagged-geojson"),
      ]);
      setFlaggedIds(idsRes.data.parcel_ids);
      setPendingCount(idsRes.data.parcel_ids.length);
      setFlaggedGeojson(geojsonRes.data);
    } catch (e) {
      console.error("Failed to load flagged parcels", e);
    }
  }

  async function loadLastScan() {
    try {
      const res = await api.get("/api/scans/?limit=1");
      if (res.data.length > 0) setLastScan(res.data[0]);
    } catch (e) {
      console.error("Failed to load last scan", e);
    }
  }

  async function handleRunScan(e) {
    e.preventDefault();
    setScanStatus("submitting");
    setScanError("");
    try {
      const body = {
        date_range_start: `${scanYear}-05-01T00:00:00`,
        date_range_end: `${scanYear}-10-31T00:00:00`,
        triggered_by: "manual",
      };
      if (scanLimit) body.limit = parseInt(scanLimit, 10);
      const res = await api.post("/api/scans/", body);
      setLastScan(res.data);
      setScanStatus("running");
      setShowScanForm(false);
      // Poll until scan finishes
      pollScan(res.data.id);
    } catch (err) {
      setScanError(err.response?.data?.detail || "Failed to start scan");
      setScanStatus("error");
    }
  }

  async function pollScan(scanId) {
    const interval = setInterval(async () => {
      try {
        const res = await api.get(`/api/scans/${scanId}`);
        setLastScan(res.data);
        if (res.data.status === "complete" || res.data.status === "failed") {
          clearInterval(interval);
          setScanStatus(null);
          if (res.data.status === "complete") {
            await loadFlaggedIds(); // refresh map overlay
          }
        }
      } catch {
        clearInterval(interval);
        setScanStatus(null);
      }
    }, 5000);
  }

  const handleClick = useCallback(
    (evt) => {
      const features = evt.features;
      if (!features || features.length === 0) return;
      const parcelId = features[0].properties?.id;
      if (parcelId) navigate(`/parcels/${parcelId}`);
    },
    [navigate]
  );

  const handleMouseMove = useCallback((evt) => {
    const features = evt.features;
    if (features && features.length > 0) {
      setHoveredParcel(features[0].properties);
      evt.target.getCanvas().style.cursor = "pointer";
    } else {
      setHoveredParcel(null);
      evt.target.getCanvas().style.cursor = "";
    }
  }, []);

  const visibleFillLayer =
    filterMode === "flagged"
      ? { ...parcelFillLayer, paint: { "fill-color": "#3b82f6", "fill-opacity": 0 } }
      : parcelFillLayer;

  function scanStatusBadge() {
    if (!lastScan) return null;
    const colors = {
      complete: "bg-green-100 text-green-800 border-green-200",
      running: "bg-yellow-100 text-yellow-800 border-yellow-200",
      failed: "bg-red-100 text-red-800 border-red-200",
      pending: "bg-slate-100 text-slate-600 border-slate-200",
    };
    const cls = colors[lastScan.status] || colors.pending;
    const etaMs = lastScan.status === "running" ? estimateTimeRemaining(lastScan) : null;
    return (
      <div className={`border rounded p-3 text-xs ${cls}`}>
        <p className="font-medium capitalize">{lastScan.status}</p>
        {lastScan.started_at && (
          <p className="opacity-80">Started {parseUtc(lastScan.started_at).toLocaleString()}</p>
        )}
        {lastScan.parcels_scanned != null && (
          <p>
            {lastScan.parcels_scanned}
            {lastScan.total_parcels != null ? ` / ${lastScan.total_parcels}` : ""} scanned ·{" "}
            {lastScan.parcels_flagged} flagged
          </p>
        )}
        {lastScan.status === "running" && (
          <p className="opacity-80">
            {etaMs != null ? `~${formatDuration(etaMs)} remaining` : "Estimating time remaining…"}
          </p>
        )}
        {lastScan.completed_at && (
          <p className="text-xs opacity-70">
            {parseUtc(lastScan.completed_at).toLocaleDateString()}
          </p>
        )}
        {lastScan.error_message && (
          <p className="mt-1 opacity-80">{lastScan.error_message}</p>
        )}
      </div>
    );
  }

  return (
    <div className="flex h-full">
      {/* Sidebar */}
      <div className="w-72 bg-white border-r border-slate-200 p-4 flex flex-col gap-4 shrink-0 overflow-y-auto">
        <h2 className="font-semibold text-slate-800">Change Detection</h2>

        {/* Pending flags count */}
        <div
          className={`rounded p-3 text-sm border ${
            pendingCount > 0
              ? "bg-orange-50 border-orange-200 text-orange-800"
              : "bg-slate-50 border-slate-200 text-slate-600"
          }`}
        >
          {pendingCount > 0 ? (
            <>
              <span className="font-semibold">{pendingCount}</span> parcel
              {pendingCount !== 1 ? "s" : ""} {DEMO ? "with detected change" : "flagged for review"}
            </>
          ) : (
            "No pending flags"
          )}
        </div>

        {/* Last scan status */}
        {scanStatusBadge()}
        {scanStatus === "running" && (
          <p className="text-xs text-yellow-700 animate-pulse">
            Scan running… refreshing every 5s
          </p>
        )}

        {/* Run scan */}
        {DEMO ? null : !showScanForm ? (
          <button
            onClick={() => setShowScanForm(true)}
            disabled={scanStatus === "running" || scanStatus === "submitting"}
            className="w-full bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-medium rounded px-3 py-2"
          >
            Run New Scan
          </button>
        ) : (
          <form onSubmit={handleRunScan} className="space-y-2 text-sm">
            <p className="font-medium text-slate-700">Season to scan</p>
            <select
              value={scanYear}
              onChange={(e) => setScanYear(parseInt(e.target.value, 10))}
              className="w-full border border-slate-300 rounded px-2 py-1.5 text-sm"
            >
              {SEASON_YEAR_OPTIONS.map((year) => (
                <option key={year} value={year}>
                  {year} vs {year + 1} (May–Oct each year)
                </option>
              ))}
            </select>
            <p className="text-xs text-slate-400">
              Compares the {scanYear} growing season to {scanYear + 1}. Only seasons
              that have fully finished are selectable.
            </p>
            <p className="font-medium text-slate-700 pt-1">
              Limit parcels{" "}
              <span className="font-normal text-slate-400">(blank = all)</span>
            </p>
            <input
              type="number"
              value={scanLimit}
              onChange={(e) => setScanLimit(e.target.value)}
              placeholder="e.g. 50"
              className="w-full border border-slate-300 rounded px-2 py-1.5 text-sm"
            />
            {scanError && (
              <p className="text-red-600 text-xs">{scanError}</p>
            )}
            <div className="flex gap-2 pt-1">
              <button
                type="submit"
                disabled={scanStatus === "submitting"}
                className="flex-1 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded px-3 py-1.5 text-sm font-medium"
              >
                {scanStatus === "submitting" ? "Starting…" : "Start"}
              </button>
              <button
                type="button"
                onClick={() => setShowScanForm(false)}
                className="flex-1 border border-slate-300 rounded px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50"
              >
                Cancel
              </button>
            </div>
          </form>
        )}

        {/* Basemap */}
        <div>
          <h3 className="text-xs font-medium text-slate-500 uppercase tracking-wide mb-2">
            Base map
          </h3>
          <select
            className="w-full border border-slate-300 rounded px-2 py-1.5 text-sm"
            value={basemap}
            onChange={(e) => setBasemap(e.target.value)}
          >
            {Object.entries(BASEMAP_OPTIONS).map(([key, opt]) => (
              <option key={key} value={key}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>

        {/* Filter */}
        <div>
          <h3 className="text-xs font-medium text-slate-500 uppercase tracking-wide mb-2">
            Show on map
          </h3>
          <select
            className="w-full border border-slate-300 rounded px-2 py-1.5 text-sm"
            value={filterMode}
            onChange={(e) => setFilterMode(e.target.value)}
          >
            <option value="all">All parcels</option>
            <option value="flagged">Flagged only</option>
          </select>
        </div>

        {/* Legend */}
        <div className="text-xs text-slate-500 space-y-1">
          <div className="flex items-center gap-2">
            <div className="w-4 h-3 rounded bg-blue-400 opacity-60" />
            <span>Parcel</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-4 h-3 rounded bg-orange-500 opacity-70" />
            <span>{DEMO ? "Detected change" : "Pending review"}</span>
          </div>
        </div>

        {/* Hover info */}
        {hoveredParcel && (
          <div className="mt-auto border-t border-slate-200 pt-3 text-xs text-slate-600 space-y-1">
            <p className="font-medium text-slate-800 truncate">
              {hoveredParcel.situs_address || "No address"}
            </p>
            {!DEMO && <p>{hoveredParcel.owner_name || "Unknown owner"}</p>}
            <p className="font-mono text-slate-400">{hoveredParcel.apn}</p>
            {flaggedIds.includes(hoveredParcel.id) && (
              <p className="text-orange-600 font-medium">{DEMO ? "Change detected" : "Flagged for review"}</p>
            )}
          </div>
        )}
      </div>

      {/* Map */}
      <div className="flex-1">
        <Map
          {...viewState}
          style={{ width: "100%", height: "100%" }}
          mapStyle={BASEMAP_OPTIONS[basemap].style}
          onMove={(evt) => setViewState(evt.viewState)}
          onClick={handleClick}
          onMouseMove={handleMouseMove}
          interactiveLayerIds={["parcels-fill", "flagged-fill"]}
        >
          <NavigationControl position="top-right" />

          <Source
            id="parcels"
            type="vector"
            tiles={[PARCEL_TILES_URL]}
            minzoom={8}
            maxzoom={16}
          >
            <Layer {...visibleFillLayer} />
            <Layer {...parcelLineLayer} />
          </Source>

          {/* Flagged parcel overlay — GeoJSON so no vector tile filter type issues */}
          <Source id="flagged-parcels" type="geojson" data={flaggedGeojson}>
            <Layer
              id="flagged-fill"
              type="fill"
              paint={{ "fill-color": "#f97316", "fill-opacity": 0.65 }}
            />
            <Layer
              id="flagged-line"
              type="line"
              paint={{ "line-color": "#ea580c", "line-width": 2 }}
            />
          </Source>
        </Map>
      </div>
    </div>
  );
}
