/**
 * MapDashboard — Phase 4
 *
 * Main parcel map showing all county parcels with flagged overlays.
 * Parcels with pending flags are highlighted in orange/red.
 * Clicking a parcel opens ParcelDetail.
 *
 * TODO Phase 4:
 *  - Load parcel GeoJSON from /api/parcels (paginated or bbox-filtered)
 *  - Render parcel polygons with react-leaflet GeoJSON layer
 *  - Color-code parcels by flag status
 *  - Click handler -> navigate to /parcels/:id
 *  - Sidebar with flag count summary
 */
import { MapContainer, TileLayer } from "react-leaflet";

// Gunnison County center
const GUNNISON_CENTER = [38.545, -106.925];
const DEFAULT_ZOOM = 10;

export default function MapDashboard() {
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
          <select
            className="w-full border border-slate-300 rounded px-2 py-1.5 text-sm"
            disabled
          >
            <option>All parcels</option>
            <option>Flagged only</option>
            <option>Confirmed changes</option>
          </select>
        </div>

        <div>
          <h3 className="text-xs font-medium text-slate-500 uppercase tracking-wide mb-2">
            Jurisdiction
          </h3>
          <select
            className="w-full border border-slate-300 rounded px-2 py-1.5 text-sm"
            disabled
          >
            <option>All jurisdictions</option>
            <option>Gunnison County</option>
            <option>City of Gunnison</option>
            <option>Crested Butte</option>
            <option>Mt. Crested Butte</option>
          </select>
        </div>
      </div>

      {/* Map */}
      <div className="flex-1">
        <MapContainer
          center={GUNNISON_CENTER}
          zoom={DEFAULT_ZOOM}
          style={{ height: "100%", width: "100%" }}
        >
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          {/* TODO Phase 4: add GeoJSON parcel layer */}
        </MapContainer>
      </div>
    </div>
  );
}
