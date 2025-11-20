import NavTabs from "./components/NavTabs";
import {
  getTodayHourlyStates,
  summarizeDay,
} from "../lib/marketData";

/* ---------- Refresh rate ---------- */
export const revalidate = 15; // refresh every 15 seconds

/* ---------- helpers ---------- */
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

/* ---------- AESO helpers for live cushion ---------- */

// Scrape AESO’s Current Supply Demand “Net Actual Interchange” (system net flow)
async function fetchNetInterchange(): Promise<number | null> {
  const url = "http://ets.aeso.ca/ets_web/ip/Market/Reports/CSDReportServlet";
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const html = await res.text();
    const match = html.match(/Net Actual Interchange<\/td>\s*<td>\s*(-?\d+)\s*<\/td>/i);
    return match ? Number(match[1]) : null;
  } catch {
    return null;
  }
}

// Pull ATC capability (import/export) for the system
async function fetchSystemATC(): Promise<{ import: number; export: number } | null> {
  const now = new Date();
  const abNow = new Date(now.getTime() - 7 * 60 * 60 * 1000);
  const date = abNow.toISOString().slice(0, 10).replace(/-/g, "");
  const url = new URL("https://itc.aeso.ca/itc/public/api/v2/interchange");
  url.searchParams.set("startDate", date);
  url.searchParams.set("endDate", date);
  url.searchParams.set("dataType", "ATC");
  url.searchParams.set("Accept", "application/json");

  try {
    const res = await fetch(url.toString());
    if (!res.ok) return null;
    const data = await res.json();
    const sys = data?.return?.SystemlFlowgate?.Allocations?.find?.(() => true);
    if (!sys) return null;
    const imp = sys.import?.atc ?? 0;
    const exp = sys.export?.atc ?? 0;
    return { import: imp, export: exp };
  } catch {
    return null;
  }
}

/* ---------- main page ---------- */
export default async function DashboardPage() {
  // Pull local data (price/load)
  const states = await getTodayHourlyStates();
  const summary = summarizeDay(states);
  const now = summary.current;

  // Pull real-time system metrics
  const [netInterchangeMw, systemAtc] = await Promise.all([
    fetchNetInterchange(),
    fetchSystemATC(),
  ]);

  // Derive cushion = import capability − current export − load
  let cushionMw: number | null = null;
  let cushionPercent: number | null = null;
  let cushionFlag: string = "unknown";

  if (systemAtc && now?.actualLoad != null && netInterchangeMw != null) {
    const availableImport = systemAtc.import ?? 0;
    const currentExport = netInterchangeMw > 0 ? netInterchangeMw : 0;
    cushionMw = availableImport - currentExport;
    cushionPercent = cushionMw / now.actualLoad;

    if (cushionPercent < -0.05) cushionFlag = "tight";
    else if (cushionPercent < 0.02) cushionFlag = "watch";
    else cushionFlag = "comfortable";
  }

  return (
    <main className="min-h-screen bg-slate-950 text-slate-100">
      <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
        <header className="mb-4">
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
            Alberta Power Trader Dashboard
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-slate-400">
            Real-time overview of Alberta’s power market, built directly on AESO data.
          </p>
        </header>

        <NavTabs />

        {/* Top stats */}
        <section className="grid gap-4 md:grid-cols-2 lg:grid-cols-4 mt-4">
          <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4">
            <p className="text-xs uppercase tracking-wide text-slate-400">
              Current Cushion
            </p>
            <p className="mt-2 text-3xl font-semibold">
              {formatNumber(cushionMw, 0)}{" "}
              <span className="text-base font-normal text-slate-400">MW</span>
            </p>
            <p className="mt-1 text-xs text-slate-400">
              {cushionPercent != null
                ? `${(cushionPercent * 100).toFixed(1)}% of load`
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
                  cushionFlagClass(cushionFlag)
                }
              >
                <span className="inline-block h-2 w-2 rounded-full bg-current" />
                {cushionFlagLabel(cushionFlag)}
              </div>
            </div>
            <p className="mt-3 text-xs text-slate-400">
              Net interchange: {formatNumber(netInterchangeMw, 0)} MW · Import ATC:{" "}
              {formatNumber(systemAtc?.import, 0)} MW · Export ATC:{" "}
              {formatNumber(systemAtc?.export, 0)} MW
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
                Each row is an hour ending (HE). Cushion = Available − AIL, using real AESO data where available.
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
                  <th className="px-3 py-2">AIL</th>
                  <th className="px-3 py-2">Cushion (MW)</th>
                  <th className="px-3 py-2">Cushion %</th>
                </tr>
              </thead>
              <tbody>
                {states.map((s) => (
                  <tr
                    key={s.he}
                    className="border-t border-slate-800/60 hover:bg-slate-900/40"
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
                      {formatNumber(s.actualLoad, 0)}
                    </td>
                    <td className="px-3 py-2 text-[11px] text-slate-300">
                      {formatNumber(s.cushionMw, 0)}
                    </td>
                    <td className="px-3 py-2 text-[11px] text-slate-300">
                      {(s.cushionPercent * 100).toFixed(1)}%
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </main>
  );
}
