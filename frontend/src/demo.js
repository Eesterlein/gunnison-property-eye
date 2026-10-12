// Public read-only demo build (VITE_DEMO_MODE=true): no login, no review or
// scan controls, flags worded as "detected changes", and no "Vacant on books"
// highlight. Owner names and assessor values are shown — they're public records.
export const DEMO = import.meta.env.VITE_DEMO_MODE === "true";

export const FLAGS_LABEL = DEMO ? "Detected Changes" : "Flagged Parcels";
