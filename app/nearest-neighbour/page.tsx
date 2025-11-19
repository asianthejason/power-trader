// app/nearest-neighbour/page.tsx
import NavTabs from "../components/NavTabs";
import {
  getTodayHourlyStates,
  getNearestNeighbourStates,
} from "../../lib/marketData";

export const revalidate = 60;

function formatNumber(n: number | null | undefined, decimals = 0) {
  if (n == null || Number.isNaN(n)) return "—";
  return n.toLocaleString(undefined, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

export default async function NearestNeighbourPage() {
  const today = await getTodayHourlyStates();
  const nn = await getNearestNeighbourStates();

  return (
    <main className="min-h-screen bg-slate-950 text-slate-100">
      <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
        <header className="mb-4">
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
            Nearest Neighbour Analysis
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-slate-400">
            Compares today&apos;s synthetic load and price profile to a
            &quot;nearest&quot; historical day. In your real build, this would
            use AESO history to pick the best matching day based on forecast
            load, renewables, and calendar effects.
          </p>
        </header>

        <NavTabs />

        <section className="rounded-2xl border border-slate-800 bg-slate-900/80 p-4">
          <h2 className="mb-2 text-sm font-semibold tracking-tight text-slate-200">
            Today vs Nearest Neighbour (HE 1–24)
          </h2>
          <div className="overflow-x-auto rounded-xl border border-slate-800 bg-slate-950/40">
            <table className="min-w-full text-left text-xs">
              <thead className="bg-slate-900/80 text-[11px] uppercase tracking-wide text-slate-400">
                <tr>
                  <th className="px-3 py-2">HE</th>
                  <th className="px-3 py-2">Today Price</th>
                  <th className="px-3 py-2">NN Price</th>
                  <th className="px-3 py-2">Δ Price</th>
                  <th className="px-3 py-2">Today Load</th>
                  <th className="px-3 py-2">NN Load</th>
                  <th className="px-3 py-2">Δ Load</th>
                  <th className="px-3 py-2">Today Cushion</th>
                  <th className="px-3 py-2">NN Cushion (synthetic)</th>
                </tr>
              </thead>
              <tbody>
                {today.map((t, idx) => {
                  const n = nn[idx];
                  const dPrice = t.actualPoolPrice - (n?.actualPoolPrice ?? 0);
                  const dLoad = t.actualLoad - (n?.actualLoad ?? 0);
                  return (
                    <tr
                      key={t.he}
                      className="border-t border-slate-800/60 hover:bg-slate-900/40"
                    >
                      <td className="px-3 py-2 text-[11px] font-medium text-slate-200">
                        HE {t.he.toString().padStart(2, "0")}
                      </td>
                      <td className="px-3 py-2 text-[11px]">
                        ${formatNumber(t.actualPoolPrice, 0)}
                      </td>
                      <td className="px-3 py-2 text-[11px] text-slate-300">
                        ${formatNumber(n?.actualPoolPrice, 0)}
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
                        {formatNumber(t.actualLoad, 0)}
                      </td>
                      <td className="px-3 py-2 text-[11px] text-slate-300">
                        {formatNumber(n?.actualLoad, 0)}
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
                        {formatNumber(t.cushionMw, 0)} MW
                      </td>
                      <td className="px-3 py-2 text-[11px] text-slate-300">
                        {formatNumber(n?.cushionMw, 0)} MW
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="mt-3 text-[11px] text-slate-500">
            Replace the synthetic nearest-neighbour generator in{" "}
            <code className="rounded bg-slate-950 px-1 py-0.5">
              getNearestNeighbourStates()
            </code>{" "}
            with a similarity search over historical AESO days.
          </p>
        </section>
      </div>
    </main>
  );
}
