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

/* ---------- AESO Actual / Forecast WMRQH integration ---------- */

type AesoActualForecastRow = {
  he: number; // 1..24
  forecastPoolPrice: number;
  actualPoolPrice: number;
  forecastAil: number;
  actualAil: number;
};

/**
 * Fetches AESO Actual/Forecast WMRQH CSV and returns rows keyed by HE.
 * Uses Date column like "11/18/2025 01" → HE = 1.
 */
async function fetchAesoActualForecastToday(): Promise<AesoActualForecastRow[]> {
  try {
    const url =
      "https://ets.aeso.ca/ets_web/ip/Market/Reports/ActualForecastWMRQHReportServlet?contentType=csv";

    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) {
      console.error("AESO ActualForecast fetch failed:", res.status, res.statusText);
      return [];
    }

    const text = await res.text();
    const lines = text.split(/\r?\n/).map((l) => l.trim());
    if (lines.length < 2) return [];

    // Find header row (line that contains "Forecast Pool Price")
    const headerIndex = lines.findIndex((l) =>
      l.toLowerCase().includes("forecast pool price")
    );
    if (headerIndex === -1) {
      console.error("AESO header row not found");
      return [];
    }

    const header = lines[headerIndex].split(",");
    const findIndex = (frag: string) =>
      header.findIndex((h) => h.toLowerCase().includes(frag));

    const idxDate = findIndex("date");
    const idxFp = findIndex("forecast pool");
    const idxAp = findIndex("actual posted pool");
    const idxFa = findIndex("forecast ail");
    const idxAa = findIndex("actual ail");

    if (
      idxDate === -1 ||
      idxFp === -1 ||
      idxAp === -1 ||
      idxFa === -1 ||
      idxAa === -1
    ) {
      console.error("AESO header mismatch:", header);
      return [];
    }

    const rows: AesoActualForecastRow[] = [];

    for (let i = headerIndex + 1; i < lines.length; i++) {
      const line = lines[i];
      if (!line || !line.includes(",")) continue;

      const parts = line.split(",");

      const dateRaw = parts[idxDate]?.trim();
      if (!dateRaw) continue;

      // Example: "11/18/2025 01" → hour = "01" → HE 1
      const pieces = dateRaw.split(/\s+/);
      if (pieces.length < 2) continue;
      const hourStr = pieces[1];
      const he = parseInt(hourStr, 10);
      if (!Number.isFinite(he)) continue;

      const toNum = (idx: number) => {
        const v = parts[idx]?.replace(/[$,]/g, "").trim();
        const n = parseFloat(v);
        return Number.isFinite(n) ? n : NaN;
      };

      rows.push({
        he,
        forecastPoolPrice: toNum(idxFp),
        actualPoolPrice: toNum(idxAp),
        forecastAil: toNum(idxFa),
        actualAil: toNum(idxAa),
      });
    }

    const byHe = new Map<number, AesoActualForecastRow>();
    for (const r of rows) {
      if (r.he >= 1 && r.he <= 24 && !byHe.has(r.he)) byHe.set(r.he, r);
    }

    return Array.from(byHe.values()).sort((a, b) => a.he - b.he);
  } catch (err) {
    console.error("Error parsing AESO ActualForecast:", err);
    return [];
  }
}

/* ---------- Public functions used by pages ---------- */

export async function getTodayHourlyStates(): Promise<HourlyState[]> {
  const now = new Date();
  const synthetic = buildSyntheticDay(now, "today");

  const realRows = await fetchAesoActualForecastToday();
  if (realRows.length === 0) {
    // All synthetic if we couldn't fetch real data
    return synthetic;
  }

  const byHe = new Map<number, AesoActualForecastRow>();
  realRows.forEach((r) => {
    if (r.he >= 1 && r.he <= 24 && !byHe.has(r.he)) byHe.set(r.he, r);
  });

  return synthetic.map((state) => {
    const row = byHe.get(state.he);
    if (!row) return state;

    const oldLoad = state.actualLoad;

    const actualLoad = Number.isFinite(row.actualAil)
      ? Math.round(row.actualAil)
      : state.actualLoad;
    const forecastLoad = Number.isFinite(row.forecastAil)
      ? Math.round(row.forecastAil)
      : state.forecastLoad;

    // Adjust cushion to be consistent with new actual load
    const deltaLoad = actualLoad - oldLoad;
    const cushionMw = state.cushionMw - deltaLoad;
    const cushionPercent =
      actualLoad > 0 ? cushionMw / actualLoad : state.cushionPercent;
    const cushionFlag = classifyCushion(cushionPercent);

    return {
      ...state,
      forecastPoolPrice: Number.isFinite(row.forecastPoolPrice)
        ? Math.round(row.forecastPoolPrice)
        : state.forecastPoolPrice,
      actualPoolPrice: Number.isFinite(row.actualPoolPrice)
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
