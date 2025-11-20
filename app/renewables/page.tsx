// app/renewables/page.tsx

import NavTabs from "../components/NavTabs";

export const revalidate = 60;

// AESO sources used on this page (all real data, no synthetic):
// - Current Supply & Demand (CSD) – live actual wind & solar
// - Wind 12-hour forecast CSV
// - Solar 12-hour forecast CSV
const AESO_CSD_URL =
  "http://ets.aeso.ca/ets_web/ip/Market/Reports/CSDReportServlet";

const AESO_WIND_12H_URL =
  "http://ets.aeso.ca/Market/Reports/Manual/Operations/prodweb_reports/wind_solar_forecast/wind_rpt_shortterm.csv";

const AESO_SOLAR_12H_URL =
  "http://ets.aeso.ca/Market/Reports/Manual/Operations/prodweb_reports/wind_solar_forecast/solar_rpt_shortterm.csv";

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

/* ---------- CSD snapshot (actuals) ---------- */

type CsdRenewablesSnapshot = {
  windMw: number | null;
  solarMw: number | null;
  ok: boolean;
  status: number | null;
  statusText: string | null;
};

/**
 * HTML scraper for AESO CSD.
 *
 * We look for lines like "Wind Generation ... 1234 MW" and
 * "Solar Generation ... 567 MW". If parsing fails, we return nulls.
 */
async function fetchCsdRenewablesSnapshot(): Promise<CsdRenewablesSnapshot> {
  try {
    const res = await fetch(AESO_CSD_URL, {
      cache: "no-store",
      // AESO sometimes behaves better if we look like a browser.
      headers: {
        "User-Agent":
          "Mozilla/5.0 (compatible; AlbertaPowerTraderBot/1.0; +https://power-trader.vercel.app)",
      },
    });

    const status = res.status;
    const statusText = res.statusText;

    if (!res.ok) {
      console.error(
        `Failed to fetch AESO CSD (${status} ${statusText})`
      );
      return {
        windMw: null,
        solarMw: null,
        ok: false,
        status,
        statusText,
      };
    }

    const html = await res.text();

    const windMatch =
      html.match(/Wind\s*Generation[^0-9\-]*([0-9,]+)\s*MW/i) ||
      html.match(/Wind[^0-9\-]*([0-9,]+)\s*MW/i);

    const solarMatch =
      html.match(/Solar\s*Generation[^0-9\-]*([0-9,]+)\s*MW/i) ||
      html.match(/Solar[^0-9\-]*([0-9,]+)\s*MW/i);

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
      ok: true,
      status,
      statusText,
    };
  } catch (err) {
    console.error("Error fetching AESO CSD renewables:", err);
    return {
      windMw: null,
      solarMw: null,
      ok: false,
      status: null,
      statusText: (err as Error)?.message ?? null,
    };
  }
}

/* ---------- 12-hour forecast (CSV) ---------- */

type RenewableType = "wind" | "solar";

type ForecastRow = {
  timeLabel: string; // whatever timestamp string AESO gives us
  min: number | null;
  mostLikely: number | null;
  max: number | null;
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
        `Failed to fetch AESO ${kind} 12-hour forecast (${status} ${statusText})`
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
    const dateIdx =
      headerCells.findIndex((h) => /date|time/i.test(h)) ?? 0;

    let minIdx = headerCells.findIndex((h) => /min/i.test(h));
    let mostIdx = headerCells.findIndex((h) => /most/i.test(h));
    let maxIdx = headerCells.findIndex((h) => /max/i.test(h));

    // Fallback to simple positional assumptions if header names can't be found.
    if (minIdx < 0) minIdx = 1;
    if (mostIdx < 0) mostIdx = 2;
    if (maxIdx < 0) maxIdx = 3;

    const rows: ForecastRow[] = [];

    for (let i = 1; i < lines.length; i++) {
      const cols = splitCsvLine(lines[i]).map((c) => c.trim());
      if (cols.length === 0) continue;

      const timeLabelRaw = cols[dateIdx] ?? "";
      const timeLabel = timeLabelRaw.replace(/^"|"$/g, "");

      const min = parseMw(cols[minIdx]);
      const mostLikely = parseMw(cols[mostIdx]);
      const max = parseMw(cols[maxIdx]);

      if (min == null && mostLikely == null && max == null) continue;

      rows.push({
        timeLabel,
        min,
        mostLikely,
        max,
      });
    }

    return { rows, ok: true, status, statusText };
  } catch (err) {
    console.error(`Error fetching AESO ${kind} 12-hour forecast:`, err);
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
  const [csdSnapshot, windForecast, solarForecast] = await Promise.all([
    fetchCsdRenewablesSnapshot(),
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
        <header className="mb-4 space-y-2">
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
            Renewables – Live AESO Data
          </h1>
          <p className="max-w-2xl text-sm text-slate-400">
            Live Alberta wind and solar data for{" "}
            <span className="font-mono">{abDate}</span>, pulled directly from
            AESO reports (no synthetic model). Actuals come from{" "}
            <a
              href={AESO_CSD_URL}
              target="_blank"
              rel="noreferrer"
              className="underline decoration-slate-500 hover:decoration-slate-300"
            >
              Current Supply &amp; Demand (CSD)
            </a>{" "}
            and forecasts come from the AESO 12-hour wind and solar power
            forecast CSVs.
          </p>

          {/* Live snapshot badges */}
          <div className="flex flex-wrap gap-2 text-xs">
            <div
              className={
                "inline-flex items-center rounded-full px-3 py-1 " +
                (csdSnapshot.ok
                  ? "border border-emerald-500/40 bg-emerald-500/10 text-emerald-200"
                  : "border border-red-500/40 bg-red-500/10 text-red-200")
              }
            >
              <span
                className={
                  "mr-2 inline-block h-1.5 w-1.5 rounded-full " +
                  (csdSnapshot.ok ? "bg-emerald-400" : "bg-red-400")
                }
              />
              {csdSnapshot.ok
                ? "CSD snapshot (live actuals)"
                : "CSD snapshot unavailable"}
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
            {!csdSnapshot.ok && (
              <div className="inline-flex items-center rounded-full border border-slate-800 bg-slate-900/70 px-3 py-1 text-[10px] text-slate-400">
                CSD fetch error:
                <span className="ml-1 font-mono">
                  {csdSnapshot.status != null
                    ? `${csdSnapshot.status} ${csdSnapshot.statusText ?? ""}`
                    : csdSnapshot.statusText ?? "unknown"}
                </span>
              </div>
            )}
          </div>
        </header>

        <NavTabs />

        {/* ---------- Tables ---------- */}
        <section className="mt-4 grid gap-4 lg:grid-cols-2">
          {/* Solar forecast table */}
          <div className="rounded-2xl border border-slate-800 bg-slate-900/80 p-4">
            <h2 className="mb-2 text-sm font-semibold tracking-tight">
              Solar Forecast (next 12 hours, MW)
            </h2>
            <p className="mb-2 text-[11px] text-slate-400">
              Direct from AESO&apos;s Solar 12-hour forecast CSV. Values are
              updated roughly every 10 minutes.
            </p>

            {!solarForecast.ok && (
              <p className="mb-2 text-[11px] text-red-300">
                Could not load solar forecast CSV{" "}
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
                  </tr>
                </thead>
                <tbody>
                  {solarForecast.rows.length === 0 ? (
                    <tr>
                      <td
                        className="px-3 py-3 text-[11px] text-slate-400"
                        colSpan={4}
                      >
                        No solar forecast data rows available. Open the AESO
                        Wind &amp; Solar Power Forecasting page and try
                        right-clicking the &quot;Solar-12 hour&quot; link to
                        confirm you can download the CSV from your network.
                      </td>
                    </tr>
                  ) : (
                    solarForecast.rows.map((row, idx) => (
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
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Wind forecast table */}
          <div className="rounded-2xl border border-slate-800 bg-slate-900/80 p-4">
            <h2 className="mb-2 text-sm font-semibold tracking-tight">
              Wind Forecast (next 12 hours, MW)
            </h2>
            <p className="mb-2 text-[11px] text-slate-400">
              Direct from AESO&apos;s Wind 12-hour forecast CSV. Values are
              updated roughly every 10 minutes.
            </p>

            {!windForecast.ok && (
              <p className="mb-2 text-[11px] text-red-300">
                Could not load wind forecast CSV{" "}
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
                  </tr>
                </thead>
                <tbody>
                  {windForecast.rows.length === 0 ? (
                    <tr>
                      <td
                        className="px-3 py-3 text-[11px] text-slate-400"
                        colSpan={4}
                      >
                        No wind forecast data rows available. Open the AESO Wind
                        &amp; Solar Power Forecasting page and try
                        right-clicking the &quot;Wind-12 hour&quot; link to
                        confirm you can download the CSV from your network.
                      </td>
                    </tr>
                  ) : (
                    windForecast.rows.map((row, idx) => (
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
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </section>

        <p className="mt-4 text-[11px] text-slate-500">
          All values on this page are taken directly from AESO reports. If you
          see &quot;unavailable&quot; or an empty table, check the small error
          badges above for HTTP status codes and try downloading the linked AESO
          CSVs manually from your browser to confirm access from your network.
        </p>
      </div>
    </main>
  );
}
