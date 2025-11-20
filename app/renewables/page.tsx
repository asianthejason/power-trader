// app/renewables/page.tsx

import NavTabs from "../components/NavTabs";

export const revalidate = 60;

// AESO sources used on this page (all *real* data, no synthetic):
// - Current Supply & Demand (CSD) – live actual wind & solar
// - Wind 12-hour forecast CSV
// - Solar 12-hour forecast CSV
const AESO_CSD_URL =
  "http://ets.aeso.ca/ets_web/ip/Market/Reports/CSDReportServlet";

const AESO_WIND_12H_URL =
  "https://ets.aeso.ca/Market/Reports/Manual/Operations/prodweb_reports/wind_solar_forecast/wind_rpt_shortterm.csv";

const AESO_SOLAR_12H_URL =
  "https://ets.aeso.ca/Market/Reports/Manual/Operations/prodweb_reports/wind_solar_forecast/solar_rpt_shortterm.csv";

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
  fetchedOk: boolean;
};

/**
 * Lightweight HTML scraper for AESO CSD.
 *
 * We look for lines like "Wind Generation ... 1234 MW" and
 * "Solar Generation ... 567 MW". If parsing fails, we return nulls.
 */
async function fetchCsdRenewablesSnapshot(): Promise<CsdRenewablesSnapshot> {
  try {
    const res = await fetch(AESO_CSD_URL, {
      cache: "no-store",
    });

    if (!res.ok) {
      console.error(
        `Failed to fetch AESO CSD (${res.status} ${res.statusText})`
      );
      return { windMw: null, solarMw: null, fetchedOk: false };
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
      fetchedOk: true,
    };
  } catch (err) {
    console.error("Error fetching AESO CSD renewables:", err);
    return { windMw: null, solarMw: null, fetchedOk: false };
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

async function fetchAesoForecast12h(kind: RenewableType): Promise<ForecastRow[]> {
  const url = kind === "wind" ? AESO_WIND_12H_URL : AESO_SOLAR_12H_URL;

  try {
    const res = await fetch(url, { cache: "no-store" });

    if (!res.ok) {
      console.error(
        `Failed to fetch AESO ${kind} 12-hour forecast (${res.status} ${res.statusText})`
      );
      return [];
    }

    const text = await res.text();
    const lines = text
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l.length > 0);

    if (lines.length < 2) {
      console.error(`AESO ${kind} forecast CSV has no data lines.`);
      return [];
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

      // If we don't get any numbers, skip the row.
      if (min == null && mostLikely == null && max == null) continue;

      rows.push({
        timeLabel,
        min,
        mostLikely,
        max,
      });
    }

    return rows;
  } catch (err) {
    console.error(`Error fetching AESO ${kind} 12-hour forecast:`, err);
    return [];
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
            <div className="inline-flex items-center rounded-full border border-emerald-500/40 bg-emerald-500/10 px-3 py-1 text-emerald-200">
              <span className="mr-2 inline-block h-1.5 w-1.5 rounded-full bg-emerald-400" />
              CSD snapshot (live actuals)
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
                  {solarForecast.length === 0 ? (
                    <tr>
                      <td
                        className="px-3 py-3 text-[11px] text-slate-400"
                        colSpan={4}
                      >
                        No solar forecast data available right now (could not
                        load AESO CSV).
                      </td>
                    </tr>
                  ) : (
                    solarForecast.map((row, idx) => (
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
                  {windForecast.length === 0 ? (
                    <tr>
                      <td
                        className="px-3 py-3 text-[11px] text-slate-400"
                        colSpan={4}
                      >
                        No wind forecast data available right now (could not
                        load AESO CSV).
                      </td>
                    </tr>
                  ) : (
                    windForecast.map((row, idx) => (
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
          see &quot;unavailable&quot; or an empty table, it usually means the
          AESO endpoints could not be reached or the CSV layout changed – in
          that case you can open the linked AESO pages above to inspect the raw
          data.
        </p>
      </div>
    </main>
  );
}
