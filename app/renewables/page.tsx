// app/renewables/page.tsx
import NavTabs from "../components/NavTabs";
import { getTodayHourlyStates, summarizeDay } from "../../lib/marketData";

export const revalidate = 60;

// AESO links we rely on here:
// - Live actuals: Current Supply & Demand (CSD) report
const AESO_CSD_URL =
  "https://ets.aeso.ca/ets_web/ip/Market/Reports/CSDReportServlet";

/* ---------- helpers ---------- */

function formatNumber(n: number | null | undefined, decimals = 0) {
  if (n == null || Number.isNaN(n)) return "—";
  return n.toLocaleString(undefined, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

type CsdRenewablesSnapshot = {
  windMw: number | null;
  solarMw: number | null;
  fetchedOk: boolean;
};

/**
 * Very lightweight HTML scraper for AESO CSD.
 *
 * We look for "Wind Generation" and "Solar Generation" followed by a MW value.
 * The CSD layout can change, so this is written to fail gracefully: if parsing
 * fails for any reason, we just return nulls and fall back to synthetic data.
 */
async function fetchCsdRenewablesSnapshot(): Promise<CsdRenewablesSnapshot> {
  try {
    const res = await fetch(AESO_CSD_URL, {
      cache: "no-store",
      // AESO is plain HTML, no special headers needed.
    });

    if (!res.ok) {
      console.error(
        `Failed to fetch AESO CSD (${res.status} ${res.statusText})`
      );
      return { windMw: null, solarMw: null, fetchedOk: false };
    }

    const html = await res.text();

    // Try to find something like "Wind Generation ... 1234 MW"
    const windMatch = html.match(
      /Wind\s*Generation[^0-9\-]*([0-9,]+)\s*MW/i
    );
    const solarMatch = html.match(
      /Solar\s*Generation[^0-9\-]*([0-9,]+)\s*MW/i
    );

    const windMw =
      windMatch && windMatch[1]
        ? parseInt(windMatch[1].replace(/,/g, ""), 10)
        : null;
    const solarMw =
      solarMatch && solarMatch[1]
        ? parseInt(solarMatch[1].replace(/,/g, ""), 10)
        : null;

    return {
      windMw: Number.isFinite(windMw) ? windMw : null,
      solarMw: Number.isFinite(solarMw) ? solarMw : null,
      fetchedOk: true,
    };
  } catch (err) {
    console.error("Error fetching AESO CSD renewables:", err);
    return { windMw: null, solarMw: null, fetchedOk: false };
  }
}

/**
 * Helper to pull a "current HE" from the day summary if available.
 * Falls back to null if summarizeDay doesn't expose it.
 */
function getCurrentHeFromSummary(summary: any): number | null {
  // Adjust these field names if your summarizeDay() shape is different.
  if (typeof summary?.currentHe === "number") return summary.currentHe;
  if (typeof summary?.nowHe === "number") return summary.nowHe;
  if (typeof summary?.approxCurrentHe === "number")
    return summary.approxCurrentHe;
  return null;
}

/* ---------- page ---------- */

export default async function RenewablesPage() {
  const [states, csdSnapshot] = await Promise.all([
    getTodayHourlyStates(),
    fetchCsdRenewablesSnapshot(),
  ]);

  const summary = summarizeDay(states);
  const currentHe = getCurrentHeFromSummary(summary);

  return (
    <main className="min-h-screen bg-slate-950 text-slate-100">
      <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
        <header className="mb-4 space-y-2">
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
            Renewables Forecast
          </h1>
          <p className="max-w-2xl text-sm text-slate-400">
            Hourly wind and solar forecast bands vs actuals for{" "}
            <span className="font-mono">{summary.date}</span>. Actuals for the
            current hour are pulled live from AESO&apos;s{" "}
            <a
              href={AESO_CSD_URL}
              target="_blank"
              rel="noreferrer"
              className="underline decoration-slate-500 hover:decoration-slate-300"
            >
              Current Supply &amp; Demand (CSD)
            </a>{" "}
            report; other hours use the synthetic model.
          </p>

          {/* Live AESO snapshot badge */}
          <div className="flex flex-wrap gap-2 text-xs">
            <div className="inline-flex items-center rounded-full border border-emerald-500/40 bg-emerald-500/10 px-3 py-1 text-emerald-200">
              <span className="mr-2 inline-block h-1.5 w-1.5 rounded-full bg-emerald-400" />
              Live AESO snapshot (CSD)
            </div>
            <div className="inline-flex items-center rounded-full border border-slate-700 bg-slate-900/70 px-3 py-1 text-slate-300">
              <span className="mr-1 text-slate-400">Wind:</span>
              {csdSnapshot.windMw != null
                ? `${formatNumber(csdSnapshot.windMw, 0)} MW`
                : "unavailable"}
            </div>
            <div className="inline-flex items-center rounded-full border border-slate-700 bg-slate-900/70 px-3 py-1 text-slate-300">
              <span className="mr-1 text-slate-400">Solar:</span>
              {csdSnapshot.solarMw != null
                ? `${formatNumber(csdSnapshot.solarMw, 0)} MW`
                : "unavailable"}
            </div>
            {currentHe != null && (
              <div className="inline-flex items-center rounded-full border border-slate-800 bg-slate-900/70 px-3 py-1 text-slate-400">
                Current HE (Alberta):{" "}
                <span className="ml-1 font-mono">
                  {currentHe.toString().padStart(2, "0")}
                </span>
              </div>
            )}
          </div>
        </header>

        <NavTabs />

        <section className="mt-4 grid gap-4 lg:grid-cols-2">
          {/* Solar */}
          <div className="rounded-2xl border border-slate-800 bg-slate-900/80 p-4">
            <h2 className="mb-2 text-sm font-semibold tracking-tight">
              Solar (MW)
            </h2>
            <p className="mb-2 text-[11px] text-slate-400">
              The <span className="font-semibold">Actual</span> column for the
              current HE uses live AESO CSD &quot;Solar Generation&quot;.
              Previous and future hours fall back to the synthetic model.
            </p>
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
                    // Use live AESO actual for the current HE if available.
                    const isCurrentHe =
                      currentHe != null && s.he === currentHe;
                    const actualSolar =
                      isCurrentHe && csdSnapshot.solarMw != null
                        ? csdSnapshot.solarMw
                        : s.solarActual;

                    const delta = actualSolar - s.solarForecast;

                    return (
                      <tr
                        key={s.he}
                        className={
                          "border-t border-slate-800/60 hover:bg-slate-900/40" +
                          (isCurrentHe ? " bg-slate-900/60" : "")
                        }
                      >
                        <td className="px-3 py-2 text-[11px] font-medium text-slate-200">
                          HE {s.he.toString().padStart(2, "0")}
                          {isCurrentHe && (
                            <span className="ml-1 rounded-full bg-emerald-500/20 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-emerald-300">
                              Live
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-[11px] text-slate-300">
                          {formatNumber(s.solarForecast, 0)}
                        </td>
                        <td className="px-3 py-2 text-[11px] text-slate-300">
                          {formatNumber(actualSolar, 0)}
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
            <p className="mb-2 text-[11px] text-slate-400">
              The <span className="font-semibold">Actual</span> column for the
              current HE uses live AESO CSD &quot;Wind Generation&quot;.
              Previous and future hours fall back to the synthetic model.
            </p>
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
                    const isCurrentHe =
                      currentHe != null && s.he === currentHe;
                    const actualWind =
                      isCurrentHe && csdSnapshot.windMw != null
                        ? csdSnapshot.windMw
                        : s.windActual;

                    const delta = actualWind - s.windForecast;

                    return (
                      <tr
                        key={s.he}
                        className={
                          "border-t border-slate-800/60 hover:bg-slate-900/40" +
                          (isCurrentHe ? " bg-slate-900/60" : "")
                        }
                      >
                        <td className="px-3 py-2 text-[11px] font-medium text-slate-200">
                          HE {s.he.toString().padStart(2, "0")}
                          {isCurrentHe && (
                            <span className="ml-1 rounded-full bg-emerald-500/20 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-emerald-300">
                              Live
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-[11px] text-slate-300">
                          {formatNumber(s.windForecast, 0)}
                        </td>
                        <td className="px-3 py-2 text-[11px] text-slate-300">
                          {formatNumber(actualWind, 0)}
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
          In the full build, you can also wire in AESO&apos;s 12-hour ahead wind
          and solar forecast CSVs from the{" "}
          <a
            href="https://www.aeso.ca/grid/grid-planning/forecasting/wind-and-solar-power-forecasting/"
            target="_blank"
            rel="noreferrer"
            className="underline decoration-slate-500 hover:decoration-slate-300"
          >
            Wind and Solar Power Forecasting
          </a>{" "}
          page (Wind-12 hour / Solar-12 hour links) to replace the synthetic
          forecast bands. This page already supports plugging those values into
          the existing HE-by-HE layout.
        </p>
      </div>
    </main>
  );
}
