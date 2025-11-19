// app/load-forecast/page.tsx
import NavTabs from "../components/NavTabs";
import {
  getAesoLoadForecastDay,
  AesoActualForecastRow,
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
  // Very rough: assume Alberta is UTC-7 (MST).
  const nowUtc = new Date();
  const albertaMs = nowUtc.getTime() - 7 * 60 * 60 * 1000;
  const alberta = new Date(albertaMs);
  const he = alberta.getHours() + 1; // HE 01 covers 00:00–00:59 etc.
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

type PageProps = {
  searchParams?: { date?: string };
};

export default async function LoadForecastPage({ searchParams }: PageProps) {
  const requestedDate = searchParams?.date;
  const day = await getAesoLoadForecastDay(requestedDate);

  const albertaToday = getApproxAlbertaDateYMD();
  const currentHeApprox = getApproxAlbertaHe();

  const rows: AesoActualForecastRow[] = day?.rows ?? [];
  const meta = day?.meta;

  const selectedDate = day?.dateYMD;
  const availableDates = meta?.availableDates ?? [];

  const isToday = selectedDate === albertaToday;

  return (
    <main className="min-h-screen bg-slate-950 text-slate-100">
      <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
        <header className="mb-4">
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
            Load &amp; Price Forecast
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-slate-400">
            Pure AESO data from the Actual/Forecast WMRQH report. For any hour
            where AESO has published actuals, the actual columns are populated;
            otherwise only the forecast columns show values. No synthetic
            modelling is used on this page.
          </p>
        </header>

        <NavTabs />

        <section className="mb-3 rounded-2xl border border-emerald-900/60 bg-emerald-950/40 px-4 py-3 text-xs text-emerald-200">
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
                  | HTTP: {meta.httpStatus} | Parsed rows:{" "}
                  {meta.parsedRowCount}
                </span>
              </>
            )}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <span className="text-slate-300">
              Viewing date:{" "}
              <span className="font-mono font-semibold">
                {selectedDate ?? "—"}
              </span>
            </span>
            <span className="text-slate-400">
              (Current HE approximation in Alberta:{" "}
              <span className="font-mono">
                HE {currentHeApprox.toString().padStart(2, "0")}
              </span>
              )
            </span>
          </div>

          {availableDates.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-2">
              {availableDates.map((d) => {
                const isActive = d === selectedDate;
                return (
                  <a
                    key={d}
                    href={`/load-forecast?date=${d}`}
                    className={
                      "inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] " +
                      (isActive
                        ? "border-emerald-400 bg-emerald-500/10 text-emerald-200"
                        : "border-slate-700 bg-slate-900/40 text-slate-300 hover:border-emerald-500 hover:text-emerald-200")
                    }
                  >
                    {d}
                    {d === albertaToday && " (today)"}
                  </a>
                );
              })}
            </div>
          )}
        </section>

        <section className="rounded-2xl border border-slate-800 bg-slate-900/80 p-4">
          <div className="mb-2 text-xs text-slate-400">
            Current HE (Alberta time):{" "}
            <span className="font-mono">
              HE {currentHeApprox.toString().padStart(2, "0")}
            </span>
          </div>

          {rows.length === 0 ? (
            <div className="rounded-xl border border-slate-800 bg-slate-950/40 px-4 py-6 text-xs text-slate-300">
              Unable to load AESO Actual/Forecast data right now.
              <div className="mt-2 font-mono text-[11px] text-slate-500">
                Debug: HTTP {meta?.httpStatus ?? 0}, parsed rows{" "}
                {meta?.parsedRowCount ?? 0}, dates{" "}
                {availableDates.length ? availableDates.join(", ") : "none"}
              </div>
            </div>
          ) : (
            <>
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
                    {rows.map((r) => {
                      const hasActualLoad = r.actualAil != null;
                      const hasActualPrice = r.actualPoolPrice != null;

                      return (
                        <tr
                          key={`${r.dateYMD}-${r.he}`}
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
              <p className="mt-3 text-[11px] text-slate-500">
                This table is a direct rendering of the AESO Actual/Forecast
                WMRQH CSV for the selected date. If a cell shows &quot;—&quot;,
                that means AESO has not published a value for that field yet
                (for example, future actuals).
              </p>
            </>
          )}
        </section>
      </div>
    </main>
  );
}
