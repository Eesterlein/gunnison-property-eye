import { useEffect, useRef, useState } from "react";

// Every outside dataset the app displays or measures, with the credit wording
// each provider asks for. Keep in sync when a source is added.
const SOURCES = [
  {
    name: "Parcel boundaries and assessor values",
    credit: "Gunnison County, Colorado — public tax parcel GIS data",
  },
  {
    name: "Sentinel-2 satellite imagery",
    credit: `Contains modified Copernicus Sentinel data (2015–${new Date().getFullYear()}), European Space Agency`,
  },
  {
    name: "Cloud masking",
    credit: "Cloud Score+ S2_HARMONIZED V1, Google",
  },
  {
    name: "Built-up land cover probability",
    credit: "Dynamic World V1 © Google LLC and World Resources Institute (CC BY 4.0)",
  },
  {
    name: "Aerial photography",
    credit: "USDA Farm Service Agency, National Agriculture Imagery Program (NAIP) — public domain",
  },
  {
    name: "Imagery processing",
    credit: "Google Earth Engine",
  },
  {
    name: "Satellite base map",
    credit: "Esri, Maxar, Earthstar Geographics, and the GIS User Community",
  },
  {
    name: "Street base map",
    credit: "© CARTO, © OpenStreetMap contributors",
  },
];

export default function DataSources() {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    const close = (e) => {
      if (e.key === "Escape" || (e.type === "mousedown" && !ref.current?.contains(e.target))) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", close);
    };
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((o) => !o)}
        className="text-slate-300 hover:text-white text-sm"
        aria-expanded={open}
      >
        Data sources
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-2 w-96 max-w-[calc(100vw-2rem)] bg-white text-slate-700 rounded-lg shadow-lg border border-slate-200 p-4 z-50">
          <p className="font-semibold text-slate-800 text-sm mb-2">Data sources</p>
          <ul className="space-y-2 text-xs">
            {SOURCES.map((s) => (
              <li key={s.name}>
                <span className="text-slate-500">{s.name}:</span> {s.credit}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
