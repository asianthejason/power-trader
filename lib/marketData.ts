/* ===================== Shared types ===================== */

export type CushionFlag = "tight" | "watch" | "comfortable" | "unknown";

// Keep old literals for now so other parts of the app don't break,
// but new code will use only "aeso".
export type DataSource = "synthetic" | "aeso+synthetic" | "aeso";

export type IntertieSnapshot = {
  path: "AB-BC" | "AB-SK" | "AB-MATL";
  importCap: number;
  exportCap: number;
  scheduled: number;
  actualFlow: number;
};

export type CapabilityByFuel = {
  fuel: string;
  availableMw: number;
  outageMw: number;
};

export type HourlyState = {
  time: string; // ISO
  date: string; // YYYY-MM-DD
  he: number; // 1..24

  // Prices (from AESO where available)
  forecastPoolPrice: number;
  actualPoolPrice: number;
  smp: number; // currently not populated from real data yet

  // Load (from AESO where available)
  forecastLoad: number;
  actualLoad: number;

  // Nearest neighbour “reference” (not wired yet, placeholder only)
  nnPrice: number;
  nnLoad: number;

  // Supply cushion (not wired yet; derived once we have real capability)
  cushionMw: number;
  cushionPercent: number;
  cushionFlag: CushionFlag;

  // Renewables (not wired yet)
  windForecast: number;
  windActual: number;
  solarForecast: number;
  solarActual: number;

  // Interties (not wired yet)
  interties: IntertieSnapshot[];

  // Capability breakdown by fuel (not wired yet)
  capability: CapabilityByFuel[];

  // Where this row ultimately came from
  dataSource: DataSource;
};

export type DailySummary = {
  date: string;
  current: HourlyState | null;
  peakLoad: number;
  maxPrice: number;
  minCushion: number;
  avgCushionPct: number;
};

/* ------------------------------------------------------------------ */
/*  Cushion helpers (kept for when we have real supply/capability)    */
/* ------------------------------------------------------------------ */

function classifyCushion(pct: number): CushionFlag {
  if (!Number.isFinite(pct) || pct <= 0) return "unknown";
  if (pct < 0.06) return "tight";
  if (pct < 0.12) return "watch";
  return "comfortable";
}

/* ------------------------------------------------------------------ */
/*  AESO Actual / Forecast WMRQH CSV helpers                          */
/* ------------------------------------------------------------------ */

export const AESO_ACTUAL_FORECAST_CSV_URL =
  "http://ets.aeso.ca/ets_web/ip/Market/Reports/ActualForecastWMRQHReportServlet?contentType=csv";

export type AesoActualForecastRow = {
  date: string; // YYYY-MM-DD (report date)
  he: number; // 1..24
  forecastPoolPrice: number | null;
  actualPoolPrice: number | null;
  forecastAil: number | null;
  actualAil: number | null;
};

export type AesoForecastDebug = {
  ok: boolean;
  httpStatus: number;
  lineCount: number;
  parsedRowCount: number;
  reportDates: string[];
  sampleLines: string[];
  errorMessage?: string;
};

// Parse "11/19/2025 01" -> { dateIso: "2025-11-19", he: 1 }
function parseMdyHe(field: string): { dateIso: string; he: number } | null {
  const m = field.match(/^(\d{1,2})\/(\\d{1,2})\/(\d{4})\s+(\d{1,2})$/);
  if (!m) return null;
  const month = Number(m[1]);
  const day = Number(m[2]);
  const year = Number(m[3]);
  const he = Number(m[4]);
  if (!Number.isFinite(he) || he < 1 || he > 24) return null;

  const mm = month.toString().padStart(2, "0");
  const dd = day.toString().padStart(2, "0");
  const dateIso = `${year}-${mm}-${dd}`;
  return { dateIso, he };
}

function csvToFields(line: string): string[] {
  const fields: string[] = [];
  const re = /"([^"]*)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(line)) !== null) {
    fields.push(m[1]);
  }
  return fields;
}

function toNumOrNull(s: string): number | null {
  const cleaned = s.replace(/[$,]/g, "").trim();
  if (!cleaned || cleaned === "-" || cleaned === "--") return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

/**
 * Fetches the AESO Actual/Forecast WMRQH CSV and returns all rows
 * (possibly multiple report dates in a single file).
 */
export async function fetchAesoActualForecastRows(): Promise<{
  rows: AesoActualForecastRow[];
  debug: AesoForecastDebug;
}> {
  let httpStatus = 0;
  let text: string | null = null;

  try {
    const res = await fetch(AESO_ACTUAL_FORECAST_CSV_URL, {
      cache: "no-store",
    });
    httpStatus = res.status;
    if (!res.ok) {
      return {
        rows: [],
        debug: {
          ok: false,
          httpStatus,
          lineCount: 0,
          parsedRowCount: 0,
          reportDates: [],
          sampleLines: [],
          errorMessage: `HTTP ${res.status} ${res.statusText}`,
        },
      };
    }
    text = await res.text();
  } catch (err: any) {
    return {
      rows: [],
      debug: {
        ok: false,
        httpStatus,
        lineCount: 0,
        parsedRowCount: 0,
        reportDates: [],
        sampleLines: [],
        errorMessage: String(err?.message ?? err),
      },
    };
  }

  if (!text) {
    return {
      rows: [],
      debug: {
        ok: false,
        httpStatus,
        lineCount: 0,
        parsedRowCount: 0,
        reportDates: [],
        sampleLines: [],
        errorMessage: "Empty response from AESO",
      },
    };
  }

  const lines = text.split(/\r?\n/);
  const rows: AesoActualForecastRow[] = [];
  const dates = new Set<string>();

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    // Data rows are fully quoted, header rows are not.
    if (!trimmed.startsWith('"')) continue;

    const fields = csvToFields(trimmed);
    if (fields.length < 5) continue;

    const dt = parseMdyHe(fields[0]);
    if (!dt) continue;

    const { dateIso, he } = dt;
    dates.add(dateIso);

    const forecastPoolPrice = toNumOrNull(fields[1] ?? "");
    const actualPoolPrice = toNumOrNull(fields[2] ?? "");
    const forecastAil = toNumOrNull(fields[3] ?? "");
    const actualAil = toNumOrNull(fields[4] ?? "");

    rows.push({
      date: dateIso,
      he,
      forecastPoolPrice,
      actualPoolPrice,
      forecastAil,
      actualAil,
    });
  }

  const sampleLines: string[] = [];
  for (const line of lines) {
    if (line.trim()) sampleLines.push(line.slice(0, 200));
    if (sampleLines.length >= 12) break;
  }

  return {
    rows,
    debug: {
      ok: true,
      httpStatus,
      lineCount: lines.length,
      parsedRowCount: rows.length,
      reportDates: Array.from(dates).sort(),
      sampleLines,
    },
  };
}

/* ------------------------------------------------------------------ */
/*  Public functions used by the rest of the site                     */
/* ------------------------------------------------------------------ */

/**
 * Convert a set of AESO rows for a single report date into HourlyState[]
 * with **no synthetic modelling**.
 *
 * Fields we do not yet have real data for are filled with neutral placeholders
 * (0 / empty arrays / "unknown") and will be wired to real sources later.
 */
function rowsToHourlyStates(rows: AesoActualForecastRow[]): HourlyState[] {
  if (!rows.length) return [];

  const dateIso = rows[0].date;

  // Sort by HE just to be safe
  const sorted = [...rows].sort((a, b) => a.he - b.he);

  return sorted.map((r) => {
    const [year, month, day] = r.date.split("-").map((x) => Number(x));
    // Interpret HE as "hour ending" in local time; we model it as the
    // clock time at the end of the hour (01:00 for HE1, .., 24:00 → next day 00:00).
    const heHour = r.he;
    const dt = new Date(year, month - 1, day, heHour);
    const iso = dt.toISOString().slice(0, 19);

    const forecastLoad = r.forecastAil ?? 0;
    const actualLoad = r.actualAil ?? 0;
    const forecastPrice = r.forecastPoolPrice ?? 0;
    const actualPrice = r.actualPoolPrice ?? 0;

    // Cushion and other fields will be wired up once we have:
    // - Supply Adequacy / capability feeds
    // - Intertie ATC / schedules
    // - Wind/solar forecasts and actuals
    const cushionMw = 0;
    const cushionPercent = 0;
    const cushionFlag: CushionFlag = "unknown";

    return {
      time: iso,
      date: dateIso,
      he: r.he,

      forecastPoolPrice: forecastPrice,
      actualPoolPrice: actualPrice,
      smp: 0, // to be wired from CSMPrice or similar

      forecastLoad,
      actualLoad,

      nnPrice: 0,
      nnLoad: 0,

      cushionMw,
      cushionPercent,
      cushionFlag,

      windForecast: 0,
      windActual: 0,
      solarForecast: 0,
      solarActual: 0,

      interties: [],
      capability: [],

      dataSource: "aeso",
    };
  });
}

/**
 * Dashboard-style “today” view built **only from AESO WMRQH**.
 *
 * - No synthetic fallback.
 * - If today's Alberta date is not present in the CSV, we fall back to the
 *   latest report date available from AESO.
 */
export async function getTodayHourlyStates(): Promise<HourlyState[]> {
  const { rows } = await fetchAesoActualForecastRows();
  if (!rows.length) return [];

  // Approximate Alberta date (UTC-7). Good enough for now.
  const now = new Date();
  const nowAb = new Date(now.getTime() - 7 * 60 * 60 * 1000);
  const todayAbIso = nowAb.toISOString().slice(0, 10);

  const todaysRows = rows.filter((r) => r.date === todayAbIso);

  if (todaysRows.length > 0) {
    return rowsToHourlyStates(todaysRows);
  }

  // If today's date is not present, use the latest report date available.
  const allDates = Array.from(new Set(rows.map((r) => r.date))).sort();
  const latestDate = allDates[allDates.length - 1];
  const latestRows = rows.filter((r) => r.date === latestDate);

  return rowsToHourlyStates(latestRows);
}

/**
 * Nearest neighbour states (legacy, for older synthetic UI pieces).
 *
 * Currently just returns today's AESO-based states so nothing breaks.
 */
export async function getNearestNeighbourStates(): Promise<HourlyState[]> {
  return getTodayHourlyStates();
}

export function summarizeDay(states: HourlyState[]): DailySummary {
  if (states.length === 0) {
    return {
      date: "",
      current: null,
      peakLoad: 0,
      maxPrice: 0,
      minCushion: 0,
      avgCushionPct: 0,
    };
  }

  const date = states[0].date;
  const now = new Date();
  let current = states[0];
  let minCushion = states[0].cushionMw;
  let peakLoad = states[0].actualLoad;
  let maxPrice = states[0].actualPoolPrice;
  let sumCushionPct = 0;

  for (const s of states) {
    const diffCur = Math.abs(new Date(s.time).getTime() - now.getTime());
    const diffPrev = Math.abs(
      new Date(current.time).getTime() - now.getTime()
    );
    if (diffCur < diffPrev) current = s;

    if (s.cushionMw < minCushion) minCushion = s.cushionMw;
    if (s.actualLoad > peakLoad) peakLoad = s.actualLoad;
    if (s.actualPoolPrice > maxPrice) maxPrice = s.actualPoolPrice;
    sumCushionPct += s.cushionPercent;
  }

  return {
    date,
    current,
    peakLoad,
    maxPrice,
    minCushion,
    avgCushionPct: states.length ? sumCushionPct / states.length : 0,
  };
}

/* ------------------------------------------------------------------ */
/*  Nearest-neighbour (today vs historical AESO data)                 */
/* ------------------------------------------------------------------ */

type PriceSource = "actual" | "forecast" | null;

type NnHour = {
  he: number;
  price: number | null;
  load: number | null;
  priceSource: PriceSource; // for "today" we label actual vs forecast
};

type NnDay = {
  date: string; // YYYY-MM-DD
  hours: NnHour[];
};

export type NearestNeighbourRow = {
  he: number;
  todayPrice: number | null;
  todayPriceSource: PriceSource;
  nnPrice: number | null;
  deltaPrice: number | null;
  todayLoad: number | null;
  nnLoad: number | null;
  deltaLoad: number | null;
};

export type NearestNeighbourResult = {
  todayDate: string; // YYYY-MM-DD (Alberta)
  nnDate: string; // YYYY-MM-DD (Alberta) – the chosen analogue day
  rows: NearestNeighbourRow[];
};

// Approx Alberta now (UTC-7)
function approxAlbertaNow(): Date {
  const nowUtc = new Date();
  return new Date(nowUtc.getTime() - 7 * 60 * 60 * 1000);
}

function toDateKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * Build today's curve (price + load by HE) from live AESO WMRQH,
 * using actuals where published and forecasts elsewhere. We also tag
 * each HE with whether price is "actual" or "forecast".
 */
async function buildTodayCurveFromWmrqh(): Promise<NnDay | null> {
  const { rows } = await fetchAesoActualForecastRows();
  if (!rows.length) return null;

  const nowAb = approxAlbertaNow();
  const todayKey = toDateKey(nowAb);

  let targetDate = todayKey;
  let todaysRows = rows.filter((r) => r.date === targetDate);

  if (!todaysRows.length) {
    // If today's date is not present, fall back to the latest report date.
    const allDates = Array.from(new Set(rows.map((r) => r.date))).sort();
    targetDate = allDates[allDates.length - 1];
    todaysRows = rows.filter((r) => r.date === targetDate);
  }

  if (!todaysRows.length) return null;

  const byHe = new Map<number, NnHour>();

  for (const r of todaysRows) {
    let price: number | null = null;
    let priceSource: PriceSource = null;

    if (r.actualPoolPrice != null) {
      price = r.actualPoolPrice;
      priceSource = "actual";
    } else if (r.forecastPoolPrice != null) {
      price = r.forecastPoolPrice;
      priceSource = "forecast";
    }

    const load = r.actualAil ?? r.forecastAil ?? null;

    byHe.set(r.he, {
      he: r.he,
      price,
      load,
      priceSource,
    });
  }

  const hours: NnHour[] = [];
  for (let he = 1; he <= 24; he++) {
    const h = byHe.get(he) ?? {
      he,
      price: null,
      load: null,
      priceSource: null as PriceSource,
    };
    hours.push(h);
  }

  return {
    date: targetDate,
    hours,
  };
}

/**
 * Load historical AESO curves from lib/data/nn-history.csv.
 * Expected header:
 *   date,he,actual_pool_price,actual_ail,hour_ahead_pool_price_forecast,
 *   export_bc,export_mt,export_sk,import_bc,import_mt,import_sk
 *
 * We only need actual_pool_price + actual_ail for NN selection.
 */
async function loadHistoricalNnDays(): Promise<NnDay[]> {
  const fs = await import("node:fs/promises");
  const path = await import("node:path");

  const filePath = path.join(
    process.cwd(),
    "lib",
    "data",
    "nn-history.csv"
  );

  const raw = await fs.readFile(filePath, "utf8");
  const lines = raw
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  if (lines.length <= 1) return [];

  const header = lines[0];
  const headers = header.split(",").map((h) => h.trim());

  const idx = (name: string) => headers.indexOf(name);

  const dateIdx = idx("date");
  const heIdx = idx("he");
  const priceIdx = idx("actual_pool_price");
  const loadIdx = idx("actual_ail");

  if (dateIdx === -1 || heIdx === -1 || priceIdx === -1 || loadIdx === -1) {
    throw new Error(
      "nn-history.csv must have at least: date,he,actual_pool_price,actual_ail columns."
    );
  }

  const byDate = new Map<string, NnHour[]>();

  const parseNum = (s: string): number | null => {
    const t = s.trim();
    if (!t) return null;
    const n = Number(t);
    return Number.isFinite(n) ? n : null;
  };

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line || line.startsWith("#")) continue;

    const cols = line.split(",");
    if (cols.length < headers.length) continue;

    const date = cols[dateIdx].trim();
    const he = Number(cols[heIdx]);
    if (!date || !Number.isFinite(he)) continue;

    const price = parseNum(cols[priceIdx]);
    const load = parseNum(cols[loadIdx]);

    const list = byDate.get(date) ?? [];
    list.push({ he, price, load, priceSource: null });
    byDate.set(date, list);
  }

  const days: NnDay[] = [];

  for (const [date, hoursRaw] of byDate.entries()) {
    const hours = [...hoursRaw].sort((a, b) => a.he - b.he);
    days.push({ date, hours });
  }

  // Sort by date ascending
  days.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

  return days;
}

/* ---------- distance helpers ---------- */

/**
 * Load-only distance (normalised MSE of AIL).
 * Used for the first-stage filter.
 */
function loadDistance(today: NnDay, hist: NnDay): number {
  const todayMap = new Map(today.hours.map((h) => [h.he, h]));
  const histMap = new Map(hist.hours.map((h) => [h.he, h]));

  // Range from today's curve so magnitudes are comparable across days.
  let minLoad = Infinity;
  let maxLoad = -Infinity;

  for (const h of today.hours) {
    if (h.load != null) {
      if (h.load < minLoad) minLoad = h.load;
      if (h.load > maxLoad) maxLoad = h.load;
    }
  }

  const loadRange =
    Number.isFinite(minLoad) && Number.isFinite(maxLoad) && maxLoad > minLoad
      ? maxLoad - minLoad
      : 1;

  let sum = 0;
  let count = 0;

  for (let he = 1; he <= 24; he++) {
    const t = todayMap.get(he);
    const h = histMap.get(he);
    if (!t || !h) continue;
    if (t.load == null || h.load == null) continue;

    const norm = (t.load - h.load) / loadRange;
    sum += norm * norm;
    count++;
  }

  if (count === 0) return Number.POSITIVE_INFINITY;
  return sum / count;
}

/**
 * Price-only distance (normalised MSE of price).
 * We weight hours where today's price is actual more heavily than forecast.
 */
function priceDistance(today: NnDay, hist: NnDay): number {
  const todayMap = new Map(today.hours.map((h) => [h.he, h]));
  const histMap = new Map(hist.hours.map((h) => [h.he, h]));

  // Range from today's price curve.
  let minPrice = Infinity;
  let maxPrice = -Infinity;

  for (const h of today.hours) {
    if (h.price != null) {
      if (h.price < minPrice) minPrice = h.price;
      if (h.price > maxPrice) maxPrice = h.price;
    }
  }

  const priceRange =
    Number.isFinite(minPrice) && Number.isFinite(maxPrice) && maxPrice > minPrice
      ? maxPrice - minPrice
      : 1;

  let sum = 0;
  let weightSum = 0;

  for (let he = 1; he <= 24; he++) {
    const t = todayMap.get(he);
    const h = histMap.get(he);
    if (!t || !h) continue;
    if (t.price == null || h.price == null) continue;

    const w = t.priceSource === "actual" ? 2 : 1; // emphasise actual hours
    const norm = (t.price - h.price) / priceRange;

    sum += w * norm * norm;
    weightSum += w;
  }

  if (weightSum === 0) return Number.POSITIVE_INFINITY;
  return sum / weightSum;
}

/**
 * Nearest-neighbour selection using a two-stage approach:
 *
 *  1. Rank all historical days by **loadDistance** (shape of AIL).
 *     Take the top K load matches (K ~ 50).
 *  2. Within that subset, pick the day with the smallest **priceDistance**,
 *     with extra weight on hours where today's price is actual.
 */
export async function getTodayVsNearestNeighbourFromHistory(): Promise<NearestNeighbourResult | null> {
  const today = await buildTodayCurveFromWmrqh();
  if (!today) return null;

  const history = await loadHistoricalNnDays();
  if (!history.length) return null;

  // Exclude today's date if present in the history file to avoid trivial self-match.
  const candidates = history.filter((d) => d.date !== today.date);
  if (!candidates.length) return null;

  // Stage 1: sort by load distance and keep top K
  const withLoad = candidates
    .map((day) => ({
      day,
      loadDist: loadDistance(today, day),
    }))
    .filter((x) => Number.isFinite(x.loadDist))
    .sort((a, b) => a.loadDist - b.loadDist);

  if (!withLoad.length) return null;

  const K = Math.min(50, withLoad.length);
  const loadTopK = withLoad.slice(0, K).map((x) => x.day);

  // Stage 2: pick best price match within loadTopK
  let best: NnDay | null = null;
  let bestPriceDist = Number.POSITIVE_INFINITY;

  for (const day of loadTopK) {
    const pd = priceDistance(today, day);
    if (!Number.isFinite(pd)) continue;
    if (pd < bestPriceDist) {
      bestPriceDist = pd;
      best = day;
    }
  }

  // Fallback: if all price distances are bad/NaN, just use best load match
  if (!best) {
    best = withLoad[0].day;
  }

  const todayMap = new Map(today.hours.map((h) => [h.he, h]));
  const nnMap = new Map(best.hours.map((h) => [h.he, h]));

  const rows: NearestNeighbourRow[] = [];

  for (let he = 1; he <= 24; he++) {
    const t = todayMap.get(he);
    const n = nnMap.get(he);

    const todayPrice = t?.price ?? null;
    const todayPriceSource = t?.priceSource ?? null;
    const nnPrice = n?.price ?? null;
    const todayLoad = t?.load ?? null;
    const nnLoad = n?.load ?? null;

    const deltaPrice =
      todayPrice != null && nnPrice != null ? todayPrice - nnPrice : null;
    const deltaLoad =
      todayLoad != null && nnLoad != null ? todayLoad - nnLoad : null;

    rows.push({
      he,
      todayPrice,
      todayPriceSource,
      nnPrice,
      deltaPrice,
      todayLoad,
      nnLoad,
      deltaLoad,
    });
  }

  return {
    todayDate: today.date,
    nnDate: best.date,
    rows,
  };
}
