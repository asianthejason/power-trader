// app/load-forecast/page.tsx
import NavTabs from "../components/NavTabs";
import { getTodayHourlyStates, summarizeDay } from "../../lib/marketData";

export const revalidate = 60;

function formatNumber(n: number | null | undefined, decimals = 0) {
  if (n == null || Number.isNaN(n)) return "—";
  return n.toLocaleString(undefined, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

export default async function LoadForecastPage() {
  const states = await getTodayHourlyStates();
  const summary = summarizeDay(states);
  const now = summary.current;

  const nowHe = now?.he ?? 0;

  const aesoRows = states.filter((s) => s.dataSource === "aeso+synthetic").length;
  const hasAeso = aesoRows > 0;

  return (
    <main className="min-h-screen bg-slate-950 text-slate-100">
      <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
        <header className="mb-4">
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
            Load &amp; Price Forecast
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-slate-400">
            For hours already completed (HE ≤ current), we use actual AIL and
            price; for future hours we show the synthetic forecast. This mirrors
            your Excel &quot;Use Actual&quot; flags.
          </p>

          {/* Data source / debug banner */}
          <div className="mt-3 inline-flex flex-wrap items-center gap-3 rounded-xl border border-slate-800 bg-slate-900/80 px-3 py-2 text-[11px] text-slate-300">
            <div className="flex items-center gap-2">
              <span className="inline-flex h-2 w-2 rounded-full bg-emerald-400" />
              <span className="font-mono uppercase tracking-wide">
                Source:
              </span>
              <span className="font-mono text-emerald-300">
                {hasAeso
                  ? "AESO ActualForecastWMRQH + synthetic model"
                  : "Synthetic only (no AESO rows for today)"}
              </span>
            </div>
            <div className="h-3 w-px bg-slate-700" />
            <div className="font-mono text-slate-400">
              AESO-backed rows today:{" "}
              <span className="text-slate-100">
                {aesoRows} / {states.length || 24}
              </span>
            </div>
          </div>
        </header>

        <NavTabs />

        <section className="rounded-2xl border border-slate-800 bg-slate-900/80 p-4">
          <div className="mb-2 text-xs text-slate-400">
            Current HE:{" "}
            <span className="font-mono">
              {nowHe ? `HE ${nowHe.toString().padStart(2, "0")}` : "—"}
            </span>
          </div>

          <div className="overflow-x-auto rounded-xl border border-slate-800 bg-slate-950/40">
            <table className="min-w-full text-left text-xs">
              <thead className="bg-slate-900/80 text-[11px] uppercase tracking-wide text-slate-400">
                <tr>
                  <th className="px-3 py-2">HE</th>
                  <th className="px-3 py-2">Forecast AIL</th>
                  <th className="px-3 py-2">Actual AIL</th>
                  <th className="px-3 py-2">Use Actual</th>
                  <th className="px-3 py-2">Forecast Price</th>
                  <th className="px-3 py-2">Actual Price</th>
                  <th className="px-3 py-2">Use Actual Price</th>
                </tr>
              </thead>
              <tbody>
                {states.map((s) => {
                  const useActual = s.he <= nowHe;
                  const useActualPrice = s.he <= nowHe;

                  return (
                    <tr
                      key={s.he}
                      className={
                        "border-t border-slate-800/60 " +
                        (useActual ? "bg-slate-900/70" : "hover:bg-slate-900/40")
                      }
                    >
                      <td className="px-3 py-2 text-[11px] font-medium text-slate-200">
                        HE {s.he.toString().padStart(2, "0")}
                      </td>
                      <td className="px-3 py-2 text-[11px] text-slate-300">
                        {formatNumber(s.forecastLoad, 0)}
                      </td>
                      <td className="px-3 py-2 text-[11px] text-slate-300">
                        {formatNumber(s.actualLoad, 0)}
                      </td>
                      <td className="px-3 py-2 text-[11px]">
                        {useActual ? "TRUE" : "FALSE"}
                      </td>
                      <td className="px-3 py-2 text-[11px] text-slate-300">
                        ${formatNumber(s.forecastPoolPrice, 0)}
                      </td>
                      <td className="px-3 py-2 text-[11px] text-slate-300">
                        ${formatNumber(s.actualPoolPrice, 0)}
                      </td>
                      <td className="px-3 py-2 text-[11px]">
                        {useActualPrice ? "TRUE" : "FALSE"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <p className="mt-3 text-[11px] text-slate-500">
            When AESO data is available, Forecast/Actual AIL and prices are
            pulled from the Actual/Forecast WMRQH report and overlaid onto the
            synthetic curve. The banner above shows how many hours are currently
            using AESO values.
          </p>
        </section>
      </div>
    </main>
  );
}
