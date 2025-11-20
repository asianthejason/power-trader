// app/nearest-neighbour/page.tsx

import NavTabs from "../components/NavTabs";
import { getTodayVsNearestNeighbourFromHistory } from "../../lib/marketData";

export const revalidate = 60;

/* ---------- small helpers ---------- */

function formatNumber(
  n: number | null | undefined,
  decimals = 0
): string {
  if (n == null || Number.isNaN(n)) return "—";
  return n.toLocaleString(undefined, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

type NearestNeighbourRow = {
  he: number;
  todayPrice: number | null;
  nnPrice: number | null;
  deltaPrice: number | null;
  todayLoad: number | null;
  nnLoad: number | null;
  deltaLoad: number | null;
};

type NearestNeighbourResult = {
  todayDate: string; // YYYY-MM-DD (Alberta)
  nnDate: string; // YYYY-MM-DD (Alberta) – the chosen analogue day
  rows: NearestNeighbourRow[];
};

export default async function NearestNeighbourPage() {
  // This helper will:
  //  - pull "today" from AESO Actual/Forecast (WMRQH)
  //  - pull historical hourly price + AIL from your offline AESO history CSV
  //  - pick the nearest-neighbour date based on the load shape
  //  - return per-HE rows with today vs NN values and deltas
  const result = (await getTodayVsNearestNeighbourFromHistory()) as
    | NearestNeighbourResult
    | null;

  return (
    <main className="min-h-screen bg-slate-950 text-slate-100">
      <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
        {/* ---------- Header ---------- */}
        <header className="mb-4">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-baseline sm:justify-between">
            <div>
              <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
                Nearest Neighbour Analysis
              </h1>
              <p className="mt-1 max-w-2xl text-sm text-slate-400">
                Compares{" "}
                <span className="font-medium text-slate-200">
                  today&apos;s AESO load and price profile
                </span>{" "}
                to a{" "}
                <span className="font-medium text-slate-200">
                  similar historical day from AESO data
                </span>
                . Today&apos;s curve is built from the AESO Actual/Forecast
                (WMRQH) report, and the analogue day is chosen from historical
                hourly pool price and AIL based on how closely its load shape
                matches today.
              </p>
            </div>

            {result && (
              <dl className="mt-2 grid gap-2 text-xs text-slate-400 sm:text-right">
                <div>
                  <dt className="inline text-slate-500">Today (Alberta): </dt>
                  <dd className="inline font-medium text-slate-200">
                    {result.todayDate || "—"}
                  </dd>
                </div>
                <div>
                  <dt className="inline text-slate-500">
                    Nearest neighbour day:{" "}
                  </dt>
                  <dd className="inline font-medium text-slate-200">
                    {result.nnDate || "—"}
                  </dd>
                </div>
              </dl>
            )}
          </div>
        </header>

        <NavTabs />

        {!result ? (
          <section className="mt-4 rounded-2xl border border-slate-800 bg-slate-900/80 p-4 text-sm text-slate-300">
            Unable to compute a nearest neighbour using the available AESO
            data. Check that:
            <ul className="mt-2 list-disc pl-5 text-xs text-slate-400">
              <li>
                The AESO Actual/Forecast (WMRQH) report is reachable for today.
              </li>
              <li>
                Your historical AESO CSV (e.g.{" "}
                <code className="rounded bg-slate-950 px-1 py-0.5">
                  lib/data/nn-history.csv
                </code>
                ) contains at least one full day of hourly pool price and AIL.
              </li>
            </ul>
          </section>
        ) : (
          <section className="mt-4 rounded-2xl border border-slate-800 bg-slate-900/80 p-4">
            <h2 className="mb-2 text-sm font-semibold tracking-tight text-slate-200">
              Today vs Nearest Neighbour (HE 1–24)
            </h2>
            <p className="mb-3 text-[11px] text-slate-400">
              For each hour ending (HE) this table compares today&apos;s{" "}
              <span className="font-medium text-slate-200">
                best-known price
              </span>{" "}
              (actual where published, otherwise forecast) and{" "}
              <span className="font-medium text-slate-200">
                best-known AIL
              </span>{" "}
              against the selected historical analogue day from AESO&apos;s
              hourly pool price &amp; AIL history.
            </p>

            <div className="overflow-x-auto rounded-xl border border-slate-800 bg-slate-950/40">
              <table className="min-w-full text-left text-xs">
                <thead className="bg-slate-900/80 text-[11px] uppercase tracking-wide text-slate-400">
                  <tr>
                    <th className="px-3 py-2">HE</th>
                    <th className="px-3 py-2">Today Price</th>
                    <th className="px-3 py-2">NN Price</th>
                    <th className="px-3 py-2">Δ Price</th>
                    <th className="px-3 py-2">Today Load (AIL)</th>
                    <th className="px-3 py-2">NN Load (AIL)</th>
                    <th className="px-3 py-2">Δ Load</th>
                  </tr>
                </thead>
                <tbody>
                  {result.rows.map((row) => {
                    const dPrice = row.deltaPrice ?? null;
                    const dLoad = row.deltaLoad ?? null;

                    const priceClass =
                      dPrice == null
                        ? "text-slate-300"
                        : dPrice > 0
                        ? "text-emerald-400"
                        : dPrice < 0
                        ? "text-red-400"
                        : "text-slate-300";

                    const loadClass =
                      dLoad == null
                        ? "text-slate-300"
                        : dLoad > 0
                        ? "text-red-400"
                        : dLoad < 0
                        ? "text-emerald-400"
                        : "text-slate-300";

                    return (
                      <tr
                        key={row.he}
                        className="border-t border-slate-800/60 hover:bg-slate-900/40"
                      >
                        <td className="px-3 py-2 text-[11px] font-medium text-slate-200">
                          HE {row.he.toString().padStart(2, "0")}
                        </td>
                        <td className="px-3 py-2 text-[11px]">
                          {row.todayPrice == null
                            ? "—"
                            : `$${formatNumber(row.todayPrice, 0)}`}
                        </td>
                        <td className="px-3 py-2 text-[11px] text-slate-300">
                          {row.nnPrice == null
                            ? "—"
                            : `$${formatNumber(row.nnPrice, 0)}`}
                        </td>
                        <td className={`px-3 py-2 text-[11px] ${priceClass}`}>
                          {dPrice == null
                            ? "—"
                            : `${dPrice >= 0 ? "+" : ""}${formatNumber(
                                dPrice,
                                0
                              )}`}
                        </td>
                        <td className="px-3 py-2 text-[11px] text-slate-300">
                          {formatNumber(row.todayLoad, 0)}
                        </td>
                        <td className="px-3 py-2 text-[11px] text-slate-300">
                          {formatNumber(row.nnLoad, 0)}
                        </td>
                        <td className={`px-3 py-2 text-[11px] ${loadClass}`}>
                          {dLoad == null
                            ? "—"
                            : `${dLoad >= 0 ? "+" : ""}${formatNumber(
                                dLoad,
                                0
                              )}`}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <p className="mt-3 text-[11px] text-slate-500">
              Data sources (no synthetic values): today&apos;s curve comes from
              the AESO <span className="font-medium">Actual / Forecast</span>{" "}
              (WMRQH) report, using actuals where published and forecasts
              elsewhere. The nearest-neighbour curve is selected from historical
              hourly pool price and AIL (for example, the AESO &quot;Hourly
              Metered Volumes and Pool Price and AIL&quot; data you trimmed
              into your local history file), based purely on similarity of the
              load shape.
            </p>
          </section>
        )}
      </div>
    </main>
  );
}
