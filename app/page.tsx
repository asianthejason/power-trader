// app/page.tsx
import NavTabs from "./components/NavTabs";
import {
  getTodayHourlyStates,
  getNearestNeighbourStates,
  getTodayVsNearestNeighbourFromHistory,
  summarizeDay,
  fetchAesoActualForecastRows,
  type HourlyState,
  type AesoActualForecastRow,
} from "../lib/marketData";

export const revalidate = 60; // regenerate at most once per minute

type PriceSource = "actual" | "forecast" | null;
type RenewableSource = "actual" | "forecast" | null;

/* ---------- small helpers ---------- */

function formatNumber(n: number | null | undefined, decimals = 0) {
  if (n == null || Number.isNaN(n)) return "—";
  return n.toLocaleString(undefined, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

function cushionFlagLabel(flag: string | undefined) {
  switch (flag) {
    case "tight":
      return "Tight";
    case "watch":
      return "Watch";
    case "comfortable":
      return "Comfortable";
    default:
      return "Unknown";
  }
}

function cushionFlagClass(flag: string | undefined) {
  switch (flag) {
    case "tight":
      return "bg-red-500/10 text-red-400 border-red-500/40";
    case "watch":
      return "bg-amber-500/10 text-amber-400 border-amber-500/40";
    case "comfortable":
      return "bg-emerald-500/10 text-emerald-400 border-emerald-500/40";
    default:
      return "bg-slate-700/40 text-slate-300 border-slate-500/40";
  }
}

/* ---------- types for joined dashboard rows ---------- */

type JoinedRow = {
  he: number;
  comparisonDate: string | null;
  today: HourlyState;
  nn: HourlyState | null;

  todayPrice: number | null;
  nnPrice: number | null;
  dPrice: number | null;

  nnLoad: number | null;
  rtLoad: number | null;
  dLoad: number | null;

  nnTielines: number | null;
  rtTielines: number | null;
  dTielines: number | null;

  nnWind: number | null;
  rtWind: number | null;
  dWind: number | null;

  nnSolar: number | null;
  rtSolar: number | null;
  dSolar: number | null;

  // Cushion-based delta vs NN (today cushion − NN cushion)
  nnCushionDelta: number | null;

  // Component-based supply deltas (ΔWind + ΔSolar − ΔLoad − ΔTielines)
  hourlySupplyDelta: number | null;
  cumulativeSupplyDelta: number | null;
};

/* ---------- Alberta time + CSD tielines ---------- */

// Approx Alberta now (UTC-7; this is just a rough offset)
function approxAlbertaNow() {
  const nowUtc = new Date();
  const offsetMs = 7 * 60 * 60 * 1000;
  const nowAb = new Date(nowUtc.getTime() - offsetMs);
  const isoDate = nowAb.toISOString().slice(0, 10);
  return { nowAb, isoDate };
}

type IntertiePath = "AB-BC" | "AB-SK" | "AB-MATL";

type IntertieSnapshot = {
  path: IntertiePath;
  counterparty: string;
  // Net actual flow from AESO CSD, MW.
  // Positive = net exports from Alberta, negative = net imports into Alberta.
  actualFlowMw: number | null;
};

type IntertieSnapshotResult = {
  asOfAb: Date | null;
  rows: IntertieSnapshot[];
  systemNetInterchangeMw: number | null;
};

/**
 * Given the raw HTML from CSDReportServlet, find the numeric MW value
 * that appears in a table row after the given label.
 *
 * Example snippet:
 *   <tr><td>Net Actual Interchange</td><td>-489</td></tr>
 */
function extractFlowForLabel(html: string, label: string): number | null {
  const idx = html.indexOf(label);
  if (idx === -1) return null;

  const tail = html.slice(idx);
  const match = tail.match(/<\/td>\s*<td>\s*(-?\d+)\s*<\/td>/i);
  if (!match) return null;

  const n = Number(match[1]);
  return Number.isFinite(n) ? n : null;
}

/**
 * One-shot snapshot of current net intertie flows from AESO CSD.
 * This is *not* hourly – we later map the system net interchange
 * onto the current HE only.
 */
async function fetchAesoInterchangeSnapshot(): Promise<IntertieSnapshotResult> {
  const AESO_CSD_URL =
    "http://ets.aeso.ca/ets_web/ip/Market/Reports/CSDReportServlet";

  try {
    const res = await fetch(AESO_CSD_URL);

    if (!res.ok) {
      console.error("Failed to fetch AESO CSD:", res.status, res.statusText);
      return { asOfAb: null, rows: [], systemNetInterchangeMw: null };
    }

    const html = await res.text();

    // Path-level net flows from INTERCHANGE table
    const bc = extractFlowForLabel(html, "British Columbia");
    const mt = extractFlowForLabel(html, "Montana");
    const sk = extractFlowForLabel(html, "Saskatchewan");

    // System-wide net interchange from SUMMARY table
    const systemNet = extractFlowForLabel(html, "Net Actual Interchange");

    const { nowAb } = approxAlbertaNow();

    const rows: IntertieSnapshot[] = [
      {
        path: "AB-BC",
        counterparty: "British Columbia",
        actualFlowMw: bc,
      },
      {
        path: "AB-MATL",
        counterparty: "Montana (MATL)",
        actualFlowMw: mt,
      },
      {
        path: "AB-SK",
        counterparty: "Saskatchewan",
        actualFlowMw: sk,
      },
    ];

    return { asOfAb: nowAb, rows, systemNetInterchangeMw: systemNet };
  } catch (err) {
    console.error("Error fetching/parsing AESO CSD:", err);
    return { asOfAb: null, rows: [], systemNetInterchangeMw: null };
  }
}

/* ---------- NN tielines from nn-history.csv ---------- */

/**
 * Load net tielines for a specific historical date
 * from lib/data/nn-history.csv.
 *
 * Expected header includes:
 *   date,he,actual_pool_price,actual_ail,hour_ahead_pool_price_forecast,
 *   export_bc,export_mt,export_sk,import_bc,import_mt,import_sk
 *
 * Net tielines here are defined with **exports positive, imports negative**:
 *
 *   net = (exports from AB) - (imports into AB)
 *
 * So positive = net exports from Alberta, negative = net imports.
 */
async function loadNnTielinesForDate(
  dateIso: string
): Promise<Map<number, number | null>> {
  const fs = await import("node:fs/promises");
  const path = await import("node:path");

  const filePath = path.join(process.cwd(), "lib", "data", "nn-history.csv");
  const raw = await fs.readFile(filePath, "utf8");

  const lines = raw
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  const map = new Map<number, number | null>();
  if (lines.length <= 1) return map;

  const headers = lines[0].split(",").map((h) => h.trim());
  const idx = (name: string) => headers.indexOf(name);

  const dateIdx = idx("date");
  const heIdx = idx("he");
  const exportBcIdx = idx("export_bc");
  const exportMtIdx = idx("export_mt");
  const exportSkIdx = idx("export_sk");
  const importBcIdx = idx("import_bc");
  const importMtIdx = idx("import_mt");
  const importSkIdx = idx("import_sk");

  if (
    dateIdx === -1 ||
    heIdx === -1 ||
    exportBcIdx === -1 ||
    exportMtIdx === -1 ||
    exportSkIdx === -1 ||
    importBcIdx === -1 ||
    importMtIdx === -1 ||
    importSkIdx === -1
  ) {
    console.error(
      "nn-history.csv is missing one or more tieline columns; cannot build NN tielines."
    );
    return map;
  }

  const parseNum = (s: string | undefined): number => {
    if (!s) return 0;
    const trimmed = s.trim();
    if (!trimmed || trimmed === "-" || trimmed === "--") return 0;
    const n = Number(trimmed);
    return Number.isFinite(n) ? n : 0;
  };

  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(",");
    const rowDate = cols[dateIdx]?.trim();
    if (rowDate !== dateIso) continue;

    const he = Number(cols[heIdx]);
    if (!Number.isFinite(he)) continue;

    const exportBc = parseNum(cols[exportBcIdx]);
    const exportMt = parseNum(cols[exportMtIdx]);
    const exportSk = parseNum(cols[exportSkIdx]);
    const importBc = parseNum(cols[importBcIdx]);
    const importMt = parseNum(cols[importMtIdx]);
    const importSk = parseNum(cols[importSkIdx]);

    // Exports positive, imports negative: net = exports - imports
    const net =
      exportBc + exportMt + exportSk - (importBc + importMt + importSk);

    map.set(he, Number.isFinite(net) ? net : null);
  }

  return map;
}

/* ---------- CSV helpers copied from renewables ---------- */

/** Very small CSV splitter that respects quoted fields. */
function splitCsvLine(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];

    if (ch === '"') {
      // Toggle quote state; double quotes inside a quoted field are collapsed.
      if (i + 1 < line.length && line[i + 1] === '"') {
        current += '"';
        i++; // skip escaped quote
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (ch === "," && !inQuotes) {
      result.push(current);
      current = "";
      continue;
    }

    current += ch;
  }

  result.push(current);
  return result;
}

function parseMw(raw: string | undefined): number | null {
  if (!raw) return null;
  const cleaned = raw.replace(/["\s,]/g, "");
  if (!cleaned) return null;
  const val = Number(cleaned);
  return Number.isFinite(val) ? val : null;
}

/* ---------- short-term renewables → HE averages ---------- */

// Same AESO URLs as /renewables page.
const AESO_WIND_12H_URL =
  "http://ets.aeso.ca/Market/Reports/Manual/Operations/prodweb_reports/wind_solar_forecast/wind_rpt_shortterm.csv";

const AESO_SOLAR_12H_URL =
  "http://ets.aeso.ca/Market/Reports/Manual/Operations/prodweb_reports/wind_solar_forecast/solar_rpt_shortterm.csv";

/**
 * Parse a 12-hour short-term renewables CSV (wind or solar) and
 * return:
 *   - HE → average MW using Actual where available, otherwise Most Likely
 *   - HE → source flag: "actual" if all samples were Actual,
 *       "forecast" if any sample had to use Most Likely.
 */
function parseShortTermCsvToHeMap(
  csvText: string,
  dateIso: string
): {
  valueByHe: Map<number, number | null>;
  sourceByHe: Map<number, RenewableSource>;
} {
  const lines = csvText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  const valueByHe = new Map<number, number | null>();
  const sourceByHe = new Map<number, RenewableSource>();

  if (lines.length <= 1) return { valueByHe, sourceByHe };

  const headerCells = splitCsvLine(lines[0]).map((h) => h.trim());

  const dateIdx = headerCells.findIndex((h) => /date|time/i.test(h));

  const findMwIdx = (pattern: RegExp) =>
    headerCells.findIndex((h) => pattern.test(h) && !/pct/i.test(h));

  let mostIdx = findMwIdx(/most\s*likely/i);
  let actualIdx = findMwIdx(/actual/i);

  if (mostIdx < 0 && actualIdx < 0) {
    console.error("Short-term CSV missing both Actual and Most Likely columns.");
    return { valueByHe, sourceByHe };
  }

  type Sample = { value: number; isActual: boolean };
  const buckets: Record<number, Sample[]> = {};

  for (let i = 1; i < lines.length; i++) {
    const cols = splitCsvLine(lines[i]).map((c) => c.trim());
    if (cols.length === 0) continue;

    const timeRaw = dateIdx >= 0 ? cols[dateIdx] : cols[0];
    if (!timeRaw) continue;

    // First 10 characters are the date in the CSV
    const datePart = timeRaw.slice(0, 10).replace(/\//g, "-");
    if (datePart !== dateIso) continue;

    const timePart = timeRaw.slice(11); // "HH:MM" or "HH:MM:SS"
    const hourStr = timePart.slice(0, 2);
    const hour = Number(hourStr);
    if (!Number.isFinite(hour)) continue;

    const he = hour + 1; // hour 0..23 → HE 1..24
    if (he < 1 || he > 24) continue;

    const actualVal = actualIdx >= 0 ? parseMw(cols[actualIdx]) : null;
    const mostVal = mostIdx >= 0 ? parseMw(cols[mostIdx]) : null;

    let useVal: number | null = null;
    let isActual = false;

    if (actualVal != null) {
      useVal = actualVal;
      isActual = true;
    } else if (mostVal != null) {
      useVal = mostVal;
      isActual = false;
    } else {
      continue;
    }

    if (!buckets[he]) buckets[he] = [];
    buckets[he].push({ value: useVal, isActual });
  }

  for (const [heStr, samples] of Object.entries(buckets)) {
    const he = Number(heStr);
    if (!samples.length) continue;

    let sum = 0;
    let hasActual = false;
    let hasForecast = false;

    for (const s of samples) {
      sum += s.value;
      if (s.isActual) hasActual = true;
      else hasForecast = true;
    }

    const avg = sum / samples.length;
    valueByHe.set(he, avg);

    let src: RenewableSource = null;
    if (hasForecast) src = "forecast"; // any Most Likely ⇒ blue
    else if (hasActual) src = "actual";

    sourceByHe.set(he, src);
  }

  return { valueByHe, sourceByHe };
}

/**
 * Fetch 12-hour short-term wind & solar CSVs and convert them to
 * HE-level average MW + source flags for the given ISO date (YYYY-MM-DD).
 *
 * Uses the same HTTP endpoints and headers as /renewables.
 */
async function fetchShortTermHeMaps(dateIso: string): Promise<{
  windByHe: Map<number, number | null>;
  solarByHe: Map<number, number | null>;
  windSourceByHe: Map<number, RenewableSource>;
  solarSourceByHe: Map<number, RenewableSource>;
}> {
  try {
    const [windRes, solarRes] = await Promise.all([
      fetch(AESO_WIND_12H_URL, {
        cache: "no-store",
        headers: {
          "User-Agent":
            "Mozilla/5.0 (compatible; AlbertaPowerTraderBot/1.0; +https://power-trader.vercel.app)",
        },
      }),
      fetch(AESO_SOLAR_12H_URL, {
        cache: "no-store",
        headers: {
          "User-Agent":
            "Mozilla/5.0 (compatible; AlbertaPowerTraderBot/1.0; +https://power-trader.vercel.app)",
        },
      }),
    ]);

    if (!windRes.ok) {
      console.error(
        "Failed to fetch AESO wind short-term report:",
        windRes.status,
        windRes.statusText
      );
    }
    if (!solarRes.ok) {
      console.error(
        "Failed to fetch AESO solar short-term report:",
        solarRes.status,
        solarRes.statusText
      );
    }

    const [windCsv, solarCsv] = await Promise.all([
      windRes.ok ? windRes.text() : Promise.resolve(""),
      solarRes.ok ? solarRes.text() : Promise.resolve(""),
    ]);

    const windParsed =
      windCsv.trim().length > 0
        ? parseShortTermCsvToHeMap(windCsv, dateIso)
        : {
            valueByHe: new Map<number, number | null>(),
            sourceByHe: new Map<number, RenewableSource>(),
          };

    const solarParsed =
      solarCsv.trim().length > 0
        ? parseShortTermCsvToHeMap(solarCsv, dateIso)
        : {
            valueByHe: new Map<number, number | null>(),
            sourceByHe: new Map<number, RenewableSource>(),
          };

    return {
      windByHe: windParsed.valueByHe,
      solarByHe: solarParsed.valueByHe,
      windSourceByHe: windParsed.sourceByHe,
      solarSourceByHe: solarParsed.sourceByHe,
    };
  } catch (err) {
    console.error("Error fetching short-term renewables:", err);
    return {
      windByHe: new Map<number, number | null>(),
      solarByHe: new Map<number, number | null>(),
      windSourceByHe: new Map<number, RenewableSource>(),
      solarSourceByHe: new Map<number, RenewableSource>(),
    };
  }
}

/* ---------- build main joined rows (price/load) ---------- */

/**
 * Build joined rows that look like the Excel "Supply Cushion" tab.
 *
 * NOTE:
 * - Tielines, wind and solar are *not* filled here. We fill NN
 *   tielines from nn-history.csv, today tielines from CSD, and
 *   RT wind/solar from the short-term renewables CSV later so that
 *   everything shown is grounded in AESO data.
 * - For now NN wind/solar are left null because we do not yet
 *   maintain an AESO-based historical HE renewables dataset.
 */
function buildJoinedRows(
  todayStates: HourlyState[],
  nnStates: HourlyState[]
): JoinedRow[] {
  const nnByHe = new Map<number, HourlyState>();
  for (const row of nnStates) {
    nnByHe.set(row.he, row);
  }

  return todayStates.map((today) => {
    const nn = nnByHe.get(today.he) ?? null;

    const todayPrice =
      today.actualPoolPrice ?? today.forecastPoolPrice ?? null;
    const nnPrice =
      nn?.actualPoolPrice ?? nn?.forecastPoolPrice ?? null;
    const dPrice =
      todayPrice != null && nnPrice != null ? todayPrice - nnPrice : null;

    // Load: today vs NN (later we override with NN history where available)
    const nnLoad = nn?.actualLoad ?? null;
    const rtLoad = today.actualLoad ?? null;
    const dLoad =
      nnLoad != null && rtLoad != null ? rtLoad - nnLoad : null;

    // Cushion delta vs NN (using whatever cushionMw was computed).
    // If both cushions are 0 everywhere, we'll detect that later
    // and fall back to the component-based cumulative supply Δ.
    const todayCushion = today.cushionMw ?? null;
    const nnCushion = nn?.cushionMw ?? null;
    let nnCushionDelta: number | null = null;
    if (
      todayCushion != null &&
      nnCushion != null &&
      !(todayCushion === 0 && nnCushion === 0)
    ) {
      nnCushionDelta = todayCushion - nnCushion;
    }

    return {
      he: today.he,
      comparisonDate: nn ? nn.date : null,
      today,
      nn,
      todayPrice,
      nnPrice,
      dPrice,
      nnLoad,
      rtLoad,
      dLoad,
      nnTielines: null,
      rtTielines: null,
      dTielines: null,
      nnWind: null,
      rtWind: null,
      dWind: null,
      nnSolar: null,
      rtSolar: null,
      dSolar: null,
      nnCushionDelta,
      hourlySupplyDelta: null,
      cumulativeSupplyDelta: null,
    };
  });
}

/* ---------- WMRQH “actual vs forecast” source maps ---------- */

function buildSourceMapsForToday(
  todaysRows: AesoActualForecastRow[]
): {
  priceSourceByHe: Map<number, PriceSource>;
  loadSourceByHe: Map<number, PriceSource>;
  priceValueByHe: Map<number, number | null>;
  loadValueByHe: Map<number, number | null>;
} {
  const priceSourceByHe = new Map<number, PriceSource>();
  const loadSourceByHe = new Map<number, PriceSource>();
  const priceValueByHe = new Map<number, number | null>();
  const loadValueByHe = new Map<number, number | null>();

  for (const r of todaysRows) {
    // Price: actual first, else forecast
    let priceSource: PriceSource = null;
    let priceValue: number | null = null;
    if (r.actualPoolPrice != null) {
      priceSource = "actual";
      priceValue = r.actualPoolPrice;
    } else if (r.forecastPoolPrice != null) {
      priceSource = "forecast";
      priceValue = r.forecastPoolPrice;
    }

    // Load (AIL)
    let loadSource: PriceSource = null;
    let loadValue: number | null = null;
    if (r.actualAil != null) {
      loadSource = "actual";
      loadValue = r.actualAil;
    } else if (r.forecastAil != null) {
      loadSource = "forecast";
      loadValue = r.forecastAil;
    }

    priceSourceByHe.set(r.he, priceSource);
    loadSourceByHe.set(r.he, loadSource);
    priceValueByHe.set(r.he, priceValue);
    loadValueByHe.set(r.he, loadValue);
  }

  return { priceSourceByHe, loadSourceByHe, priceValueByHe, loadValueByHe };
}

/* ---------- main page ---------- */

export default async function DashboardPage() {
  const [{ rows: aesoRows }, todayStates, nnStates, nnResult, csdSnapshot] =
    await Promise.all([
      fetchAesoActualForecastRows(),
      getTodayHourlyStates(),
      getNearestNeighbourStates(),
      getTodayVsNearestNeighbourFromHistory(),
      fetchAesoInterchangeSnapshot(),
    ]);

  const summary = summarizeDay(todayStates);
  const rows: JoinedRow[] = buildJoinedRows(todayStates, nnStates);

  const todayDateIso = todayStates[0]?.date ?? null;
  const todaysAesoRows = todayDateIso
    ? aesoRows.filter((r) => r.date === todayDateIso)
    : [];

  // Maps for "actual vs forecast" price/load and the underlying values
  const {
    priceSourceByHe,
    loadSourceByHe,
    priceValueByHe,
    loadValueByHe,
  } = buildSourceMapsForToday(todaysAesoRows);

  // Fetch HE-average wind & solar for today's date (Actual, else Most Likely)
  let windByHe = new Map<number, number | null>();
  let solarByHe = new Map<number, number | null>();
  let windSourceByHe = new Map<number, RenewableSource>();
  let solarSourceByHe = new Map<number, RenewableSource>();

  if (todayDateIso) {
    const shortTerm = await fetchShortTermHeMaps(todayDateIso);
    windByHe = shortTerm.windByHe;
    solarByHe = shortTerm.solarByHe;
    windSourceByHe = shortTerm.windSourceByHe;
    solarSourceByHe = shortTerm.solarSourceByHe;
  }

  // If we have a proper nearest-neighbour result, overwrite NN price/load
  // so the dashboard matches the /nearest-neighbour page.
  if (nnResult && nnResult.rows?.length) {
    const nnByHe = new Map(nnResult.rows.map((r) => [r.he, r]));

    for (const row of rows) {
      const hist = nnByHe.get(row.he);
      if (!hist) continue;

      row.nnPrice = hist.nnPrice;
      row.nnLoad = hist.nnLoad;
      row.rtLoad = hist.todayLoad ?? row.rtLoad;

      row.dPrice =
        row.todayPrice != null && row.nnPrice != null
          ? row.todayPrice - row.nnPrice
          : null;
      row.dLoad = hist.deltaLoad;
    }
  }

  // Override todayPrice so it always matches the WMRQH logic:
  // actual price where published, otherwise forecast price.
  for (const row of rows) {
    const val = priceValueByHe.get(row.he);
    if (val != null) {
      row.todayPrice = val;
    }
  }

  // Also override RT load with WMRQH (actual/forecast AIL) where available.
  for (const row of rows) {
    const loadVal = loadValueByHe.get(row.he);
    if (loadVal != null) {
      row.rtLoad = loadVal;
    }
  }

  // Load NN tielines from nn-history.csv (exports positive)
  if (nnResult && nnResult.nnDate) {
    const nnTielinesMap = await loadNnTielinesForDate(nnResult.nnDate);
    for (const row of rows) {
      const val = nnTielinesMap.get(row.he);
      row.nnTielines = val != null ? val : null;
    }
  }

  // Determine current HE in Alberta
  const { nowAb } = approxAlbertaNow();
  const currentHeAb = nowAb.getHours() + 1; // 0..23 → HE 1..24

  // Map today’s *current* net interchange from CSD onto the *current Alberta HE* row.
  if (csdSnapshot.systemNetInterchangeMw != null) {
    const target = rows.find((r) => r.he === currentHeAb);
    if (target) {
      target.rtTielines = csdSnapshot.systemNetInterchangeMw;
    }
  }

  // Fill RT wind/solar from HE-average short-term renewables
  if (windByHe.size || solarByHe.size) {
    for (const row of rows) {
      const w = windByHe.get(row.he);
      if (w != null) row.rtWind = w;

      const s = solarByHe.get(row.he);
      if (s != null) row.rtSolar = s;
    }
  }

  // Compute deltas where we have both sides
  for (const row of rows) {
    if (row.nnTielines != null && row.rtTielines != null) {
      row.dTielines = row.rtTielines - row.nnTielines;
    } else {
      row.dTielines = row.dTielines ?? null;
    }

    if (row.nnWind != null && row.rtWind != null) {
      row.dWind = row.rtWind - row.nnWind;
    } else {
      row.dWind = row.dWind ?? null;
    }

    if (row.nnSolar != null && row.rtSolar != null) {
      row.dSolar = row.rtSolar - row.nnSolar;
    } else {
      row.dSolar = row.dSolar ?? null;
    }
  }

  // Now compute hourly & cumulative supply deltas from components:
  //   Hourly Δ Supply = ΔWind + ΔSolar − ΔLoad − ΔTielines
  //
  // We only start accumulating once we have at least one component
  // (ΔLoad, ΔTielines, ΔWind, or ΔSolar) for that HE.
  let cumulativeSupplyDelta: number | null = null;

  for (const row of rows) {
    const hasAnyComponent =
      row.dLoad != null ||
      row.dTielines != null ||
      row.dWind != null ||
      row.dSolar != null;

    if (!hasAnyComponent) {
      row.hourlySupplyDelta = null;
      continue;
    }

    const loadDelta = row.dLoad ?? 0;
    const tielineDelta = row.dTielines ?? 0;
    const windDelta = row.dWind ?? 0;
    const solarDelta = row.dSolar ?? 0;

    const hourly = windDelta + solarDelta - loadDelta - tielineDelta;

    row.hourlySupplyDelta = hourly;

    cumulativeSupplyDelta = (cumulativeSupplyDelta ?? 0) + hourly;
    row.cumulativeSupplyDelta = cumulativeSupplyDelta;
  }

  // If we *don't* have meaningful cushionMw-based deltas (everything
  // 0 or null), fall back and use the component-based cumulative
  // supply Δ as the NN Supply Cushion Δ column.
  const hasNonTrivialCushion = rows.some(
    (r) => r.nnCushionDelta != null && Math.abs(r.nnCushionDelta) > 0.5
  );

  if (!hasNonTrivialCushion) {
    for (const row of rows) {
      if (row.cumulativeSupplyDelta != null) {
        row.nnCushionDelta = row.cumulativeSupplyDelta;
      } else {
        row.nnCushionDelta = null;
      }
    }
  }

  // --------- Build "current" snapshot for the 4 cards ---------
  const todayByHe = new Map<number, HourlyState>(
    todayStates.map((s) => [s.he, s])
  );
  const todaysAesoByHe = new Map<number, AesoActualForecastRow>(
    todaysAesoRows.map((r) => [r.he, r])
  );

  const nowState = todayByHe.get(currentHeAb);
  const nowAeso = todaysAesoByHe.get(currentHeAb);
  const currentRow = rows.find((r) => r.he === currentHeAb) || null;

  const currentCushionMw = nowState?.cushionMw ?? null;
  const currentLoadForPct =
    loadValueByHe.get(currentHeAb) ??
    nowState?.actualLoad ??
    nowState?.forecastLoad ??
    null;

  const currentCushionPercent =
    currentCushionMw != null &&
    currentLoadForPct != null &&
    currentLoadForPct !== 0
      ? currentCushionMw / currentLoadForPct
      : null;

  const currentPoolPrice = priceValueByHe.get(currentHeAb) ?? null;
  const currentNnPrice = currentRow?.nnPrice ?? null;
  const currentPriceDelta =
    currentPoolPrice != null && currentNnPrice != null
      ? currentPoolPrice - currentNnPrice
      : null;

  const currentForecastPrice = nowAeso?.forecastPoolPrice ?? null;
  const currentSmp = (nowAeso as any)?.smp ?? nowState?.smp ?? null;

  const currentActualLoad = loadValueByHe.get(currentHeAb) ?? null;
  const currentForecastLoad = nowAeso?.forecastAil ?? null;

  const currentWindMw = currentRow?.rtWind ?? null;
  const currentSolarMw = currentRow?.rtSolar ?? null;
  const currentRenewableShare =
    currentActualLoad != null &&
    currentWindMw != null &&
    currentSolarMw != null &&
    currentActualLoad !== 0
      ? (currentWindMw + currentSolarMw) / currentActualLoad
      : null;

  const currentFlag = nowState?.cushionFlag;

  // Net interchange summary for interties card
  const netInterchangeMw = csdSnapshot.systemNetInterchangeMw ?? null;
  let netInterchangeLabel: string;
  if (netInterchangeMw == null) {
    netInterchangeLabel = "Interchange unavailable";
  } else if (netInterchangeMw > 0) {
    netInterchangeLabel = `${formatNumber(
      netInterchangeMw,
      0
    )} MW net exports`;
  } else if (netInterchangeMw < 0) {
    netInterchangeLabel = `${formatNumber(
      Math.abs(netInterchangeMw),
      0
    )} MW net imports`;
  } else {
    netInterchangeLabel = "Balanced (0 MW net interchange)";
  }

  const intertieSummaries: string[] = [];
  for (const r of csdSnapshot.rows) {
    if (r.actualFlowMw == null) continue;
    const dir =
      r.actualFlowMw > 0
        ? "export"
        : r.actualFlowMw < 0
        ? "import"
        : "0 MW";
    const absVal = Math.abs(r.actualFlowMw);
    const short =
      r.path === "AB-BC" ? "BC" : r.path === "AB-SK" ? "SK" : "MATL";
    intertieSummaries.push(
      `${short} ${dir} ${formatNumber(absVal, 0)} MW`
    );
  }

  // Tightest cushion hour (for quick daily risk sense)
  let tightestHeLabel: string | null = null;
  let tightestCushionMw: number | null = null;
  for (const s of todayStates) {
    const c = s.cushionMw;
    if (c == null || Number.isNaN(c)) continue;
    if (tightestCushionMw == null || c < tightestCushionMw) {
      tightestCushionMw = c;
      tightestHeLabel = s.he.toString().padStart(2, "0");
    }
  }

  const comparisonDate =
    nnResult && nnResult.nnDate ? nnResult.nnDate : "";

  return (
    <main className="min-h-screen bg-slate-950 text-slate-100">
      <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
        <header className="mb-4">
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
            Alberta Power Trader Dashboard
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-slate-400">
            Supply cushion and nearest-neighbour view built from AESO
            Actual/Forecast WMRQH, historical NN curves, live CSD
            interchange, and short-term renewables data. No synthetic
            model curves are used on this page. Green values use AESO
            actuals; blue values use Most Likely forecast where actuals
            are not yet available.
          </p>
        </header>

        <NavTabs />

        {/* Top stats */}
        <section className="mt-4 grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          {/* 1. Current cushion vs NN */}
          <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4">
            <p className="text-xs uppercase tracking-wide text-slate-400">
              Current Cushion
            </p>
            <p className="mt-2 text-3xl font-semibold">
              {formatNumber(currentCushionMw, 0)}{" "}
              <span className="text-base font-normal text-slate-400">
                MW
              </span>
            </p>
            <p className="mt-1 text-xs text-slate-400">
              {currentCushionPercent != null
                ? `${(currentCushionPercent * 100).toFixed(1)}% of load`
                : "—"}
              {currentRow?.nnCushionDelta != null && (
                <>
                  {" "}
                  · vs NN:{" "}
                  {currentRow.nnCushionDelta > 0 ? "+" : ""}
                  {formatNumber(currentRow.nnCushionDelta, 0)} MW
                </>
              )}
            </p>
          </div>

          {/* 2. Price vs NN */}
          <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4">
            <p className="text-xs uppercase tracking-wide text-slate-400">
              Price (Pool) vs NN
            </p>
            <p className="mt-2 text-3xl font-semibold">
              {currentPoolPrice != null
                ? `$${formatNumber(currentPoolPrice, 0)}`
                : "$—"}
            </p>
            <p className="mt-1 text-xs text-slate-400">
              NN:{" "}
              {currentNnPrice != null
                ? `$${formatNumber(currentNnPrice, 0)}`
                : "—"}
              {currentPriceDelta != null && (
                <>
                  {" "}
                  · Δ{" "}
                  {currentPriceDelta > 0 ? "+" : ""}
                  {formatNumber(currentPriceDelta, 0)}
                </>
              )}
            </p>
            <p className="mt-1 text-xs text-slate-400">
              Forecast: ${formatNumber(currentForecastPrice, 0)} · SMP: $
              {formatNumber(currentSmp, 0)}
            </p>
          </div>

          {/* 3. Load & renewables share */}
          <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4">
            <p className="text-xs uppercase tracking-wide text-slate-400">
              Load & Renewables (Now)
            </p>
            <p className="mt-2 text-3xl font-semibold">
              {formatNumber(currentActualLoad, 0)}{" "}
              <span className="text-base font-normal text-slate-400">
                MW AIL
              </span>
            </p>
            <p className="mt-1 text-xs text-slate-400">
              {currentWindMw != null || currentSolarMw != null ? (
                <>
                  Wind {formatNumber(currentWindMw, 0)} MW · Solar{" "}
                  {formatNumber(currentSolarMw, 0)} MW
                  {currentRenewableShare != null && (
                    <>
                      {" "}
                      ·{" "}
                      {(currentRenewableShare * 100).toFixed(1)}% of load
                    </>
                  )}
                </>
              ) : (
                "Wind / Solar data not available for this HE"
              )}
            </p>
          </div>

          {/* 4. System status & interties */}
          <div className="flex flex-col justify-between rounded-2xl border border-slate-800 bg-slate-900/70 p-4">
            <div>
              <p className="text-xs uppercase tracking-wide text-slate-400">
                System Status & Interties
              </p>
              <div
                className={
                  "mt-2 inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-medium " +
                  cushionFlagClass(currentFlag)
                }
              >
                <span className="inline-block h-2 w-2 rounded-full bg-current" />
                {cushionFlagLabel(currentFlag)}
              </div>
              <p className="mt-2 text-xs text-slate-400">
                {netInterchangeLabel}
              </p>
              <p className="mt-1 text-[11px] text-slate-500">
                {intertieSummaries.length
                  ? intertieSummaries.join(" · ")
                  : "Path detail unavailable"}
              </p>
            </div>
            <p className="mt-3 text-xs text-slate-400">
              Peak load today: {formatNumber(summary.peakLoad, 0)} MW · Max
              price: ${formatNumber(summary.maxPrice, 0)}
              {tightestHeLabel && (
                <>
                  {" "}
                  · Tightest cushion: HE {tightestHeLabel} (
                  {formatNumber(tightestCushionMw, 0)} MW)
                </>
              )}
            </p>
          </div>
        </section>

        {/* Hourly supply cushion / NN table */}
        <section className="mt-8 rounded-2xl border border-slate-800 bg-slate-900/80 p-4">
          <div className="mb-3 flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h2 className="text-lg font-semibold tracking-tight">
                Supply Cushion vs Nearest Neighbour
              </h2>
              <p className="text-xs text-slate-400">
                Each row is an hour ending (HE). Left block shows your analogue
                day (NN) price and cushion deltas; middle blocks compare NN vs
                real-time load, tielines, and renewables; right block tracks
                hourly and cumulative supply deltas, similar to your Excel
                view.
              </p>
            </div>
            <div className="text-xs text-slate-400">
              {comparisonDate && (
                <>
                  Comparison to{" "}
                  <span className="font-mono">{comparisonDate}</span>
                </>
              )}
            </div>
          </div>

          <div className="overflow-x-auto rounded-xl border border-slate-800 bg-slate-950/40">
            <table className="min-w-full text-left text-[11px]">
              <thead className="bg-slate-900/80 uppercase tracking-wide text-slate-400">
                <tr>
                  {/* NN block */}
                  <th className="px-3 py-2 border-r border-slate-800">
                    HE (MT)
                  </th>
                  <th className="px-3 py-2">NN Price</th>
                  <th className="px-3 py-2">NN Supply Cushion Δ</th>

                  {/* Price / load block */}
                  <th className="px-3 py-2 border-l border-slate-800">
                    AESO SD Price
                  </th>
                  <th className="px-3 py-2">NN Load</th>
                  <th className="px-3 py-2">RT Load</th>
                  <th className="px-3 py-2">Δ Load</th>

                  {/* Tielines */}
                  <th className="px-3 py-2 border-l border-slate-800">
                    NN Tielines
                  </th>
                  <th className="px-3 py-2">Tielines</th>
                  <th className="px-3 py-2">Δ Tielines</th>

                  {/* Wind */}
                  <th className="px-3 py-2 border-l border-slate-800">
                    NN Wind
                  </th>
                  <th className="px-3 py-2">RT Wind</th>
                  <th className="px-3 py-2">Δ Wind</th>

                  {/* Solar */}
                  <th className="px-3 py-2 border-l border-slate-800">
                    NN Solar
                  </th>
                  <th className="px-3 py-2">RT Solar</th>
                  <th className="px-3 py-2">Δ Solar</th>

                  {/* Supply deltas */}
                  <th className="px-3 py-2 border-l border-slate-800">
                    Hourly Supply Δ
                  </th>
                  <th className="px-3 py-2">Cumulative Supply Δ</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const isCurrent = row.he === currentHeAb;

                  const priceSource = priceSourceByHe.get(row.he) ?? null;
                  const loadSource = loadSourceByHe.get(row.he) ?? null;
                  const windSource = windSourceByHe.get(row.he) ?? null;
                  const solarSource = solarSourceByHe.get(row.he) ?? null;

                  // Colour: actual = green, forecast/Most Likely = blue
                  const todayPriceClass =
                    priceSource === "actual"
                      ? "text-emerald-400"
                      : priceSource === "forecast"
                      ? "text-sky-400"
                      : "text-slate-300";

                  const rtLoadClass =
                    loadSource === "actual"
                      ? "text-emerald-400"
                      : loadSource === "forecast"
                      ? "text-sky-400"
                      : "text-slate-300";

                  const rtWindClass =
                    windSource === "actual"
                      ? "text-emerald-400"
                      : windSource === "forecast"
                      ? "text-sky-400"
                      : "text-slate-300";

                  const rtSolarClass =
                    solarSource === "actual"
                      ? "text-emerald-400"
                      : solarSource === "forecast"
                      ? "text-sky-400"
                      : "text-slate-300";

                  const loadDeltaClass =
                    row.dLoad != null && row.dLoad !== 0
                      ? row.dLoad > 0
                        ? "text-red-400"
                        : "text-emerald-400"
                      : "text-slate-300";

                  const tielineDeltaClass =
                    row.dTielines != null && row.dTielines !== 0
                      ? row.dTielines > 0
                        ? "text-emerald-400"
                        : "text-red-400"
                      : "text-slate-300";

                  const windDeltaClass =
                    row.dWind != null && row.dWind !== 0
                      ? row.dWind > 0
                        ? "text-emerald-400"
                        : "text-red-400"
                      : "text-slate-300";

                  const solarDeltaClass =
                    row.dSolar != null && row.dSolar !== 0
                      ? row.dSolar > 0
                        ? "text-emerald-400"
                        : "text-red-400"
                      : "text-slate-300";

                  const hourlySupplyClass =
                    row.hourlySupplyDelta != null &&
                    row.hourlySupplyDelta !== 0
                      ? row.hourlySupplyDelta > 0
                        ? "text-emerald-400"
                        : "text-red-400"
                      : "text-slate-300";

                  const cumulativeSupplyClass =
                    row.cumulativeSupplyDelta != null &&
                    row.cumulativeSupplyDelta !== 0
                      ? row.cumulativeSupplyDelta > 0
                        ? "text-emerald-400"
                        : "text-red-400"
                      : "text-slate-300";

                  return (
                    <tr
                      key={row.he}
                      className={
                        "border-t border-slate-800/60 " +
                        (isCurrent
                          ? "bg-slate-900/70"
                          : "hover:bg-slate-900/40")
                      }
                    >
                      {/* HE */}
                      <td className="px-3 py-2 font-medium text-slate-200">
                        {row.he.toString().padStart(2, "0")}
                      </td>

                      {/* NN price */}
                      <td className="px-3 py-2 text-slate-300">
                        {row.nnPrice != null
                          ? `$${formatNumber(row.nnPrice, 2)}`
                          : "—"}
                      </td>

                      {/* NN supply cushion delta */}
                      <td className="px-3 py-2 text-slate-300">
                        {row.nnCushionDelta != null
                          ? (row.nnCushionDelta > 0 ? "+" : "") +
                            formatNumber(row.nnCushionDelta, 0)
                          : "—"}
                      </td>

                      {/* AESO SD price (today price) – actual vs forecast colouring */}
                      <td className={"px-3 py-2 " + todayPriceClass}>
                        {row.todayPrice != null
                          ? `$${formatNumber(row.todayPrice, 2)}`
                          : "—"}
                      </td>

                      {/* Load block */}
                      <td className="px-3 py-2 text-slate-300">
                        {formatNumber(row.nnLoad, 0)}
                      </td>
                      <td className={"px-3 py-2 " + rtLoadClass}>
                        {formatNumber(row.rtLoad, 0)}
                      </td>
                      <td className={"px-3 py-2 " + loadDeltaClass}>
                        {row.dLoad != null
                          ? (row.dLoad > 0 ? "+" : "") +
                            formatNumber(row.dLoad, 0)
                          : "—"}
                      </td>

                      {/* Tielines */}
                      <td className="px-3 py-2 text-slate-300">
                        {formatNumber(row.nnTielines, 0)}
                      </td>
                      <td className="px-3 py-2 text-slate-300">
                        {formatNumber(row.rtTielines, 0)}
                      </td>
                      <td className={"px-3 py-2 " + tielineDeltaClass}>
                        {row.dTielines != null
                          ? (row.dTielines > 0 ? "+" : "") +
                            formatNumber(row.dTielines, 0)
                          : "—"}
                      </td>

                      {/* Wind */}
                      <td className="px-3 py-2 text-slate-300">
                        {formatNumber(row.nnWind, 0)}
                      </td>
                      <td className={"px-3 py-2 " + rtWindClass}>
                        {formatNumber(row.rtWind, 0)}
                      </td>
                      <td className={"px-3 py-2 " + windDeltaClass}>
                        {row.dWind != null
                          ? (row.dWind > 0 ? "+" : "") +
                            formatNumber(row.dWind, 0)
                          : "—"}
                      </td>

                      {/* Solar */}
                      <td className="px-3 py-2 text-slate-300">
                        {formatNumber(row.nnSolar, 0)}
                      </td>
                      <td className={"px-3 py-2 " + rtSolarClass}>
                        {formatNumber(row.rtSolar, 0)}
                      </td>
                      <td className={"px-3 py-2 " + solarDeltaClass}>
                        {row.dSolar != null
                          ? (row.dSolar > 0 ? "+" : "") +
                            formatNumber(row.dSolar, 0)
                          : "—"}
                      </td>

                      {/* Supply deltas */}
                      <td className={"px-3 py-2 " + hourlySupplyClass}>
                        {row.hourlySupplyDelta != null
                          ? (row.hourlySupplyDelta > 0 ? "+" : "") +
                            formatNumber(row.hourlySupplyDelta, 0)
                          : "—"}
                      </td>
                      <td className={"px-3 py-2 " + cumulativeSupplyClass}>
                        {row.cumulativeSupplyDelta != null
                          ? (row.cumulativeSupplyDelta > 0 ? "+" : "") +
                            formatNumber(row.cumulativeSupplyDelta, 0)
                          : "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </main>
  );
}
