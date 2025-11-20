// app/renewables/page.tsx

import NavTabs from "../components/NavTabs";

export const revalidate = 60;

// AESO sources used on this page (all real data, no synthetic):
// - Wind 12-hour short-term report (CSV)
// - Solar 12-hour short-term report (CSV)
// - CSD report (HTML) – only opened via button, not parsed here
const AESO_CSD_URL =
  "http://ets.aeso.ca/ets_web/ip/Market/Reports/CSDReportServlet";

const AESO_WIND_12H_URL =
  "http://ets.aeso.ca/Market/Reports/Manual/Operations/prodweb_reports/wind_solar_forecast/wind_rpt_shortterm.csv";

const AESO_SOLAR_12H_URL =
  "http://ets.aeso.ca/Market/Reports/Manual/Operations/prodweb_reports/wind_solar_forecast/solar_rpt_shortterm.csv";

// Internal HTTPS proxy endpoints for downloads (see /api routes)
const SOLAR_DOWNLOAD_PATH = "/api/aeso/solar-shortterm-csv";
const WIND_DOWNLOAD_PATH = "/api/aeso/wind-shortterm-csv";

/* ---------- small helpers ---------- */

function formatNumber(n: number | null | undefined, decimals = 0) {
  if (n == null || Number.isNaN(n)) return "—";
  return n.toLocaleString(undefined, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

/** Very small CSV splitter that respects quoted fields. */
function splitCsvLine(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];

    if (ch === '"') {
      // Toggle quote state; double quotes inside a quoted field are collapsed.
      if (i + 1 < line.length && line[i + 1] === '"') {
        current += '"';
        i++; // skip escaped quote
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (ch === "," && !inQuotes) {
      result.push(current);
      current = "";
      continue;
    }

    current += ch;
  }

  result.push(current);
  return result;
}

function parseMw(raw: string | undefined): number | null {
  if (!raw) return null;
  const cleaned = raw.replace(/["\s,]/g, "");
  if (!cleaned) return null;
  const val = Number(cleaned);
  return Number.isFinite(val) ? val : null;
}

/* ---------- 12-hour CSV parsing ---------- */

type RenewableType = "wind" | "solar";

type ForecastRow = {
  timeLabel: string; // Forecast Transaction Date
  min: number | null;
  mostLikely: number | null;
  max: number | null;
  actual: number | null;
};

type ForecastResult = {
  rows: ForecastRow[];
  ok: boolean;
  status: number | null;
  statusText: string | null;
};

async function fetchAesoForecast12h(
  kind: RenewableType
): Promise<ForecastResult> {
  const url = kind === "wind" ? AESO_WIND_12H_URL : AESO_SOLAR_12H_URL;

  try {
    const res = await fetch(url, {
      cache: "no-store",
      headers: {
        "User-Agent":
          "Mozilla/5.0 (compatible; AlbertaPowerTraderBot/1.0; +https://power-trader.vercel.app)",
      },
    });

    const status = res.status;
    const statusText = res.statusText;

    if (!res.ok) {
      console.error(
        `Failed to fetch AESO ${kind} short-term report (${status} ${statusText})`
      );
      return { rows: [], ok: false, status, statusText };
    }

    const text = await res.text();
    const lines = text
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l.length > 0);

    if (lines.length < 2) {
      console.error(`AESO ${kind} forecast CSV has no data lines.`);
      return {
        rows: [],
        ok: false,
        status,
        statusText: "CSV had no data rows",
      };
    }

    const headerCells = splitCsvLine(lines[0]).map((h) => h.trim());

    // Forecast Transaction Date
    const dateIdx =
      headerCells.findIndex((h) => /date|time/i.test(h)) ?? 0;

    // Make sure we pick the MW columns (not the Pct ones).
    const findMwIdx = (pattern: RegExp) =>
      headerCells.findIndex(
        (h) => pattern.test(h) && !/pct/i.test(h)
      );

    let minIdx = findMwIdx(/min/i);
    let mostIdx = findMwIdx(/most\s*likely/i);
    let maxIdx = findMwIdx(/max/i);
    let actualIdx = findMwIdx(/actual/i);

    // Fallbacks if header names change a bit.
    if (minIdx < 0) minIdx = 1;
    if (mostIdx < 0) mostIdx = 2;
    if (maxIdx < 0) maxIdx = 3;
    if (actualIdx < 0) actualIdx = 4;

    const rows: ForecastRow[] = [];

    for (let i = 1; i < lines.length; i++) {
      const cols = splitCsvLine(lines[i]).map((c) => c.trim());
      if (cols.length === 0) continue;

      const timeLabelRaw = cols[dateIdx] ?? "";
      const timeLabel = timeLabelRaw.replace(/^"|"$/g, "");

      const min = parseMw(cols[minIdx]);
      const mostLikely = parseMw(cols[mostIdx]);
      const max = parseMw(cols[maxIdx]);
      const actual = parseMw(cols[actualIdx]);

      if (min == null && mostLikely == null && max == null && actual == null)
        continue;

      rows.push({
        timeLabel,
        min,
        mostLikely,
        max,
        actual,
      });
    }

    return { rows, ok: true, status, statusText };
  } catch (err) {
    console.error(`Error fetching AESO ${kind} short-term report:`, err);
    return {
      rows: [],
      ok: false,
      status: null,
      statusText: (err as Error)?.message ?? null,
    };
  }
}

/* ---------- page ---------- */

export default async function RenewablesPage() {
  const [windForecast, solarForecast] = await Promise.all([
    fetchAesoForecast12h("wind"),
    fetchAesoForecast12h("solar"),
  ]);

  const now = new Date();
  const abDate = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Edmonton",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);

  return (
    <main className="min-h-screen bg-slate-950 text-slate-100">
      <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
        {/* ---------- Header ---------- */}
        <header className="mb-4 space-y-3">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
                Renewables – Live AESO Data
              </h1>
              <p className="max-w-2xl text-sm text-slate-400">
                Live Alberta wind and solar{" "}
                <span className="font-semibold">forecasts and actuals</span> for{" "}
                <span className="font-mono">{abDate}</span>, pulled directly
                from AESO&apos;s 12-hour short-term wind and solar reports. No
                synthetic numbers – everything you see here is from the AESO
                CSVs.
              </p>
            </div>

            <a
              href={AESO_CSD_URL}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center justify-center rounded-full border border-slate-700 bg-slate-900/80 px-3 py-1 text-xs font-medium text-slate-100 hover:bg-slate-900"
            >
              Open CSD report
            </a>
          </div>
        </header>

        <NavTabs />

        {/* ---------- Tables ---------- */}
        <section className="mt-4 grid gap-4 lg:grid-cols-2">
          {/* Solar table */}
          <div className="rounded-2xl border border-slate-800 bg-slate-900/80 p-4">
            <div className="mb-2 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="text-sm font-semibold tracking-tight">
                  Solar – 12-hour Forecast &amp; Actual (MW)
                </h2>
                <p className="mt-1 text-[11px] text-slate-400">
                  Direct from{" "}
                  <span className="font-mono">solar_rpt_shortterm.csv</span>.
                  Each row is a forecast transaction time with Min / Most Likely
                  / Max and the corresponding{" "}
                  <span className="font-semibold">Actual</span> from the same
                  file.
                </p>
              </div>
              <a
                href={SOLAR_DOWNLOAD_PATH}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center justify-center rounded-full border border-slate-700 bg-slate-900/80 px-3 py-1 text-[11px] font-medium text-slate-100 hover:bg-slate-900"
              >
                Download Solar CSV
              </a>
            </div>

            {!solarForecast.ok && (
              <p className="mb-2 text-[11px] text-red-300">
                Could not load solar short-term report{" "}
                {solarForecast.status != null && (
                  <span className="font-mono">
                    ({solarForecast.status} {solarForecast.statusText ?? ""})
                  </span>
                )}
              </p>
            )}

            <div className="overflow-x-auto rounded-xl border border-slate-800 bg-slate-950/40">
              <table className="min-w-full text-left text-xs">
                <thead className="bg-slate-900/80 text-[11px] uppercase tracking-wide text-slate-400">
                  <tr>
                    <th className="px-3 py-2">Time</th>
                    <th className="px-3 py-2">Min</th>
                    <th className="px-3 py-2">Most likely</th>
                    <th className="px-3 py-2">Max</th>
                    <th className="px-3 py-2">Actual</th>
                    <th className="px-3 py-2">Δ (Actual − Most)</th>
                  </tr>
                </thead>
                <tbody>
                  {solarForecast.rows.length === 0 ? (
                    <tr>
                      <td
                        className="px-3 py-3 text-[11px] text-slate-400"
                        colSpan={6}
                      >
                        No solar data rows available. If this persists, use the
                        download button above to pull{" "}
                        <span className="font-mono">
                          solar_rpt_shortterm.csv
                        </span>{" "}
                        directly and check the raw file.
                      </td>
                    </tr>
                  ) : (
                    solarForecast.rows.map((row, idx) => {
                      const delta =
                        row.actual != null && row.mostLikely != null
                          ? row.actual - row.mostLikely
                          : null;

                      return (
                        <tr
                          key={`${row.timeLabel}-${idx}`}
                          className="border-t border-slate-800/60 hover:bg-slate-900/40"
                        >
                          <td className="px-3 py-2 text-[11px] font-medium text-slate-200">
                            {row.timeLabel || "—"}
                          </td>
                          <td className="px-3 py-2 text-[11px] text-slate-300">
                            {formatNumber(row.min, 0)}
                          </td>
                          <td className="px-3 py-2 text-[11px] text-slate-300">
                            {formatNumber(row.mostLikely, 0)}
                          </td>
                          <td className="px-3 py-2 text-[11px] text-slate-300">
                            {formatNumber(row.max, 0)}
                          </td>
                          <td className="px-3 py-2 text-[11px] text-slate-300">
                            {formatNumber(row.actual, 0)}
                          </td>
                          <td
                            className={
                              "px-3 py-2 text-[11px] " +
                              (delta != null && delta > 0
                                ? "text-emerald-400"
                                : delta != null && delta < 0
                                ? "text-red-400"
                                : "text-slate-300")
                            }
                          >
                            {delta != null && (delta >= 0 ? "+" : "")}
                            {delta != null ? formatNumber(delta, 0) : "—"}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Wind table */}
          <div className="rounded-2xl border border-slate-800 bg-slate-900/80 p-4">
            <div className="mb-2 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="text-sm font-semibold tracking-tight">
                  Wind – 12-hour Forecast &amp; Actual (MW)
                </h2>
                <p className="mt-1 text-[11px] text-slate-400">
                  Direct from{" "}
                  <span className="font-mono">wind_rpt_shortterm.csv</span>.
                  Each row is a forecast transaction time with Min / Most Likely
                  / Max and the corresponding{" "}
                  <span className="font-semibold">Actual</span> from the same
                  file.
                </p>
              </div>
              <a
                href={WIND_DOWNLOAD_PATH}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center justify-center rounded-full border border-slate-700 bg-slate-900/80 px-3 py-1 text-[11px] font-medium text-slate-100 hover:bg-slate-900"
              >
                Download Wind CSV
              </a>
            </div>

            {!windForecast.ok && (
              <p className="mb-2 text-[11px] text-red-300">
                Could not load wind short-term report{" "}
                {windForecast.status != null && (
                  <span className="font-mono">
                    ({windForecast.status} {windForecast.statusText ?? ""})
                  </span>
                )}
              </p>
            )}

            <div className="overflow-x-auto rounded-xl border border-slate-800 bg-slate-950/40">
              <table className="min-w-full text-left text-xs">
                <thead className="bg-slate-900/80 text-[11px] uppercase tracking-wide text-slate-400">
                  <tr>
                    <th className="px-3 py-2">Time</th>
                    <th className="px-3 py-2">Min</th>
                    <th className="px-3 py-2">Most likely</th>
                    <th className="px-3 py-2">Max</th>
                    <th className="px-3 py-2">Actual</th>
                    <th className="px-3 py-2">Δ (Actual − Most)</th>
                  </tr>
                </thead>
                <tbody>
                  {windForecast.rows.length === 0 ? (
                    <tr>
                      <td
                        className="px-3 py-3 text-[11px] text-slate-400"
                        colSpan={6}
                      >
                        No wind data rows available. If this persists, use the
                        download button above to pull{" "}
                        <span className="font-mono">
                          wind_rpt_shortterm.csv
                        </span>{" "}
                        directly and check the raw file.
                      </td>
                    </tr>
                  ) : (
                    windForecast.rows.map((row, idx) => {
                      const delta =
                        row.actual != null && row.mostLikely != null
                          ? row.actual - row.mostLikely
                          : null;

                      return (
                        <tr
                          key={`${row.timeLabel}-${idx}`}
                          className="border-t border-slate-800/60 hover:bg-slate-900/40"
                        >
                          <td className="px-3 py-2 text-[11px] font-medium text-slate-200">
                            {row.timeLabel || "—"}
                          </td>
                          <td className="px-3 py-2 text-[11px] text-slate-300">
                            {formatNumber(row.min, 0)}
                          </td>
                          <td className="px-3 py-2 text-[11px] text-slate-300">
                            {formatNumber(row.mostLikely, 0)}
                          </td>
                          <td className="px-3 py-2 text-[11px] text-slate-300">
                            {formatNumber(row.max, 0)}
                          </td>
                          <td className="px-3 py-2 text-[11px] text-slate-300">
                            {formatNumber(row.actual, 0)}
                          </td>
                          <td
                            className={
                              "px-3 py-2 text-[11px] " +
                              (delta != null && delta > 0
                                ? "text-emerald-400"
                                : delta != null && delta < 0
                                ? "text-red-400"
                                : "text-slate-300")
                            }
                          >
                            {delta != null && (delta >= 0 ? "+" : "")}
                            {delta != null ? formatNumber(delta, 0) : "—"}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </section>

        <p className="mt-4 text-[11px] text-slate-500">
          All values on this page are taken directly from AESO short-term wind
          and solar reports. If something looks off, use the download buttons
          beside each table to pull the raw CSVs, or open the CSD report for a
          cross-check.
        </p>
      </div>
    </main>
  );
}
