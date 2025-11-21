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
 * return a map HE → average actual MW for the given date.
 *
 * We treat each row's timestamp as an instantaneous MW reading and
 * take the simple arithmetic mean of `Actual` within the hour.
 *
 * In the AESO CSV the first column is "Forecast Transaction Date",
 * e.g. "2025-11-20 10:40". We map hour 10 → HE 11, etc.
 */
function parseShortTermCsvToHeMap(
  csvText: string,
  dateIso: string
): Map<number, number | null> {
  const lines = csvText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  const map = new Map<number, number | null>();
  if (lines.length <= 1) return map;

  const headers = splitCsvLine(lines[0])
    .map((h) => h.trim().toLowerCase());

  // AESO header is "Forecast Transaction Date"
  const timeIdx = headers.findIndex(
    (h) => /date|time/i.test(h)
  );
  const actualIdx = headers.findIndex((h) => /actual/i.test(h) && !/pct/i.test(h));

  if (timeIdx === -1 || actualIdx === -1) {
    console.error(
      "Short-term renewables CSV is missing Forecast Transaction Date / Actual columns."
    );
    return map;
  }

  const buckets: Record<number, number[]> = {};

  for (let i = 1; i < lines.length; i++) {
    const cols = splitCsvLine(lines[i]).map((c) => c.trim());
    if (cols.length <= Math.max(timeIdx, actualIdx)) continue;

    const rawTime = cols[timeIdx];
    const rawActual = cols[actualIdx];

    if (!rawTime) continue;

    // First 10 characters are the date in the CSV
    const datePart = rawTime.slice(0, 10).replace(/\//g, "-");
    if (datePart !== dateIso) continue;

    const timePart = rawTime.slice(11); // "HH:MM" or "HH:MM:SS"
    const hourStr = timePart.slice(0, 2);
    const hour = Number(hourStr);
    if (!Number.isFinite(hour)) continue;

    const he = hour + 1; // hour 0..23 → HE 1..24
    if (he < 1 || he > 24) continue;

    const val = parseMw(rawActual);
    if (val == null) continue;

    if (!buckets[he]) buckets[he] = [];
    buckets[he].push(val);
  }

  for (const [heStr, arr] of Object.entries(buckets)) {
    const he = Number(heStr);
    if (!arr.length) continue;
    const avg = arr.reduce((sum, v) => sum + v, 0) / arr.length;
    map.set(he, avg);
  }

  return map;
}

/**
 * Fetch 12-hour short-term wind & solar CSVs and convert them to
 * HE-level average actual MW for the given ISO date (YYYY-MM-DD).
 *
 * Uses the same HTTP endpoints and headers as /renewables.
 */
async function fetchShortTermHeMaps(dateIso: string): Promise<{
  windByHe: Map<number, number | null>;
  solarByHe: Map<number, number | null>;
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

    const windByHe =
      windCsv.trim().length > 0
        ? parseShortTermCsvToHeMap(windCsv, dateIso)
        : new Map<number, number | null>();

    const solarByHe =
      solarCsv.trim().length > 0
        ? parseShortTermCsvToHeMap(solarCsv, dateIso)
        : new Map<number, number | null>();

    return { windByHe, solarByHe };
  } catch (err) {
    console.error("Error fetching short-term renewables:", err);
    return {
      windByHe: new Map<number, number | null>(),
      solarByHe: new Map<number, number | null>(),
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

  let cumulativeSupplyDelta = 0;

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

    const todayCushion = today.cushionMw ?? null;
    const nnCushion = nn?.cushionMw ?? null;
    let hourlySupplyDelta: number | null = null;
    if (todayCushion != null && nnCushion != null) {
      hourlySupplyDelta = todayCushion - nnCushion;
      cumulativeSupplyDelta += hourlySupplyDelta;
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
      hourlySupplyDelta,
      cumulativeSupplyDelta:
        hourlySupplyDelta != null ? cumulativeSupplyDelta : null,
    };
  });
}

/* ---------- WMRQH “actual vs forecast” source maps ---------- */

function buildSourceMapsForToday(
  allRows: AesoActualForecastRow[],
  todayStates: HourlyState[]
): {
  priceSourceByHe: Map<number, PriceSource>;
  loadSourceByHe: Map<number, PriceSource>;
  priceValueByHe: Map<number, number | null>;
} {
  const priceSourceByHe = new Map<number, PriceSource>();
  const loadSourceByHe = new Map<number, PriceSource>();
  const priceValueByHe = new Map<number, number | null>();

  if (!todayStates.length || !allRows.length) {
    return { priceSourceByHe, loadSourceByHe, priceValueByHe };
  }

  const dateIso = todayStates[0].date;
  const todaysRows = allRows.filter((r) => r.date === dateIso);

  for (const r of todaysRows) {
    let priceSource: PriceSource = null;
    let priceValue: number | null = null;
    if (r.actualPoolPrice != null) {
      priceSource = "actual";
      priceValue = r.actualPoolPrice;
    } else if (r.forecastPoolPrice != null) {
      priceSource = "forecast";
      priceValue = r.forecastPoolPrice;
    }

    let loadSource: PriceSource = null;
    if (r.actualAil != null) {
      loadSource = "actual";
    } else if (r.forecastAil != null) {
      loadSource = "forecast";
    }

    priceSourceByHe.set(r.he, priceSource);
    loadSourceByHe.set(r.he, loadSource);
    priceValueByHe.set(r.he, priceValue);
  }

  return { priceSourceByHe, loadSourceByHe, priceValueByHe };
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
  const now = summary.current;

  const rows: JoinedRow[] = buildJoinedRows(todayStates, nnStates);

  // Fetch HE-average actual wind & solar for today's date
  const todayDateIso = todayStates[0]?.date;
  let windByHe = new Map<number, number | null>();
  let solarByHe = new Map<number, number | null>();

  if (todayDateIso) {
    const shortTerm = await fetchShortTermHeMaps(todayDateIso);
    windByHe = shortTerm.windByHe;
    solarByHe = shortTerm.solarByHe;
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

  // Build “actual vs forecast” source maps for today’s side
  const {
    priceSourceByHe,
    loadSourceByHe,
    priceValueByHe,
  } = buildSourceMapsForToday(aesoRows, todayStates);

  // Override todayPrice so it always matches the WMRQH logic:
  // actual price where published, otherwise forecast price.
  for (const row of rows) {
    const val = priceValueByHe.get(row.he);
    if (val != null) {
      row.todayPrice = val;
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

  // Map today’s *current* net interchange from CSD onto the *current Alberta HE* row.
  const { nowAb } = approxAlbertaNow();
  const currentHeAb = nowAb.getHours() + 1; // 0..23 → HE 1..24

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
      row.dTielines = null;
    }

    if (row.nnWind != null && row.rtWind != null) {
      row.dWind = row.rtWind - row.nnWind;
    } else {
      row.dWind = null;
    }

    if (row.nnSolar != null && row.rtSolar != null) {
      row.dSolar = row.rtSolar - row.nnSolar;
    } else {
      row.dSolar = null;
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
            model curves are used on this page.
          </p>
        </header>

        <NavTabs />

        {/* Top stats */}
        <section className="mt-4 grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4">
            <p className="text-xs uppercase tracking-wide text-slate-400">
              Current Cushion
            </p>
            <p className="mt-2 text-3xl font-semibold">
              {formatNumber(now?.cushionMw, 0)}{" "}
              <span className="text-base font-normal text-slate-400">
                MW
              </span>
            </p>
            <p className="mt-1 text-xs text-slate-400">
              {now && Number.isFinite(now.cushionPercent)
                ? `${(now.cushionPercent * 100).toFixed(1)}% of load`
                : "—"}
            </p>
          </div>

          <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4">
            <p className="text-xs uppercase tracking-wide text-slate-400">
              Price (Pool / SMP)
            </p>
            <p className="mt-2 text-3xl font-semibold">
              $
              {formatNumber(
                now?.actualPoolPrice ?? now?.forecastPoolPrice ?? null,
                0
              )}
            </p>
            <p className="mt-1 text-xs text-slate-400">
              Forecast: ${formatNumber(now?.forecastPoolPrice, 0)} · SMP: $
              {formatNumber(now?.smp, 0)}
            </p>
          </div>

          <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4">
            <p className="text-xs uppercase tracking-wide text-slate-400">
              Load (AIL)
            </p>
            <p className="mt-2 text-3xl font-semibold">
              {formatNumber(now?.actualLoad, 0)}{" "}
              <span className="text-base font-normal text-slate-400">
                MW
              </span>
            </p>
            <p className="mt-1 text-xs text-slate-400">
              Forecast: {formatNumber(now?.forecastLoad, 0)} MW
            </p>
          </div>

          <div className="flex flex-col justify-between rounded-2xl border border-slate-800 bg-slate-900/70 p-4">
            <div>
              <p className="text-xs uppercase tracking-wide text-slate-400">
                System Status
              </p>
              <div
                className={
                  "mt-2 inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-medium " +
                  cushionFlagClass(now?.cushionFlag)
                }
              >
                <span className="inline-block h-2 w-2 rounded-full bg-current" />
                {cushionFlagLabel(now?.cushionFlag)}
              </div>
            </div>
            <p className="mt-3 text-xs text-slate-400">
              Peak load today: {formatNumber(summary.peakLoad, 0)} MW · Max
              price: ${formatNumber(summary.maxPrice, 0)}
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
                  const isCurrent = now && row.he === now.he;

                  const priceSource =
                    priceSourceByHe.get(row.he) ?? null;
                  const loadSource = loadSourceByHe.get(row.he) ?? null;

                  // Colour: actual = green, forecast = blue
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

                      {/* NN supply cushion delta (cumulative) */}
                      <td className="px-3 py-2 text-slate-300">
                        {row.cumulativeSupplyDelta != null
                          ? formatNumber(row.cumulativeSupplyDelta, 0)
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
                      <td className="px-3 py-2 text-slate-300">
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
                      <td className="px-3 py-2 text-slate-300">
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
