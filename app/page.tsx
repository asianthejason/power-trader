// app/page.tsx
import NavTabs from "./components/NavTabs";
import { getTodayHourlyStates, summarizeDay } from "../lib/marketData";

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

export default async function DashboardPage() {
  const states = await getTodayHourlyStates();
  const summary = summarizeDay(states);
  const now = summary.current;

  return (
    <main className="min-h-screen bg-slate-950 text-slate-100">
      <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
        <header className="mb-4">
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
            Alberta Power Trader Dashboard
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-slate-400">
            Synthetic v1 wired to a shared market model. Replace{" "}
            <code className="rounded bg-slate-900 px-1 py-0.5 text-[11px]">
              lib/marketData.ts
            </code>{" "}
            with AESO / CAISO data to go live.
          </p>
        </header>

        <NavTabs />

        {/* Top stats */}
        <section className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4">
            <p className="text-xs uppercase tracking-wide text-slate-400">
              Current Cushion
            </p>
            <p className="mt-2 text-3xl font-semibold">
              {formatNumber(now?.cushionMw, 0)}{" "}
              <span className="text-base font-normal text-slate-400">MW</span>
            </p>
            <p className="mt-1 text-xs text-slate-400">
              {now
                ? `${(now.cushionPercent * 100).toFixed(1)}% of load`
                : "—"}
            </p>
          </div>

          <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4">
            <p className="text-xs uppercase tracking-wide text-slate-400">
              Price (Pool / SMP)
            </p>
            <p className="mt-2 text-3xl font-semibold">
              ${formatNumber(now?.actualPoolPrice, 0)}
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
              Peak load today: {formatNumber(summary.peakLoad, 0)} MW · Max price: $
              {formatNumber(summary.maxPrice, 0)}
            </p>
          </div>
        </section>

        {/* Hourly supply cushion table */}
        <section className="mt-8 rounded-2xl border border-slate-800 bg-slate-900/80 p-4">
          <div className="mb-3 flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h2 className="text-lg font-semibold tracking-tight">
                Supply Cushion vs Nearest Neighbour
              </h2>
              <p className="text-xs text-slate-400">
                Each row is an hour ending (HE). Cushion is total available
                capacity + renewables − AIL. NN columns are synthetic nearest
                neighbour values from the same model.
              </p>
            </div>
            <div className="text-xs text-slate-400">
              Date: <span className="font-mono">{summary.date}</span>
            </div>
          </div>

          <div className="overflow-x-auto rounded-xl border border-slate-800 bg-slate-950/40">
            <table className="min-w-full text-left text-xs">
              <thead className="bg-slate-900/80 text-[11px] uppercase tracking-wide text-slate-400">
                <tr>
                  <th className="px-3 py-2">HE</th>
                  <th className="px-3 py-2">Time</th>
                  <th className="px-3 py-2">Pool Price</th>
                  <th className="px-3 py-2">NN Price</th>
                  <th className="px-3 py-2">Δ Price</th>
                  <th className="px-3 py-2">AIL</th>
                  <th className="px-3 py-2">NN Load</th>
                  <th className="px-3 py-2">Δ Load</th>
                  <th className="px-3 py-2">Cushion (MW)</th>
                  <th className="px-3 py-2">Cushion %</th>
                  <th className="px-3 py-2">Flag</th>
                </tr>
              </thead>
              <tbody>
                {states.map((s) => {
                  const isCurrent = now && s.he === now.he;
                  const dPrice = s.actualPoolPrice - s.nnPrice;
                  const dLoad = s.actualLoad - s.nnLoad;
                  return (
                    <tr
                      key={s.he}
                      className={
                        "border-t border-slate-800/60 " +
                        (isCurrent ? "bg-slate-900/70" : "hover:bg-slate-900/40")
                      }
                    >
                      <td className="px-3 py-2 text-[11px] font-medium text-slate-200">
                        HE {s.he.toString().padStart(2, "0")}
                      </td>
                      <td className="px-3 py-2 text-[11px] text-slate-400">
                        {new Date(s.time).toLocaleTimeString(undefined, {
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </td>
                      <td className="px-3 py-2 text-[11px]">
                        ${formatNumber(s.actualPoolPrice, 0)}
                      </td>
                      <td className="px-3 py-2 text-[11px] text-slate-300">
                        ${formatNumber(s.nnPrice, 0)}
                      </td>
                      <td
                        className={
                          "px-3 py-2 text-[11px] " +
                          (dPrice > 0
                            ? "text-emerald-400"
                            : dPrice < 0
                            ? "text-red-400"
                            : "text-slate-300")
                        }
                      >
                        {dPrice >= 0 ? "+" : ""}
                        {formatNumber(dPrice, 0)}
                      </td>
                      <td className="px-3 py-2 text-[11px] text-slate-300">
                        {formatNumber(s.actualLoad, 0)}
                      </td>
                      <td className="px-3 py-2 text-[11px] text-slate-300">
                        {formatNumber(s.nnLoad, 0)}
                      </td>
                      <td
                        className={
                          "px-3 py-2 text-[11px] " +
                          (dLoad > 0
                            ? "text-red-400"
                            : dLoad < 0
                            ? "text-emerald-400"
                            : "text-slate-300")
                        }
                      >
                        {dLoad >= 0 ? "+" : ""}
                        {formatNumber(dLoad, 0)}
                      </td>
                      <td className="px-3 py-2 text-[11px] text-slate-300">
                        {formatNumber(s.cushionMw, 0)}
                      </td>
                      <td className="px-3 py-2 text-[11px] text-slate-300">
                        {(s.cushionPercent * 100).toFixed(1)}%
                      </td>
                      <td className="px-3 py-2 text-[11px]">
                        <span
                          className={
                            "inline-flex rounded-full border px-2 py-0.5 " +
                            cushionFlagClass(s.cushionFlag)
                          }
                        >
                          {cushionFlagLabel(s.cushionFlag)}
                        </span>
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
