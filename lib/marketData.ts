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
  const m = field.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2})$/);
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
 * Nearest neighbour states.
 *
 * For now, this returns the same AESO-based states as today. Once we have
 * a proper historical data pipeline (CSD, Supply Adequacy, etc.), this will
 * be replaced with a real nearest-neighbour selection.
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
