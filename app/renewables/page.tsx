// app/renewables/page.tsx
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

export default async function RenewablesPage() {
  const states = await getTodayHourlyStates();
  const summary = summarizeDay(states);

  return (
    <main className="min-h-screen bg-slate-950 text-slate-100">
      <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
        <header className="mb-4">
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
            Renewables Forecast
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-slate-400">
            Hourly wind and solar forecast bands vs synthetic actuals for{" "}
            <span className="font-mono">{summary.date}</span>. In the real tool
            this would be backed by AESO&apos;s wind/solar forecast feeds and
            your own historical error stats.
          </p>
        </header>

        <NavTabs />

        <section className="grid gap-4 lg:grid-cols-2">
          {/* Solar */}
          <div className="rounded-2xl border border-slate-800 bg-slate-900/80 p-4">
            <h2 className="mb-2 text-sm font-semibold tracking-tight">
              Solar (MW)
            </h2>
            <div className="overflow-x-auto rounded-xl border border-slate-800 bg-slate-950/40">
              <table className="min-w-full text-left text-xs">
                <thead className="bg-slate-900/80 text-[11px] uppercase tracking-wide text-slate-400">
                  <tr>
                    <th className="px-3 py-2">HE</th>
                    <th className="px-3 py-2">Forecast</th>
                    <th className="px-3 py-2">Actual</th>
                    <th className="px-3 py-2">Δ (Actual − Fcst)</th>
                  </tr>
                </thead>
                <tbody>
                  {states.map((s) => {
                    const delta = s.solarActual - s.solarForecast;
                    return (
                      <tr
                        key={s.he}
                        className="border-t border-slate-800/60 hover:bg-slate-900/40"
                      >
                        <td className="px-3 py-2 text-[11px] font-medium text-slate-200">
                          HE {s.he.toString().padStart(2, "0")}
                        </td>
                        <td className="px-3 py-2 text-[11px] text-slate-300">
                          {formatNumber(s.solarForecast, 0)}
                        </td>
                        <td className="px-3 py-2 text-[11px] text-slate-300">
                          {formatNumber(s.solarActual, 0)}
                        </td>
                        <td
                          className={
                            "px-3 py-2 text-[11px] " +
                            (delta > 0
                              ? "text-emerald-400"
                              : delta < 0
                              ? "text-red-400"
                              : "text-slate-300")
                          }
                        >
                          {delta >= 0 ? "+" : ""}
                          {formatNumber(delta, 0)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Wind */}
          <div className="rounded-2xl border border-slate-800 bg-slate-900/80 p-4">
            <h2 className="mb-2 text-sm font-semibold tracking-tight">
              Wind (MW)
            </h2>
            <div className="overflow-x-auto rounded-xl border border-slate-800 bg-slate-950/40">
              <table className="min-w-full text-left text-xs">
                <thead className="bg-slate-900/80 text-[11px] uppercase tracking-wide text-slate-400">
                  <tr>
                    <th className="px-3 py-2">HE</th>
                    <th className="px-3 py-2">Forecast</th>
                    <th className="px-3 py-2">Actual</th>
                    <th className="px-3 py-2">Δ (Actual − Fcst)</th>
                  </tr>
                </thead>
                <tbody>
                  {states.map((s) => {
                    const delta = s.windActual - s.windForecast;
                    return (
                      <tr
                        key={s.he}
                        className="border-t border-slate-800/60 hover:bg-slate-900/40"
                      >
                        <td className="px-3 py-2 text-[11px] font-medium text-slate-200">
                          HE {s.he.toString().padStart(2, "0")}
                        </td>
                        <td className="px-3 py-2 text-[11px] text-slate-300">
                          {formatNumber(s.windForecast, 0)}
                        </td>
                        <td className="px-3 py-2 text-[11px] text-slate-300">
                          {formatNumber(s.windActual, 0)}
                        </td>
                        <td
                          className={
                            "px-3 py-2 text-[11px] " +
                            (delta > 0
                              ? "text-emerald-400"
                              : delta < 0
                              ? "text-red-400"
                              : "text-slate-300")
                          }
                        >
                          {delta >= 0 ? "+" : ""}
                          {formatNumber(delta, 0)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </section>

        <p className="mt-4 text-[11px] text-slate-500">
          In your real build, this page would fetch AESO wind/solar forecast
          CSVs, show Min / Most-Likely / Max bands, and drive adjustments to
          effective available supply for cushion calculations.
        </p>
      </div>
    </main>
  );
}
