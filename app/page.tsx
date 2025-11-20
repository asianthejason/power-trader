// app/page.tsx
import NavTabs from "./components/NavTabs";
import {
  getTodayHourlyStates,
  getNearestNeighbourStates,
  getTodayVsNearestNeighbourFromHistory,
  summarizeDay,
  type HourlyState,
} from "../lib/marketData";

export const revalidate = 60; // regenerate at most once per minute

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

/**
 * Sum net intertie flow (MW) on an HourlyState.
 * Positive = exports from Alberta, negative = imports.
 */
function sumTielines(s: HourlyState | null | undefined): number | null {
  if (!s || !Array.isArray(s.interties) || s.interties.length === 0) {
    return null;
  }
  const total = s.interties.reduce(
    (acc, p) => acc + (p.actualFlow ?? 0),
    0
  );
  return Number.isFinite(total) ? total : null;
}

/**
 * Build joined rows that look like the Excel "Supply Cushion" tab:
 * NN vs real-time values plus hourly / cumulative deltas.
 *
 * At this stage the NN side is still fed by getNearestNeighbourStates
 * (legacy; currently today-only). We later overwrite NN price/load with the
 * real nearest-neighbour history so those columns match /nearest-neighbour.
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

    const nnLoad = nn?.actualLoad ?? null;
    const rtLoad = today.actualLoad ?? null;
    const dLoad =
      nnLoad != null && rtLoad != null ? rtLoad - nnLoad : null;

    const nnTielines = sumTielines(nn);
    const rtTielines = sumTielines(today);
    const dTielines =
      nnTielines != null && rtTielines != null
        ? rtTielines - nnTielines
        : null;

    const nnWind = nn?.windActual ?? null;
    const rtWind = today.windActual ?? null;
    const dWind =
      nnWind != null && rtWind != null ? rtWind - nnWind : null;

    const nnSolar = nn?.solarActual ?? null;
    const rtSolar = today.solarActual ?? null;
    const dSolar =
      nnSolar != null && rtSolar != null ? rtSolar - nnSolar : null;

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
      nnTielines,
      rtTielines,
      dTielines,
      nnWind,
      rtWind,
      dWind,
      nnSolar,
      rtSolar,
      dSolar,
      hourlySupplyDelta,
      cumulativeSupplyDelta:
        hourlySupplyDelta != null ? cumulativeSupplyDelta : null,
    };
  });
}

export default async function DashboardPage() {
  const [todayStates, nnStates, nnResult] = await Promise.all([
    getTodayHourlyStates(),
    getNearestNeighbourStates(),
    getTodayVsNearestNeighbourFromHistory(),
  ]);

  const summary = summarizeDay(todayStates);
  const now = summary.current;

  const rows: JoinedRow[] = buildJoinedRows(todayStates, nnStates);

  // If we have a proper nearest-neighbour result, overwrite NN price/load
  // so the dashboard matches the /nearest-neighbour page.
  if (nnResult && nnResult.rows?.length) {
    const nnByHe = new Map(nnResult.rows.map((r) => [r.he, r]));

    for (const row of rows) {
      const hist = nnByHe.get(row.he);
      if (!hist) continue;

      // Use NN price from history
      row.nnPrice = hist.nnPrice;

      // Use NN load and today load from the same dataset
      row.nnLoad = hist.nnLoad;
      row.rtLoad = hist.todayLoad ?? row.rtLoad;

      // Recompute deltas based on those values
      row.dPrice =
        row.todayPrice != null && row.nnPrice != null
          ? row.todayPrice - row.nnPrice
          : null;
      row.dLoad = hist.deltaLoad;
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
            Actual/Forecast WMRQH and your analogue day selection. No
            synthetic model data is used on this page.
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
              <span className="text-base font-normal text-slate-400">MW</span>
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
              <span className="text-base font-normal text-slate-400">MW</span>
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
                real-time load, tielines, wind, and solar; right block tracks
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

                  const priceDeltaClass =
                    row.dPrice != null && row.dPrice !== 0
                      ? row.dPrice > 0
                        ? "text-emerald-400"
                        : "text-red-400"
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

                      {/* AESO SD price (today price) */}
                      <td className={"px-3 py-2 " + priceDeltaClass}>
                        {row.todayPrice != null
                          ? `$${formatNumber(row.todayPrice, 2)}`
                          : "—"}
                      </td>

                      {/* Load block */}
                      <td className="px-3 py-2 text-slate-300">
                        {formatNumber(row.nnLoad, 0)}
                      </td>
                      <td className="px-3 py-2 text-slate-300">
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
