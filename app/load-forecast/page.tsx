// app/load-forecast/page.tsx
import NavTabs from "../components/NavTabs";
import {
  getAllAesoLoadForecastDays,
  AesoActualForecastRow,
  AesoLoadForecastDay,
} from "../../lib/marketData";

export const revalidate = 60;

function formatNumber(n: number | null | undefined, decimals = 0) {
  if (n == null || Number.isNaN(n)) return "—";
  return n.toLocaleString(undefined, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

function formatPrice(n: number | null | undefined) {
  if (n == null || Number.isNaN(n)) return "$—";
  return `$${formatNumber(n, 2)}`;
}

function getApproxAlbertaHe() {
  // Roughly assume Alberta is UTC-7 (MST).
  const nowUtc = new Date();
  const albertaMs = nowUtc.getTime() - 7 * 60 * 60 * 1000;
  const alberta = new Date(albertaMs);
  const he = alberta.getHours() + 1; // HE 01 covers 00:00–00:59, etc.
  return Math.max(1, Math.min(24, he));
}

function getApproxAlbertaDateYMD() {
  const nowUtc = new Date();
  const albertaMs = nowUtc.getTime() - 7 * 60 * 60 * 1000;
  const alberta = new Date(albertaMs);
  const y = alberta.getFullYear();
  const m = (alberta.getMonth() + 1).toString().padStart(2, "0");
  const d = alberta.getDate().toString().padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export default async function LoadForecastPage() {
  const days: AesoLoadForecastDay[] = await getAllAesoLoadForecastDays();
  const currentHeApprox = getApproxAlbertaHe();
  const albertaToday = getApproxAlbertaDateYMD();

  const meta = days[0]?.meta;
  const availableDates = meta?.availableDates ?? [];

  return (
    <main className="min-h-screen bg-slate-950 text-slate-100">
      <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
        <header className="mb-4">
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
            Load &amp; Price Forecast
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-slate-400">
            Pure AESO data from the Actual/Forecast WMRQH report. All dates
            present in the CSV are shown below, one section per report date.
            For any hour where AESO has published actuals, the actual columns
            are populated; otherwise only the forecast columns show values. No
            synthetic modelling is used on this page.
          </p>
        </header>

        <NavTabs />

        <section className="mb-4 rounded-2xl border border-emerald-900/60 bg-emerald-950/40 px-4 py-3 text-xs text-emerald-200">
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center rounded-full bg-emerald-900/70 px-2 py-0.5 text-[11px] font-medium uppercase tracking-wide">
              ● Source: AESO ActualForecastWMRQH (CSV)
            </span>
            {meta && (
              <>
                <span className="text-emerald-300">
                  Report dates in file:{" "}
                  {availableDates.length
                    ? availableDates.join(", ")
                    : "—"}
                </span>
                <span className="text-emerald-300">
                  {" "}
                  | HTTP: {meta.httpStatus} | Parsed rows:{" "}
                  {meta.parsedRowCount}
                </span>
              </>
            )}
          </div>

          <div className="mt-1 text-slate-300">
            Current HE (approx, Alberta time):{" "}
            <span className="font-mono">
              HE {currentHeApprox.toString().padStart(2, "0")}
            </span>
          </div>
          <div className="mt-1 text-slate-400">
            Today (approx, Alberta):{" "}
            <span className="font-mono">{albertaToday}</span>
          </div>
        </section>

        {days.length === 0 ? (
          <section className="rounded-2xl border border-slate-800 bg-slate-900/80 p-4 text-xs text-slate-300">
            Unable to load AESO Actual/Forecast data right now.
            <div className="mt-2 font-mono text-[11px] text-slate-500">
              Debug: HTTP {meta?.httpStatus ?? 0}, parsed rows{" "}
              {meta?.parsedRowCount ?? 0}, dates{" "}
              {availableDates.length ? availableDates.join(", ") : "none"}
            </div>
          </section>
        ) : (
          <>
            {days.map((day) => (
              <section
                key={day.dateYMD}
                className="mb-6 rounded-2xl border border-slate-800 bg-slate-900/80 p-4"
              >
                <header className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h2 className="text-sm font-semibold text-slate-100">
                      Report date:{" "}
                      <span className="font-mono">{day.dateYMD}</span>
                      {day.dateYMD === albertaToday && (
                        <span className="ml-2 rounded-full bg-emerald-500/20 px-2 py-0.5 text-[11px] font-medium text-emerald-300">
                          today (Alberta)
                        </span>
                      )}
                    </h2>
                    <p className="mt-1 text-[11px] text-slate-400">
                      Rows below are taken directly from the AESO
                      Actual/Forecast WMRQH CSV for this date. If a cell shows
                      &quot;—&quot;, AESO has not published a value yet for that
                      field (for example, future actuals).
                    </p>
                  </div>
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
                      {day.rows.map((r: AesoActualForecastRow) => {
                        const hasActualLoad = r.actualAil != null;
                        const hasActualPrice = r.actualPoolPrice != null;

                        return (
                          <tr
                            key={`${day.dateYMD}-${r.he}`}
                            className="border-t border-slate-800/60 hover:bg-slate-900/40"
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
                              {hasActualLoad ? "TRUE" : "FALSE"}
                            </td>
                            <td className="px-3 py-2 text-[11px] text-slate-300">
                              {formatPrice(r.forecastPoolPrice)}
                            </td>
                            <td className="px-3 py-2 text-[11px] text-slate-300">
                              {formatPrice(r.actualPoolPrice)}
                            </td>
                            <td className="px-3 py-2 text-[11px]">
                              {hasActualPrice ? "TRUE" : "FALSE"}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </section>
            ))}
          </>
        )}
      </div>
    </main>
  );
}
