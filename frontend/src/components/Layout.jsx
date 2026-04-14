import { Outlet, NavLink } from "react-router-dom";

export default function Layout() {
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
            Flagged Parcels
          </NavLink>
        </nav>
      </header>
      <main className="flex-1 overflow-hidden">
        <Outlet />
      </main>
    </div>
  );
}
