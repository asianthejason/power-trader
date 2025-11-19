// lib/marketData.ts

export type CushionFlag = "tight" | "watch" | "comfortable" | "unknown";

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

  // Nearest neighbour “reference” (synthetic for now)
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
};

export type DailySummary = {
  date: string;
  current: HourlyState | null;
  peakLoad: number;
  maxPrice: number;
  minCushion: number;
  avgCushionPct: number;
};

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
  return 50 + (0.20 - Math.min(pct, 0.2)) * 150;
}

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
    let loadBase = 9000 + 1800 * Math.sin(angle - Math.PI / 2); // low at night, high late afternoon
    // Weekend-ish tweak for nearest neighbour
    if (variant === "nearest") {
      loadBase *= 0.97;
    }

    const rand = (seed: number) => {
      // lightweight deterministic-ish pseudo-random based on hour
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

    // Total available capability (very rough)
    const baseAvail = actualLoad * 1.12 + 500; // 12% + a bit of margin
    const outageFactor = 0.04 + 0.02 * rand(5); // 4-6% outages
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
    const tightFactor = Math.max(0, 0.12 - cushionPct); // bigger when tight
    const bcImportCap = 800;
    const skImportCap = 250;
    const matlImportCap = 300;

    const bcSched = 200 + tightFactor * 400; // more imports when tight
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

    // Capability by fuel (split the totalAvailable across fuels)
    const capability: CapabilityByFuel[] = [];
    let remainingAvail = totalAvailable;
    let remainingOut = outageMw;

    fuelTypes.forEach((fuel, idx) => {
      const share =
        idx === fuelTypes.length - 1
          ? 1
          : 0.1 + 0.15 * rand(20 + idx); // random-ish mix

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
    });
  }

  return result;
}

export async function getTodayHourlyStates(): Promise<HourlyState[]> {
  const now = new Date();
  return buildSyntheticDay(now, "today");
}

export async function getNearestNeighbourStates(): Promise<HourlyState[]> {
  const ref = new Date();
  ref.setDate(ref.getDate() - 14); // two weeks ago as a fake NN
  return buildSyntheticDay(ref, "nearest");
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
