import { useState, useCallback, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import Map, { Source, Layer, NavigationControl } from "react-map-gl/maplibre";
import "maplibre-gl/dist/maplibre-gl.css";
import api from "../api";

const INITIAL_VIEW = {
  longitude: -106.925,
  latitude: 38.545,
  zoom: 10,
};

const TIPG_BASE = import.meta.env.VITE_TIPG_URL || "http://localhost:8002/api";
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


const DEFAULT_BEFORE = new Date(new Date().getFullYear() - 2, 4, 1)
  .toISOString()
  .slice(0, 10);
const DEFAULT_AFTER = new Date(new Date().getFullYear() - 2, 9, 31)
  .toISOString()
  .slice(0, 10);

export default function MapDashboard() {
  const navigate = useNavigate();
  const [viewState, setViewState] = useState(INITIAL_VIEW);
  const [hoveredParcel, setHoveredParcel] = useState(null);

  // Flags state
  const [flaggedIds, setFlaggedIds] = useState([]);
  const [flaggedGeojson, setFlaggedGeojson] = useState({ type: "FeatureCollection", features: [] });
  const [pendingCount, setPendingCount] = useState(0);
  const [filterMode, setFilterMode] = useState("all"); // "all" | "flagged"

  // Scan form
  const [showScanForm, setShowScanForm] = useState(false);
  const [scanStart, setScanStart] = useState(DEFAULT_BEFORE);
  const [scanEnd, setScanEnd] = useState(DEFAULT_AFTER);
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
        date_range_start: scanStart + "T00:00:00",
        date_range_end: scanEnd + "T00:00:00",
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
    return (
      <div className={`border rounded p-3 text-xs ${cls}`}>
        <p className="font-medium capitalize">{lastScan.status}</p>
        {lastScan.parcels_scanned != null && (
          <p>
            {lastScan.parcels_scanned} scanned · {lastScan.parcels_flagged} flagged
          </p>
        )}
        {lastScan.completed_at && (
          <p className="text-xs opacity-70">
            {new Date(lastScan.completed_at).toLocaleDateString()}
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
              {pendingCount !== 1 ? "s" : ""} flagged for review
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
        {!showScanForm ? (
          <button
            onClick={() => setShowScanForm(true)}
            disabled={scanStatus === "running" || scanStatus === "submitting"}
            className="w-full bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-medium rounded px-3 py-2"
          >
            Run New Scan
          </button>
        ) : (
          <form onSubmit={handleRunScan} className="space-y-2 text-sm">
            <p className="font-medium text-slate-700">Before period</p>
            <input
              type="date"
              value={scanStart}
              onChange={(e) => setScanStart(e.target.value)}
              required
              className="w-full border border-slate-300 rounded px-2 py-1.5 text-sm"
            />
            <input
              type="date"
              value={scanEnd}
              onChange={(e) => setScanEnd(e.target.value)}
              required
              className="w-full border border-slate-300 rounded px-2 py-1.5 text-sm"
            />
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
            <span>Pending review</span>
          </div>
        </div>

        {/* Hover info */}
        {hoveredParcel && (
          <div className="mt-auto border-t border-slate-200 pt-3 text-xs text-slate-600 space-y-1">
            <p className="font-medium text-slate-800 truncate">
              {hoveredParcel.situs_address || "No address"}
            </p>
            <p>{hoveredParcel.owner_name || "Unknown owner"}</p>
            <p className="font-mono text-slate-400">{hoveredParcel.apn}</p>
            {flaggedIds.includes(hoveredParcel.id) && (
              <p className="text-orange-600 font-medium">Flagged for review</p>
            )}
          </div>
        )}
      </div>

      {/* Map */}
      <div className="flex-1">
        <Map
          {...viewState}
          style={{ width: "100%", height: "100%" }}
          mapStyle="https://basemaps.cartocdn.com/gl/positron-gl-style/style.json"
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
