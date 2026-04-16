/**
 * MapDashboard
 *
 * Main parcel map. Parcel polygons are served as vector tiles from tipg
 * (OGC API – Features) pointing at our PostGIS database.
 *
 * Tile URL pattern:
 *   /tipg/api/collections/public.parcels/tiles/WebMercatorQuad/{z}/{x}/{y}
 *
 * TODO Phase 4:
 *  - Add flag overlay layer (color parcels with pending flags in orange/red)
 *  - Click handler → navigate to /parcels/:id using the APN from feature properties
 *  - Sidebar flag count from /api/flags
 */
import { useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import Map, { Source, Layer, NavigationControl } from "react-map-gl/maplibre";
import "maplibre-gl/dist/maplibre-gl.css";

// Gunnison County center
const INITIAL_VIEW = {
  longitude: -106.925,
  latitude: 38.545,
  zoom: 10,
};

// tipg has CORS enabled — hit it directly (no proxy needed)
// In production, replace with your deployed tipg URL
const TIPG_BASE = import.meta.env.VITE_TIPG_URL || "http://localhost:8002/api";
const PARCEL_TILES_URL = `${TIPG_BASE}/collections/public.parcels/tiles/WebMercatorQuad/{z}/{x}/{y}`;

// Parcel fill style — light blue with thin border
const parcelFillLayer = {
  id: "parcels-fill",
  type: "fill",
  "source-layer": "default",
  paint: {
    "fill-color": "#3b82f6",
    "fill-opacity": 0.15,
  },
};

const parcelLineLayer = {
  id: "parcels-line",
  type: "line",
  "source-layer": "default",
  paint: {
    "line-color": "#1d4ed8",
    "line-width": 0.5,
    "line-opacity": 0.6,
  },
};

// TODO Phase 4: flag highlight layer
// const flaggedFillLayer = { ... paint: { "fill-color": "#f97316", "fill-opacity": 0.5 } }

export default function MapDashboard() {
  const navigate = useNavigate();
  const [viewState, setViewState] = useState(INITIAL_VIEW);
  const [hoveredParcel, setHoveredParcel] = useState(null);

  const handleClick = useCallback((evt) => {
    const features = evt.features;
    if (!features || features.length === 0) return;
    const feature = features[0];
    const parcelId = feature.properties?.id;
    if (parcelId) {
      navigate(`/parcels/${parcelId}`);
    }
  }, [navigate]);

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

  return (
    <div className="flex h-full">
      {/* Sidebar */}
      <div className="w-72 bg-white border-r border-slate-200 p-4 flex flex-col gap-4 shrink-0 overflow-y-auto">
        <h2 className="font-semibold text-slate-800">Change Detection</h2>

        <div className="bg-amber-50 border border-amber-200 rounded p-3 text-sm text-amber-800">
          Detection not yet running — Phase 2 required.
        </div>

        <div>
          <h3 className="text-xs font-medium text-slate-500 uppercase tracking-wide mb-2">
            Filter
          </h3>
          <select className="w-full border border-slate-300 rounded px-2 py-1.5 text-sm" disabled>
            <option>All parcels</option>
            <option>Flagged only</option>
            <option>Confirmed changes</option>
          </select>
        </div>

        <div>
          <h3 className="text-xs font-medium text-slate-500 uppercase tracking-wide mb-2">
            Jurisdiction
          </h3>
          <select className="w-full border border-slate-300 rounded px-2 py-1.5 text-sm" disabled>
            <option>All jurisdictions</option>
            <option>Gunnison County</option>
            <option>City of Gunnison</option>
            <option>Crested Butte</option>
            <option>Mt. Crested Butte</option>
          </select>
        </div>

        {/* Hovered parcel info */}
        {hoveredParcel && (
          <div className="mt-auto border-t border-slate-200 pt-3 text-xs text-slate-600 space-y-1">
            <p className="font-medium text-slate-800 truncate">{hoveredParcel.situs_address || "No address"}</p>
            <p>{hoveredParcel.owner_name || "Unknown owner"}</p>
            <p className="font-mono text-slate-400">{hoveredParcel.apn}</p>
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
          interactiveLayerIds={["parcels-fill"]}
        >
          <NavigationControl position="top-right" />

          <Source
            id="parcels"
            type="vector"
            tiles={[PARCEL_TILES_URL]}
            minzoom={8}
            maxzoom={16}
          >
            <Layer {...parcelFillLayer} />
            <Layer {...parcelLineLayer} />
          </Source>
        </Map>
      </div>
    </div>
  );
}
