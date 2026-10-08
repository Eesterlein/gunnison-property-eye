import { Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider, useAuth } from "./context/AuthContext";
import Layout from "./components/Layout";
import Login from "./pages/Login";
import MapDashboard from "./pages/MapDashboard";
import ParcelDetail from "./pages/ParcelDetail";
import InspectionLog from "./pages/InspectionLog";
import { DEMO } from "./demo";

function ProtectedRoute({ children }) {
  const { user } = useAuth();
  if (!user) return <Navigate to="/login" replace />;
  return children;
}

export default function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/login" element={DEMO ? <Navigate to="/map" replace /> : <Login />} />
        <Route
          element={
            <ProtectedRoute>
              <Layout />
            </ProtectedRoute>
          }
        >
          <Route index element={<Navigate to="/map" replace />} />
          <Route path="/map" element={<MapDashboard />} />
          <Route path="/parcels/:id" element={<ParcelDetail />} />
          <Route path="/inspections" element={<InspectionLog />} />
        </Route>
      </Routes>
    </AuthProvider>
  );
}
