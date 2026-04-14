/**
 * ParcelDetail — Phase 4/5
 *
 * Shows a single parcel's information, detection history, and flag status.
 * Staff can confirm or dismiss flags from this page.
 *
 * TODO Phase 4:
 *  - Fetch parcel from /api/parcels/:id
 *  - Fetch detections from /api/detections?parcel_id=:id
 *  - Fetch flags from /api/flags?parcel_id=:id
 *  - Small map showing just this parcel boundary
 *
 * TODO Phase 5:
 *  - Confirm / dismiss flag buttons with notes field
 *  - PATCH /api/flags/:id
 */
import { useParams, Link } from "react-router-dom";

export default function ParcelDetail() {
  const { id } = useParams();

  return (
    <div className="max-w-3xl mx-auto p-6">
      <Link to="/map" className="text-sm text-blue-600 hover:underline mb-4 block">
        ← Back to map
      </Link>

      <div className="bg-slate-100 rounded p-6 text-center text-slate-500">
        <p className="font-medium">Parcel #{id}</p>
        <p className="text-sm mt-1">
          Full parcel detail view — Phase 4
        </p>
      </div>
    </div>
  );
}
