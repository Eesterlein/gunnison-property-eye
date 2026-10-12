import { Outlet, NavLink, Link, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { DEMO, FLAGS_LABEL } from "../demo";
import DataSources from "./DataSources";

export default function Layout() {
  const { user, logout, readOnly } = useAuth();
  const navigate = useNavigate();

  function handleLogout() {
    logout();
    navigate(DEMO ? "/map" : "/login", { replace: true });
  }

  return (
    <div className="flex flex-col h-screen">
      <header className="bg-slate-800 text-white px-6 py-3 flex items-center gap-6 shrink-0">
        <span className="font-semibold text-lg">Gunnison Property Eye</span>
        <nav className="flex gap-4 text-sm">
          <NavLink
            to="/map"
            className={({ isActive }) =>
              isActive ? "text-white underline" : "text-slate-300 hover:text-white"
            }
          >
            Map
          </NavLink>
          <NavLink
            to="/inspections"
            className={({ isActive }) =>
              isActive ? "text-white underline" : "text-slate-300 hover:text-white"
            }
          >
            {FLAGS_LABEL}
          </NavLink>
        </nav>
        <div className="ml-auto flex items-center gap-4 text-sm">
          <DataSources />
          {readOnly ? (
            <Link
              to="/login"
              className="text-white border border-slate-500 hover:border-white rounded px-2.5 py-1"
            >
              Admin sign in
            </Link>
          ) : (
            <>
              <span className="text-slate-400">{user?.email}</span>
              <button
                onClick={handleLogout}
                className="text-slate-300 hover:text-white"
              >
                Sign out
              </button>
            </>
          )}
        </div>
      </header>
      {DEMO && (
        <div className="bg-amber-50 border-b border-amber-200 text-amber-900 text-xs px-6 py-1.5 shrink-0">
          {readOnly ? (
            <strong>Read-only demo.</strong>
          ) : (
            <strong>Signed in as admin — reviews and scans you start here are live.</strong>
          )}{" "}
          An independent project, not an official product of
          Gunnison County or its Assessor&apos;s Office. Detected changes are automated
          satellite measurements, not findings about any property; parcel data comes from
          public county GIS records.
        </div>
      )}
      <main className="flex-1 overflow-hidden">
        <Outlet />
      </main>
    </div>
  );
}
