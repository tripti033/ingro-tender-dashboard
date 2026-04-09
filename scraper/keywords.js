/**
 * Master BESS keyword list for all scrapers.
 * All matching is done case-insensitively (text.toLowerCase() before comparison).
 * Stored in lowercase here — scrapers lowercase the source text before matching.
 */
export const BESS_KEYWORDS = [
  // Primary terms
  "bess",
  "battery energy storage",
  "battery energy storage system",
  "battery storage",
  "energy storage",
  "energy storage system",

  // Capacity-related (often in tender titles)
  "mwh",

  // Technology variants
  "grid scale battery",
  "grid-scale battery",
  "utility scale battery",
  "utility-scale battery",
  "standalone storage",
  "stand-alone storage",
  "lithium ion storage",
  "li-ion storage",
  "stationary battery",
  "stationary storage",

  // Project types
  "battery storage project",
  "storage project",
  "firm and dispatchable renewable energy",
  "fdre",

  // Hybrid mentions
  "solar plus storage",
  "solar + storage",
  "solar with storage",
  "wind plus storage",
  "wind + storage",
  "renewable energy storage",
  "re with storage",

  // Pumped storage (related)
  "pumped storage",
  "pumped hydro storage",

  // EPC/procurement specific
  "battery management system",
  "bms for battery",
  "battery container",
  "battery inverter",
  "power conversion system",
  "pcs for battery",
  "energy storage integration",
];
