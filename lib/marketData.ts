// lib/marketData.ts

/* ===================== Core synthetic model types ===================== */

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

/* ===================== Helpers ===================== */

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

/* ===================== Synthetic day builder ===================== */

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

/* ===================== AESO Actual/Forecast WMRQH (CSV) ===================== */
/* This section is used by the Load & Price Forecast page only. */

export type AesoActualForecastRow = {
  dateYMD: string; // 2025-11-19
  he: number; // 1..24
  forecastPoolPrice: number | null;
  actualPoolPrice: number | null;
  forecastAil: number | null;
  actualAil: number | null;
};

export type AesoActualForecastMeta = {
  httpStatus: number;
  parsedRowCount: number;
  availableDates: string[]; // all distinct YYYY-MM-DD in the file
};

export type AesoLoadForecastDay = {
  dateYMD: string;
  rows: AesoActualForecastRow[];
  meta: AesoActualForecastMeta;
};

function parseCsvLine(line: string): string[] {
  const trimmed = line.trim();
  if (!trimmed) return [];

  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    const inner = trimmed.slice(1, -1);
    return inner.split('","');
  }

  return trimmed.split(",");
}

function parseNumericField(raw: string | undefined): number | null {
  if (!raw) return null;
  const s = raw.trim();
  if (!s || s === "-" || s === "—") return null;
  const cleaned = s.replace(/[$,]/g, "");
  const n = parseFloat(cleaned);
  return Number.isFinite(n) ? n : null;
}

async function fetchAesoActualForecastCsv(): Promise<{
  rows: AesoActualForecastRow[];
  meta: AesoActualForecastMeta;
}> {
  const url =
    "http://ets.aeso.ca/ets_web/ip/Market/Reports/ActualForecastWMRQHReportServlet?contentType=csv";

  try {
    const res = await fetch(url, { cache: "no-store" });
    const httpStatus = res.status;

    if (!res.ok) {
      console.error("AESO ActualForecastWMRQH fetch failed:", res.status, res.statusText);
      return {
        rows: [],
        meta: { httpStatus, parsedRowCount: 0, availableDates: [] },
      };
    }

    const text = await res.text();
    const lines = text.split(/\r?\n/);

    const rows: AesoActualForecastRow[] = [];

    const dateRegex = /^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2})$/;

    for (const rawLine of lines) {
      const parts = parseCsvLine(rawLine);
      if (parts.length < 1) continue;

      const dateField = parts[0].trim();
      const match = dateField.match(dateRegex);
      if (!match) continue;

      const month = parseInt(match[1], 10);
      const day = parseInt(match[2], 10);
      const year = parseInt(match[3], 10);
      const he = parseInt(match[4], 10);

      if (!Number.isFinite(year) || !Number.isFinite(he) || he < 1 || he > 24) {
        continue;
      }

      const mm = month.toString().padStart(2, "0");
      const dd = day.toString().padStart(2, "0");
      const dateYMD = `${year}-${mm}-${dd}`;

      const forecastPoolPrice = parseNumericField(parts[1]);
      const actualPoolPrice = parseNumericField(parts[2]);
      const forecastAil = parseNumericField(parts[3]);
      const actualAil = parseNumericField(parts[4]);

      rows.push({
        dateYMD,
        he,
        forecastPoolPrice,
        actualPoolPrice,
        forecastAil,
        actualAil,
      });
    }

    const availableDates = Array.from(
      new Set(rows.map((r) => r.dateYMD))
    ).sort();

    const meta: AesoActualForecastMeta = {
      httpStatus,
      parsedRowCount: rows.length,
      availableDates,
    };

    console.log("[AESO WMRQH] Parsed summary:", {
      httpStatus,
      parsedRowCount: rows.length,
      availableDates,
    });

    return { rows, meta };
  } catch (err) {
    console.error("Error fetching/parsing AESO ActualForecastWMRQH:", err);
    return {
      rows: [],
      meta: { httpStatus: 0, parsedRowCount: 0, availableDates: [] },
    };
  }
}

/**
 * Returns all dates present in the AESO Actual/Forecast WMRQH CSV,
 * grouped as one `AesoLoadForecastDay` per date, sorted by date.
 */
export async function getAllAesoLoadForecastDays(): Promise<AesoLoadForecastDay[]> {
  const { rows, meta } = await fetchAesoActualForecastCsv();
  if (rows.length === 0) return [];

  const byDate = new Map<string, AesoActualForecastRow[]>();

  for (const r of rows) {
    if (!byDate.has(r.dateYMD)) {
      byDate.set(r.dateYMD, []);
    }
    byDate.get(r.dateYMD)!.push(r);
  }

  const dates = Array.from(byDate.keys()).sort();

  return dates.map((dateYMD) => {
    const dayRows = byDate.get(dateYMD)!;
    dayRows.sort((a, b) => a.he - b.he);
    return {
      dateYMD,
      rows: dayRows,
      meta,
    };
  });
}

/* ===================== Public synthetic functions used by other pages ===================== */

export async function getTodayHourlyStates(): Promise<HourlyState[]> {
  const now = new Date();
  // Dashboard & other pages stay synthetic for now.
  return buildSyntheticDay(now, "today");
}

export async function getNearestNeighbourStates(): Promise<HourlyState[]> {
  const ref = new Date();
  ref.setDate(ref.getDate() - 14); // pretend NN is two weeks ago
  const synthetic = buildSyntheticDay(ref, "nearest");
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
