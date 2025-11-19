// lib/marketData.ts

/* ===================== Shared types ===================== */

export type CushionFlag = "tight" | "watch" | "comfortable" | "unknown";
export type DataSource = "synthetic" | "aeso+synthetic";

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

  // Prices
  forecastPoolPrice: number;
  actualPoolPrice: number;
  smp: number;

  // Load
  forecastLoad: number;
  actualLoad: number;

  // Nearest neighbour “reference”
  nnPrice: number;
  nnLoad: number;

  // Supply cushion (derived)
  cushionMw: number;
  cushionPercent: number;
  cushionFlag: CushionFlag;

  // Renewables
  windForecast: number;
  windActual: number;
  solarForecast: number;
  solarActual: number;

  // Interties
  interties: IntertieSnapshot[];

  // Capability breakdown by fuel
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
/*  Synthetic model helpers (used by dashboard, nearest neighbour, etc)
/* ------------------------------------------------------------------ */

function classifyCushion(pct: number): CushionFlag {
  if (!Number.isFinite(pct) || pct <= 0) return "unknown";
  if (pct < 0.06) return "tight";
  if (pct < 0.12) return "watch";
  return "comfortable";
}

function priceFromCushionPct(pct: number): number {
  // Very rough synthetic price curve just for demo
  if (pct < 0.03) return 800 + (0.03 - pct) * 8000;
  if (pct < 0.06) return 400 + (0.06 - pct) * 4000;
  if (pct < 0.12) return 120 + (0.12 - pct) * 800;
  return 50 + (0.2 - Math.min(pct, 0.2)) * 150;
}

/* ---------- Synthetic day builder ---------- */

function buildSyntheticDay(date: Date, variant: "today" | "nearest"): HourlyState[] {
  const base = new Date(date);
  base.setHours(0, 0, 0, 0);

  const fuelTypes = ["SC", "CC", "COGEN", "HYDRO", "WIND", "SOLAR", "OTHER"];
  const result: HourlyState[] = [];

  for (let he = 1; he <= 24; he++) {
    const t = new Date(base);
    t.setHours(he);

    const angle = ((he - 1) / 24) * Math.PI * 2;

    // Base load shape
    let loadBase = 9000 + 1800 * Math.sin(angle - Math.PI / 2);
    if (variant === "nearest") loadBase *= 0.97;

    const rand = (seed: number) => {
      const x = Math.sin(seed * 999 + he * 77) * 10000;
      return x - Math.floor(x);
    };

    const forecastLoad = loadBase * (1 + (rand(1) - 0.5) * 0.02);
    const actualLoad =
      variant === "today"
        ? forecastLoad * (1 + (rand(2) - 0.5) * 0.04)
        : forecastLoad;

    // Renewables
    const windForecast = 800 + 400 * Math.sin(angle - Math.PI / 3);
    const windActual =
      variant === "today"
        ? windForecast * (1 + (rand(3) - 0.5) * 0.2)
        : windForecast;

    const solarShape = Math.max(0, Math.sin(angle - Math.PI / 2));
    const solarForecast = 600 * solarShape;
    const solarActual =
      variant === "today"
        ? solarForecast * (1 + (rand(4) - 0.5) * 0.15)
        : solarForecast;

    // Total available capability (rough)
    const baseAvail = actualLoad * 1.12 + 500;
    const outageFactor = 0.04 + 0.02 * rand(5);
    const outageMw = baseAvail * outageFactor;
    const totalAvailable = baseAvail - outageMw + windActual + solarActual;

    const cushionMw = totalAvailable - actualLoad;
    const cushionPct = cushionMw / actualLoad;
    const cushionFlag = classifyCushion(cushionPct);

    const price = priceFromCushionPct(cushionPct);
    const smp = price * (0.9 + 0.2 * rand(6));
    const forecastPrice =
      price * (variant === "today" ? 0.95 + 0.1 * rand(7) : 0.9 + 0.1 * rand(7));

    // Interties (AB-BC, AB-SK, AB-MATL)
    const tightFactor = Math.max(0, 0.12 - cushionPct);
    const bcImportCap = 800;
    const skImportCap = 250;
    const matlImportCap = 300;

    const bcSched = 200 + tightFactor * 400;
    const skSched = 50 + tightFactor * 150;
    const matlSched = 80 + tightFactor * 180;

    const interties: IntertieSnapshot[] = [
      {
        path: "AB-BC",
        importCap: bcImportCap,
        exportCap: 800,
        scheduled: bcSched,
        actualFlow: bcSched * (0.95 + 0.1 * rand(8)),
      },
      {
        path: "AB-SK",
        importCap: skImportCap,
        exportCap: 250,
        scheduled: skSched,
        actualFlow: skSched * (0.95 + 0.1 * rand(9)),
      },
      {
        path: "AB-MATL",
        importCap: matlImportCap,
        exportCap: 300,
        scheduled: matlSched,
        actualFlow: matlSched * (0.95 + 0.1 * rand(10)),
      },
    ];

    // Capability by fuel
    const capability: CapabilityByFuel[] = [];
    let remainingAvail = totalAvailable;
    let remainingOut = outageMw;

    fuelTypes.forEach((fuel, idx) => {
      const share =
        idx === fuelTypes.length - 1
          ? 1
          : 0.1 + 0.15 * rand(20 + idx);

      const fuelAvail =
        idx === fuelTypes.length - 1 ? remainingAvail : totalAvailable * share;
      const fuelOut =
        idx === fuelTypes.length - 1 ? remainingOut : outageMw * share;

      remainingAvail -= fuelAvail;
      remainingOut -= fuelOut;

      capability.push({
        fuel,
        availableMw: Math.max(0, Math.round(fuelAvail)),
        outageMw: Math.max(0, Math.round(fuelOut)),
      });
    });

    const iso = t.toISOString().slice(0, 19);
    const dateStr = iso.slice(0, 10);

    result.push({
      time: iso,
      date: dateStr,
      he,
      forecastPoolPrice: Math.round(forecastPrice),
      actualPoolPrice: Math.round(price),
      smp: Math.round(smp),
      forecastLoad: Math.round(forecastLoad),
      actualLoad: Math.round(actualLoad),
      nnPrice:
        variant === "today"
          ? Math.round(price * (0.9 + 0.1 * rand(11)))
          : Math.round(price),
      nnLoad:
        variant === "today"
          ? Math.round(actualLoad * (0.96 + 0.03 * rand(12)))
          : Math.round(actualLoad),
      cushionMw: Math.round(cushionMw),
      cushionPercent: cushionPct,
      cushionFlag,
      windForecast: Math.round(windForecast),
      windActual: Math.round(windActual),
      solarForecast: Math.round(solarForecast),
      solarActual: Math.round(solarActual),
      interties,
      capability,
      dataSource: "synthetic",
    });
  }

  return result;
}

/* ------------------------------------------------------------------ */
/*  AESO Actual / Forecast WMRQH CSV helpers (for load-forecast page) */
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
/*  Public functions used by the rest of the site (synthetic model)   */
/* ------------------------------------------------------------------ */

/**
 * Dashboard-style “today” view.
 * Still primarily synthetic, but if AESO data is available for **today**
 * we overlay the real load/price onto the synthetic cushion model.
 */
export async function getTodayHourlyStates(): Promise<HourlyState[]> {
  const now = new Date();
  const synthetic = buildSyntheticDay(now, "today");

  // Approximate Alberta date (UTC-7). Good enough for lab/demo.
  const nowAb = new Date(now.getTime() - 7 * 60 * 60 * 1000);
  const todayAbIso = nowAb.toISOString().slice(0, 10);

  const { rows } = await fetchAesoActualForecastRows();
  if (!rows.length) {
    return synthetic;
  }

  const todaysRows = rows.filter((r) => r.date === todayAbIso);
  if (!todaysRows.length) {
    return synthetic;
  }

  const byHe = new Map<number, AesoActualForecastRow>();
  for (const r of todaysRows) {
    if (r.he >= 1 && r.he <= 24 && !byHe.has(r.he)) {
      byHe.set(r.he, r);
    }
  }

  return synthetic.map((state) => {
    const row = byHe.get(state.he);
    if (!row) return state;

    const oldLoad = state.actualLoad;

    const actualLoad =
      row.actualAil != null ? Math.round(row.actualAil) : state.actualLoad;
    const forecastLoad =
      row.forecastAil != null ? Math.round(row.forecastAil) : state.forecastLoad;

    const deltaLoad = actualLoad - oldLoad;
    const cushionMw = state.cushionMw - deltaLoad;
    const cushionPercent =
      actualLoad > 0 ? cushionMw / actualLoad : state.cushionPercent;
    const cushionFlag = classifyCushion(cushionPercent);

    return {
      ...state,
      forecastPoolPrice:
        row.forecastPoolPrice != null
          ? Number(row.forecastPoolPrice.toFixed(2))
          : state.forecastPoolPrice,
      actualPoolPrice:
        row.actualPoolPrice != null
          ? Number(row.actualPoolPrice.toFixed(2))
          : state.actualPoolPrice,
      forecastLoad,
      actualLoad,
      cushionMw,
      cushionPercent,
      cushionFlag,
      dataSource: "aeso+synthetic",
    };
  });
}

export async function getNearestNeighbourStates(): Promise<HourlyState[]> {
  const ref = new Date();
  ref.setDate(ref.getDate() - 14); // pretend NN is two weeks ago
  const synthetic = buildSyntheticDay(ref, "nearest");
  // nearest neighbour stays synthetic for now
  return synthetic;
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
    avgCushionPct: sumCushionPct / states.length,
  };
}
