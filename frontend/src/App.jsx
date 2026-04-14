import { Routes, Route, Navigate } from "react-router-dom";
import Layout from "./components/Layout";
import MapDashboard from "./pages/MapDashboard";
import ParcelDetail from "./pages/ParcelDetail";
import InspectionLog from "./pages/InspectionLog";

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Navigate to="/map" replace />} />
        <Route path="/map" element={<MapDashboard />} />
        <Route path="/parcels/:id" element={<ParcelDetail />} />
        <Route path="/inspections" element={<InspectionLog />} />
      </Route>
    </Routes>
  );
}
