// app/load-forecast/page.tsx

import NavTabs from "../components/NavTabs";
import {
  fetchAesoActualForecastRows,
  type AesoActualForecastRow,
  type AesoForecastDebug,
} from "../../lib/marketData";

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

function formatPrice(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return "$—";
  return `$${formatNumber(n, 2)}`;
}

function approxAlbertaNow() {
  const nowUtc = new Date();
  const nowAb = new Date(nowUtc.getTime() - 7 * 60 * 60 * 1000); // UTC-7
  const isoDate = nowAb.toISOString().slice(0, 10);
  // HE 01 is 00:00–01:00; approximate from hour.
  const he = ((nowAb.getHours() + 23) % 24) + 1;
  return { nowAb, isoDate, he };
}

function groupByDate(rows: AesoActualForecastRow[]): Map<string, AesoActualForecastRow[]> {
  const map = new Map<string, AesoActualForecastRow[]>();
  for (const r of rows) {
    if (!map.has(r.date)) map.set(r.date, []);
    map.get(r.date)!.push(r);
  }
  for (const [, list] of map) {
    list.sort((a, b) => a.he - b.he);
  }
  return map;
}

/* ---------- page ---------- */

export default async function LoadForecastPage() {
  const { rows, debug } = await fetchAesoActualForecastRows();
  const byDate = groupByDate(rows);
  const reportDates = Array.from(byDate.keys()).sort();

  const { isoDate: todayAbIso, he: approxHe } = approxAlbertaNow();
  const hasData = rows.length > 0;

  return (
    <main className="min-h-screen bg-slate-950 text-slate-100">
      <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
        <header className="mb-4 space-y-2">
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
            Load &amp; Price Forecast
          </h1>
          <p className="max-w-2xl text-sm text-slate-400">
            Pure AESO data from the Actual/Forecast WMRQH report. All dates
            present in the CSV are shown below, one section per report date.
            For any hour where AESO has published actuals, the actual
            columns are populated; otherwise only the forecast columns
            show values. No synthetic modelling is used on this page.
          </p>
        </header>

        <NavTabs />

        {/* Source / debug banner */}
        <section className="mt-4 rounded-2xl border border-emerald-900 bg-emerald-950/40 px-4 py-3 text-xs text-emerald-100">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div className="space-y-1">
              <div className="inline-flex items-center gap-2 rounded-full bg-emerald-900/70 px-3 py-1 text-[11px] font-medium">
                <span className="h-2 w-2 rounded-full bg-emerald-400" />
                <span>SOURCE: AESO ActualForecastWMRQH (CSV)</span>
              </div>
              <div className="text-[11px] text-emerald-200/80">
                Report dates in file:{" "}
                {debug.reportDates.length
                  ? debug.reportDates.join(", ")
                  : "none"}
                {" · "}
                HTTP: {debug.httpStatus || "n/a"}
                {" · "}
                Parsed rows: {debug.parsedRowCount}
              </div>
              <div className="text-[11px] text-emerald-300/80">
                Current HE (approx, Alberta time):{" "}
                <span className="font-mono">
                  HE {approxHe.toString().padStart(2, "0")}
                </span>{" "}
                · Today (approx, Alberta):{" "}
                <span className="font-mono">{todayAbIso}</span>
              </div>
            </div>

            <a
              href="/api/aeso/actual-forecast-csv"
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center justify-center rounded-full border border-emerald-500/70 bg-emerald-900/40 px-3 py-1.5 text-[11px] font-semibold text-emerald-100 hover:bg-emerald-800/60"
            >
              Download raw AESO CSV
            </a>
          </div>
          <p className="mt-2 text-[11px] text-emerald-200/80">
            The download button opens the original AESO Actual/Forecast WMRQH
            report in a new tab so you can verify the numbers against this page.
          </p>
        </section>

        {/* No data / error state */}
        {!hasData && (
          <section className="mt-6 rounded-2xl border border-slate-800 bg-slate-900/70 px-4 py-3 text-xs text-slate-300">
            <p className="font-medium text-slate-200">
              Unable to load AESO Actual/Forecast data right now.
            </p>
            <p className="mt-1 text-[11px] text-slate-400">
              Debug: HTTP {debug.httpStatus || 0}, parsed rows{" "}
              {debug.parsedRowCount}, dates{" "}
              {debug.reportDates.length
                ? debug.reportDates.join(", ")
                : "none"}
              {debug.errorMessage
                ? ` · error: ${debug.errorMessage}`
                : null}
            </p>
          </section>
        )}

        {/* One section per report date */}
        {reportDates.map((date) => {
          const rowsForDate = byDate.get(date)!;
          const isToday = date === todayAbIso;

          return (
            <section
              key={date}
              className="mt-6 rounded-2xl border border-slate-800 bg-slate-900/80 p-4"
            >
              <header className="mb-2 flex flex-col gap-1 sm:flex-row sm:items-baseline sm:justify-between">
                <div>
                  <h2 className="text-sm font-semibold text-slate-100">
                    Report date:{" "}
                    <span className="font-mono text-slate-50">{date}</span>
                  </h2>
                  <p className="text-[11px] text-slate-400">
                    Rows below are taken directly from the AESO
                    Actual/Forecast WMRQH CSV for this date. If a cell
                    shows &quot;—&quot;, AESO has not published a value yet
                    for that field (for example, future actuals).
                  </p>
                </div>
                {isToday && (
                  <span className="inline-flex items-center rounded-full bg-emerald-900/60 px-2 py-0.5 text-[11px] font-medium text-emerald-300">
                    today (Alberta)
                  </span>
                )}
              </header>

              <div className="overflow-x-auto rounded-xl border border-slate-800 bg-slate-950/40">
                <table className="min-w-full text-left text-xs">
                  <thead className="bg-slate-900/80 text-[11px] uppercase tracking-wide text-slate-400">
                    <tr>
                      <th className="px-3 py-2">HE</th>
                      <th className="px-3 py-2">Forecast AIL</th>
                      <th className="px-3 py-2">Actual AIL</th>
                      <th className="px-3 py-2">Use Actual</th>
                      <th className="px-3 py-2">Forecast Pool Price</th>
                      <th className="px-3 py-2">Actual Pool Price</th>
                      <th className="px-3 py-2">Use Actual Price</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rowsForDate.map((r) => {
                      const useActual = r.actualAil != null;
                      const useActualPrice = r.actualPoolPrice != null;

                      return (
                        <tr
                          key={`${date}-he-${r.he}`}
                          className="border-t border-slate-800/60 hover:bg-slate-900/50"
                        >
                          <td className="px-3 py-2 text-[11px] font-medium text-slate-200">
                            HE {r.he.toString().padStart(2, "0")}
                          </td>
                          <td className="px-3 py-2 text-[11px] text-slate-300">
                            {formatNumber(r.forecastAil, 0)}
                          </td>
                          <td className="px-3 py-2 text-[11px] text-slate-300">
                            {formatNumber(r.actualAil, 0)}
                          </td>
                          <td className="px-3 py-2 text-[11px]">
                            {useActual ? "TRUE" : "FALSE"}
                          </td>
                          <td className="px-3 py-2 text-[11px] text-slate-300">
                            {formatPrice(r.forecastPoolPrice)}
                          </td>
                          <td className="px-3 py-2 text-[11px] text-slate-300">
                            {formatPrice(r.actualPoolPrice)}
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
            </section>
          );
        })}
      </div>
    </main>
  );
}
