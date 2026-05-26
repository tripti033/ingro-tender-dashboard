// IESA / Rehman April-2026 BESS market snapshot.
//
// Hand-tagged with states based on the annotations on the IESA India-map PDF
// Ankit shared (1778077360880.pdf), the project naming conventions, and what's
// publicly known about which authority operates where. "Pan-India" is used
// when the central agency hasn't named a host state yet.
//
// Headline aggregates (used by the dashboard top tile):
//   Operational     ~ 5.7  GWh
//   Under Construction ~ 41.5 GWh
//   Tendering       ~ 73.5 GWh  (Tendering = live-scraped — comes from Firestore, not this file)
//   Merchant        ~ 1,000 MW / 2,500 MWh  (subset of Operational)

export type IesaStage = "Operational" | "Under Construction";
export type IesaType =
  | "Standalone"
  | "Solar+Storage"
  | "FDRE"
  | "RTC"
  | "Assured Peak Power"
  | "Merchant";

export interface IesaProject {
  name: string;
  state: string;            // canonical state name; "Pan-India" for unallocated
  mw: number | null;
  mwh: number;              // primary capacity unit
  stage: IesaStage;
  type: IesaType;
  note?: string;
}

export const IESA_PROJECTS: IesaProject[] = [
  // ── Operational ────────────────────────────────────────────────────────
  { name: "NLC Solar+BESS", state: "Tamil Nadu", mw: 20, mwh: 8, stage: "Operational", type: "Solar+Storage" },
  { name: "NTPC VRB pilot", state: "Andhra Pradesh", mw: 0.6, mwh: 3, stage: "Operational", type: "Standalone", note: "Vanadium redox flow pilot" },
  { name: "BSPGCL Solar+BESS", state: "Bihar", mw: 45.4, mwh: 254, stage: "Operational", type: "Solar+Storage", note: "185 MW solar bundled" },
  { name: "SECI Solar+BESS (small)", state: "Jharkhand", mw: 40, mwh: 120, stage: "Operational", type: "Solar+Storage", note: "100 MW solar bundled" },
  { name: "SECI Solar+BESS (large)", state: "Karnataka", mw: 75, mwh: 150, stage: "Operational", type: "Solar+Storage", note: "1200 MW solar bundled" },
  { name: "GPCL Solar+BESS", state: "Gujarat", mw: null, mwh: 19.2, stage: "Operational", type: "Solar+Storage", note: "6 MW solar bundled" },
  { name: "GSECL Solar+BESS", state: "Gujarat", mw: null, mwh: 57, stage: "Operational", type: "Solar+Storage", note: "35 MW solar bundled" },
  { name: "Tata Power-DDL Rohini", state: "Delhi", mw: 10, mwh: 10, stage: "Operational", type: "Standalone", note: "Distribution sub-station" },
  { name: "SECI Solar+BESS (Lakshadweep)", state: "Lakshadweep", mw: null, mwh: 1.4, stage: "Operational", type: "Solar+Storage" },
  { name: "SECI RTC", state: "Gujarat", mw: 25, mwh: 100, stage: "Operational", type: "RTC", note: "400 MW RTC bundle" },
  { name: "TERI-BRPL", state: "Delhi", mw: 20, mwh: 40, stage: "Operational", type: "Standalone" },
  { name: "NTPC REL", state: "Gujarat", mw: null, mwh: 1.2, stage: "Operational", type: "Standalone" },
  { name: "KMRC", state: "West Bengal", mw: 4, mwh: 6.4, stage: "Operational", type: "Standalone", note: "Kolkata Metro" },
  { name: "GUVNL Phase II", state: "Gujarat", mw: 90, mwh: 180, stage: "Operational", type: "Standalone" },
  { name: "Juniper", state: "Gujarat", mw: 100, mwh: 200, stage: "Operational", type: "Standalone" },
  { name: "ACME", state: "Gujarat", mw: 591.18, mwh: 2031.24, stage: "Operational", type: "Standalone" },
  { name: "Merchant fleet", state: "Gujarat", mw: 1000, mwh: 2500, stage: "Operational", type: "Merchant", note: "Aggregated merchant capacity, predominantly Gujarat" },

  // ── Under Construction ────────────────────────────────────────────────
  { name: "SECI Solar+ESS (large UC)", state: "Pan-India", mw: 600, mwh: 1200, stage: "Under Construction", type: "Solar+Storage", note: "1200 MW solar bundled" },
  { name: "NHPC FDRE Tranche-I", state: "Pan-India", mw: 1500, mwh: 450, stage: "Under Construction", type: "FDRE" },
  { name: "SJVN FDRE 1500+1500", state: "Pan-India", mw: 3000, mwh: 664, stage: "Under Construction", type: "FDRE" },
  { name: "NTPC FDRE 3000 MW", state: "Pan-India", mw: 3000, mwh: 415, stage: "Under Construction", type: "FDRE" },
  { name: "NHPC FDRE Tranche-II", state: "Pan-India", mw: 1200, mwh: 995, stage: "Under Construction", type: "FDRE" },
  { name: "SECI FDRE 1260 MW", state: "Pan-India", mw: 1260, mwh: 177.2, stage: "Under Construction", type: "FDRE" },
  { name: "SJVN FDRE + Greenshoe", state: "Pan-India", mw: 2400, mwh: 825, stage: "Under Construction", type: "FDRE" },
  { name: "Tata Power FDRE 250", state: "Pan-India", mw: 250, mwh: 0, stage: "Under Construction", type: "FDRE", note: "MWh not disclosed" },
  { name: "SECI Solar+BESS (huge UC)", state: "Pan-India", mw: 1000, mwh: 4000, stage: "Under Construction", type: "Solar+Storage", note: "2000 MW solar bundled" },
  { name: "SECI 1200 RTC", state: "Pan-India", mw: 1200, mwh: 0, stage: "Under Construction", type: "RTC", note: "MWh not disclosed" },
  { name: "SJVN Assured Peak 6000 MWh", state: "Pan-India", mw: 1500, mwh: 6000, stage: "Under Construction", type: "Assured Peak Power", note: "1500 MW × 4hr" },
  { name: "NHPC FDRE 1200 MW", state: "Pan-India", mw: 1200, mwh: 0, stage: "Under Construction", type: "FDRE", note: "MWh not disclosed" },
  { name: "MSEDCL 750/1500", state: "Maharashtra", mw: 750, mwh: 1500, stage: "Under Construction", type: "Standalone" },
  { name: "KPTCL 500/1000", state: "Karnataka", mw: 500, mwh: 1000, stage: "Under Construction", type: "Standalone" },
  { name: "GUVNL Phase IV", state: "Gujarat", mw: 500, mwh: 1000, stage: "Under Construction", type: "Standalone" },
  { name: "NHPC 500/1000", state: "Andhra Pradesh", mw: 500, mwh: 1000, stage: "Under Construction", type: "Standalone" },
  { name: "SECI ESS-3 125/500", state: "Kerala", mw: 125, mwh: 500, stage: "Under Construction", type: "Standalone" },
  { name: "TNGECL 500/1000", state: "Tamil Nadu", mw: 500, mwh: 1000, stage: "Under Construction", type: "Standalone" },
  { name: "SJVN 375/1500", state: "Uttar Pradesh", mw: 375, mwh: 1500, stage: "Under Construction", type: "Standalone" },
  { name: "KREDL Solar+BESS small", state: "Karnataka", mw: 50, mwh: 100, stage: "Under Construction", type: "Solar+Storage", note: "100 MW solar bundled" },
  { name: "NHPC 125/500", state: "Kerala", mw: 125, mwh: 500, stage: "Under Construction", type: "Standalone" },
  { name: "RVUNL 500/1000", state: "Rajasthan", mw: 500, mwh: 1000, stage: "Under Construction", type: "Standalone" },
  { name: "NVVN 500/1000 UC", state: "Rajasthan", mw: 500, mwh: 1000, stage: "Under Construction", type: "Standalone" },
  { name: "BSPGCL Solar+BESS UC", state: "Bihar", mw: 50.5, mwh: 241, stage: "Under Construction", type: "Solar+Storage", note: "116 MW solar bundled" },
  { name: "BSPGCL 125/500", state: "Bihar", mw: 125, mwh: 500, stage: "Under Construction", type: "Standalone" },
  { name: "KREDL Solar+BESS large", state: "Karnataka", mw: 250, mwh: 1100, stage: "Under Construction", type: "Solar+Storage", note: "250 MW solar bundled" },
  { name: "SECI 25/50 Solar+BESS", state: "Ladakh", mw: 25, mwh: 50, stage: "Under Construction", type: "Solar+Storage" },
  { name: "SECI 2/1 Solar+BESS", state: "Ladakh", mw: 2, mwh: 1, stage: "Under Construction", type: "Solar+Storage" },
];

// IESA published headline aggregates as-of April 2026.
// Source: Ibad Ur Rehman / IESA deck shared by CEO. Used by the headline tile
// when we want to show "national context" rather than what we've tagged
// individually — the published totals are higher than our per-project tally
// because the deck rolls in capacity our list doesn't enumerate.
export const IESA_HEADLINE = {
  operationalGWh: 5.7,
  underConstructionGWh: 41.5,
  tenderingGWh: 73.5,
  merchantMW: 1000,
  merchantMWh: 2500,
};

export const NATIONAL_TOTAL_TENDERING_MWH = IESA_HEADLINE.tenderingGWh * 1000;
