// lib/marketData.ts

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

/* ---------- Helpers ---------- */

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

/* ---------- Synthetic day builder (for dashboard / NN pages) ---------- */

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
        idx === fuelTypes.length - 1 ? 1 : 0.1 + 0.15 * rand(20 + idx);

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

/* ---------- AESO Actual / Forecast WMRQH parsing ---------- */

export type AesoActualForecastRow = {
  dateYMD: string; // "2025-11-19"
  he: number; // 1–24
  forecastPoolPrice: number | null;
  actualPoolPrice: number | null;
  forecastAil: number | null;
  actualAil: number | null;
};

export type AesoActualForecastMeta = {
  httpStatus: number;
  lineCount: number;
  parsedRowCount: number;
  reportDateText?: string;
  availableDates: string[]; // YYYY-MM-DD
};

type ParsedAesoResult = {
  rows: AesoActualForecastRow[];
  meta: AesoActualForecastMeta;
};

function parseMaybeNumber(s: string): number | null {
  const trimmed = s.trim();
  if (!trimmed || trimmed === "-" || trimmed === '"-"') return null;
  const cleaned = trimmed.replace(/[$,]/g, "");
  const n = parseFloat(cleaned);
  return Number.isFinite(n) ? n : null;
}

/**
 * Low-level fetch + CSV parse for AESO Actual/Forecast WMRQH.
 * Returns ALL rows in the file (possibly multiple dates).
 */
async function fetchAesoActualForecastCsv(): Promise<ParsedAesoResult> {
  const url =
    "http://ets.aeso.ca/ets_web/ip/Market/Reports/ActualForecastWMRQHReportServlet?contentType=csv";

  try {
    const res = await fetch(url, { cache: "no-store" });
    const status = res.status;
    const text = await res.text();

    const lines = text.split(/\r?\n/);
    let reportDateText: string | undefined;

    const dataLines: string[] = [];

    for (const raw of lines) {
      const line = raw.trim();
      if (!line) continue;

      // Capture the "November 19, 2025." line
      if (
        !reportDateText &&
        /[A-Za-z]+\s+\d{1,2},\s+\d{4}/.test(line.replace(/"/g, ""))
      ) {
        reportDateText = line.replace(/[".]/g, "").trim();
      }

      // Data lines look like: "11/19/2025 01","33.53","-","10,192","-","-"
      if (line.startsWith('"') && line.includes(",")) {
        dataLines.push(line);
      }
    }

    const rows: AesoActualForecastRow[] = [];

    for (const line of dataLines) {
      // Strip outer quotes then split on "," boundaries
      const stripped = line.replace(/^"+|"+$/g, "");
      const parts = stripped.split('","');
      if (parts.length < 5) continue;

      const dateTime = parts[0]; // e.g. 11/19/2025 01
      const [mdy, heStr] = dateTime.split(/\s+/);
      if (!mdy || !heStr) continue;

      const he = parseInt(heStr, 10);
      if (!Number.isFinite(he) || he < 1 || he > 24) continue;

      const [mStr, dStr, yStr] = mdy.split("/");
      if (!mStr || !dStr || !yStr) continue;

      const dateYMD = `${yStr}-${mStr.padStart(2, "0")}-${dStr.padStart(
        2,
        "0"
      )}`;

      const forecastPoolPrice = parseMaybeNumber(parts[1] ?? "");
      const actualPoolPrice = parseMaybeNumber(parts[2] ?? "");
      const forecastAil = parseMaybeNumber(parts[3] ?? "");
      const actualAil = parseMaybeNumber(parts[4] ?? "");

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
      httpStatus: status,
      lineCount: lines.length,
      parsedRowCount: rows.length,
      reportDateText,
      availableDates,
    };

    console.log("[AESO WMRQH] meta:", meta);

    return { rows, meta };
  } catch (err) {
    console.error("Error fetching/parsing AESO Actual/Forecast WMRQH:", err);
    return {
      rows: [],
      meta: {
        httpStatus: 0,
        lineCount: 0,
        parsedRowCount: 0,
        availableDates: [],
      },
    };
  }
}

function scoreRow(r: AesoActualForecastRow): number {
  let score = 0;
  if (r.forecastPoolPrice != null) score++;
  if (r.actualPoolPrice != null) score++;
  if (r.forecastAil != null) score++;
  if (r.actualAil != null) score++;
  return score;
}

/**
 * Collapse multiple rows per HE into a single "best" row for a given date.
 */
function buildDayForDate(
  rowsAll: AesoActualForecastRow[],
  meta: AesoActualForecastMeta,
  dateYMD: string
): AesoLoadForecastDay | null {
  const candidates = rowsAll.filter((r) => r.dateYMD === dateYMD);
  if (candidates.length === 0) return null;

  const byHe = new Map<number, AesoActualForecastRow>();

  for (const r of candidates) {
    const existing = byHe.get(r.he);
    if (!existing || scoreRow(r) > scoreRow(existing)) {
      byHe.set(r.he, r);
    }
  }

  const rows = Array.from(byHe.values()).sort((a, b) => a.he - b.he);

  return {
    dateYMD,
    rows,
    meta,
  };
}

/* ---------- Public AESO API for the Load Forecast page ---------- */

export type AesoLoadForecastDay = {
  dateYMD: string;
  rows: AesoActualForecastRow[];
  meta: AesoActualForecastMeta;
};

/**
 * Get a cleaned day for the Load & Price Forecast page.
 * - If dateYMD is provided and present in the CSV, use it.
 * - Otherwise, use the **latest** date in the AESO file.
 */
export async function getAesoLoadForecastDay(
  dateYMD?: string
): Promise<AesoLoadForecastDay | null> {
  const { rows, meta } = await fetchAesoActualForecastCsv();
  if (rows.length === 0 || meta.availableDates.length === 0) {
    return null;
  }

  const available = meta.availableDates;
  let target = dateYMD && available.includes(dateYMD)
    ? dateYMD
    : available[available.length - 1]; // latest date in the file

  const day = buildDayForDate(rows, meta, target);
  if (!day) return null;

  console.log("[AESO WMRQH] using date", target, "with", day.rows.length, "rows");
  return day;
}

/* ---------- Blended synthetic + AESO for the dashboard ---------- */

async function fetchAesoActualForecastToday(): Promise<
  Map<number, AesoActualForecastRow>
> {
  const { rows, meta } = await fetchAesoActualForecastCsv();
  if (rows.length === 0 || meta.availableDates.length === 0) {
    return new Map();
  }

  // "Today" for modelling = latest date present in the file
  const latest = meta.availableDates[meta.availableDates.length - 1];
  const day = buildDayForDate(rows, meta, latest);
  if (!day) return new Map();

  const byHe = new Map<number, AesoActualForecastRow>();
  for (const r of day.rows) {
    const existing = byHe.get(r.he);
    if (!existing || scoreRow(r) > scoreRow(existing)) {
      byHe.set(r.he, r);
    }
  }
  return byHe;
}

export async function getTodayHourlyStates(): Promise<HourlyState[]> {
  const now = new Date();
  const synthetic = buildSyntheticDay(now, "today");

  const byHe = await fetchAesoActualForecastToday();
  if (byHe.size === 0) {
    return synthetic;
  }

  return synthetic.map((state) => {
    const row = byHe.get(state.he);
    if (!row) return state;

    const oldLoad = state.actualLoad;

    const actualLoad =
      row.actualAil != null ? Math.round(row.actualAil) : state.actualLoad;
    const forecastLoad =
      row.forecastAil != null ? Math.round(row.forecastAil) : state.forecastLoad;

    // Adjust cushion to be consistent with new actual load
    const deltaLoad = actualLoad - oldLoad;
    const cushionMw = state.cushionMw - deltaLoad;
    const cushionPercent =
      actualLoad > 0 ? cushionMw / actualLoad : state.cushionPercent;
    const cushionFlag = classifyCushion(cushionPercent);

    return {
      ...state,
      forecastPoolPrice:
        row.forecastPoolPrice != null
          ? Math.round(row.forecastPoolPrice)
          : state.forecastPoolPrice,
      actualPoolPrice:
        row.actualPoolPrice != null
          ? Math.round(row.actualPoolPrice)
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
