// Public read-only demo build (VITE_DEMO_MODE=true): no login, no review or
// scan controls, no owner names, and flags worded as "detected changes".
export const DEMO = import.meta.env.VITE_DEMO_MODE === "true";

export const FLAGS_LABEL = DEMO ? "Detected Changes" : "Flagged Parcels";
