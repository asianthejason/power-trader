// app/load-forecast/page.tsx
import NavTabs from "../components/NavTabs";

export const revalidate = 60; // re-fetch AESO data at most once per minute

/* ---------- Types ---------- */

type AesoForecastRow = {
  he: number;
  forecastPoolPrice: number | null;
  actualPoolPrice: number | null;
  forecastAil: number | null;
  actualAil: number | null;
};

type AesoFetchResult = {
  dateLabel: string;
  rows: AesoForecastRow[];
  debug: {
    ok: boolean;
    status: number | null;
    statusText: string;
    error?: string;
    lineCount: number;
    sampleLines: string[];
    parsedRowCount: number;
    parsedSample: AesoForecastRow[];
  };
};

/* ---------- Utilities ---------- */

function formatNumber(
  n: number | null | undefined,
  decimals = 0,
  empty = "—"
) {
  if (n == null || Number.isNaN(n)) return empty;
  return n.toLocaleString(undefined, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];

    if (ch === '"') {
      // toggle quote mode or handle escaped quote
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === "," && !inQuotes) {
      out.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  out.push(current);
  return out;
}

function toNumOrNull(raw: string): number | null {
  const cleaned = raw.replace(/["$,]/g, "").trim();
  if (!cleaned) return null;
  const n = parseFloat(cleaned);
  return Number.isFinite(n) ? n : null;
}

/**
 * Get current HE (hour ending) in Alberta time.
 * AESO HE is 1–24. We take the local hour in America/Edmonton and add 1.
 */
function getCurrentHeInAlberta(): number {
  const now = new Date();
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Edmonton",
    hour: "numeric",
    hour12: false,
  });
  const parts = fmt.formatToParts(now);
  const hourStr = parts.find((p) => p.type === "hour")?.value ?? "0";
  const hour = parseInt(hourStr, 10) || 0;
  const he = ((hour + 24) % 24) + 1; // 0 → 1, 23 → 24
  return he;
}

/* ---------- AESO fetch with rich debug ---------- */

async function fetchAesoActualForecastToday(): Promise<AesoFetchResult> {
  const url =
    "http://ets.aeso.ca/ets_web/ip/Market/Reports/ActualForecastWMRQHReportServlet?contentType=csv";

  const debug: AesoFetchResult["debug"] = {
    ok: false,
    status: null,
    statusText: "",
    error: undefined,
    lineCount: 0,
    sampleLines: [],
    parsedRowCount: 0,
    parsedSample: [],
  };

  let dateLabel = "";
  const rows: AesoForecastRow[] = [];

  try {
    const res = await fetch(url, { cache: "no-store" });
    debug.status = res.status;
    debug.statusText = res.statusText;
    debug.ok = res.ok;

    const text = await res.text();

    const lines = text.split(/\r?\n/);
    debug.lineCount = lines.length;
    debug.sampleLines = lines.slice(0, 12);

    for (const raw of lines) {
      const line = raw.trim();
      if (!line) continue;

      // Title / section headers
      if (line.startsWith("Actual / Forecast")) continue;
      if (line.startsWith("Date,Forecast Pool Price")) continue;

      // Capture the "November 19, 2025." style label
      const monthMatch = line.match(
        /^"?(January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},\s+\d{4}/
      );
      if (monthMatch) {
        dateLabel = monthMatch[0].replace(/^"|"$/g, "");
        continue;
      }

      // Everything else: try to parse as a data row
      const parts = parseCsvLine(line);
      if (parts.length < 5) continue;

      const dateFieldRaw = parts[0] ?? "";
      const dateField = dateFieldRaw.replace(/"/g, "").trim(); // e.g. 11/19/2025 01
      const m = dateField.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2})$/);
      if (!m) continue;

      const he = parseInt(m[4], 10);
      if (!Number.isFinite(he) || he < 1 || he > 24) continue;

      const forecastPoolPrice = toNumOrNull(parts[1]);
      const actualPoolPrice = toNumOrNull(parts[2]);
      const forecastAil = toNumOrNull(parts[3]);
      const actualAil = toNumOrNull(parts[4]);

      rows.push({
        he,
        forecastPoolPrice,
        actualPoolPrice,
        forecastAil,
        actualAil,
      });
    }

    rows.sort((a, b) => a.he - b.he);

    debug.parsedRowCount = rows.length;
    debug.parsedSample = rows.slice(0, 8);

    if (!dateLabel) {
      dateLabel = "Today (AESO Actual/Forecast)";
    }
  } catch (err: any) {
    debug.error = err?.message ?? String(err);
  }

  return {
    dateLabel,
    rows,
    debug,
  };
}

/* ---------- Page component ---------- */

export default async function LoadForecastPage() {
  const result = await fetchAesoActualForecastToday();
  const { dateLabel, rows, debug } = result;
  const nowHe = getCurrentHeInAlberta();

  const hasData = rows.length > 0;

  return (
    <main className="min-h-screen bg-slate-950 text-slate-100">
      <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
        <header className="mb-4">
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
            Load &amp; Price Forecast
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-slate-400">
            Pure AESO data from the Actual/Forecast WMRQH report. For hours
            already completed (HE ≤ current), AESO will gradually fill in the
            actual columns; future hours show only the forecast columns.
            No synthetic modelling is used on this page.
          </p>

          <div className="mt-3 inline-flex flex-wrap items-center gap-3 rounded-xl border border-slate-800 bg-slate-900/80 px-3 py-2 text-[11px] text-slate-300">
            <div className="flex items-center gap-2">
              <span className="inline-flex h-2 w-2 rounded-full bg-emerald-400" />
              <span className="font-mono uppercase tracking-wide">
                Source:
              </span>
              <span className="font-mono text-emerald-300">
                AESO ActualForecastWMRQH (CSV)
              </span>
            </div>

            <div className="h-3 w-px bg-slate-700" />
            <div className="font-mono text-slate-400">
              Report date:&nbsp;
              <span className="text-slate-100">
                {dateLabel || "unknown"}
              </span>
            </div>

            <div className="h-3 w-px bg-slate-700" />
            <div className="font-mono text-slate-400">
              HTTP:&nbsp;
              <span
                className={
                  debug.ok ? "text-emerald-300" : "text-amber-300"
                }
              >
                {debug.status ?? "—"} {debug.statusText || ""}
              </span>
            </div>

            <div className="h-3 w-px bg-slate-700" />
            <div className="font-mono text-slate-400">
              Parsed rows:&nbsp;
              <span className="text-slate-100">{debug.parsedRowCount}</span>
            </div>
          </div>
        </header>

        <NavTabs />

        <section className="mt-4 rounded-2xl border border-slate-800 bg-slate-900/80 p-4">
          <div className="mb-2 text-xs text-slate-400">
            Current HE (Alberta time):{" "}
            <span className="font-mono">
              {nowHe ? `HE ${nowHe.toString().padStart(2, "0")}` : "—"}
            </span>
          </div>

          <div className="overflow-x-auto rounded-xl border border-slate-800 bg-slate-950/40">
            {!hasData ? (
              <div className="px-4 py-6 text-xs text-slate-300 space-y-3">
                <div>Unable to render AESO Actual/Forecast data.</div>
                <details className="rounded-lg border border-slate-800 bg-slate-950/70 px-3 py-2">
                  <summary className="cursor-pointer text-[11px] text-slate-400">
                    Debug details (server-side)
                  </summary>
                  <div className="mt-2 space-y-2 text-[11px]">
                    <div>
                      <span className="font-semibold">Status:</span>{" "}
                      {debug.status} {debug.statusText}
                    </div>
                    {debug.error && (
                      <div>
                        <span className="font-semibold">Error:</span>{" "}
                        {debug.error}
                      </div>
                    )}
                    <div>
                      <span className="font-semibold">Line count:</span>{" "}
                      {debug.lineCount}
                    </div>
                    <div>
                      <span className="font-semibold">Sample lines:</span>
                      <pre className="mt-1 max-h-40 overflow-auto rounded bg-slate-900/90 p-2 font-mono text-[10px] leading-snug text-slate-200">
                        {debug.sampleLines.join("\n")}
                      </pre>
                    </div>
                    <div>
                      <span className="font-semibold">Parsed sample:</span>
                      <pre className="mt-1 max-h-40 overflow-auto rounded bg-slate-900/90 p-2 font-mono text-[10px] leading-snug text-slate-200">
                        {JSON.stringify(debug.parsedSample, null, 2)}
                      </pre>
                    </div>
                  </div>
                </details>
              </div>
            ) : (
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
                  {rows.map((row) => {
                    const useActual = row.he <= nowHe;
                    const useActualPrice = row.he <= nowHe;

                    return (
                      <tr
                        key={row.he}
                        className={
                          "border-t border-slate-800/60 " +
                          (useActual
                            ? "bg-slate-900/70"
                            : "hover:bg-slate-900/40")
                        }
                      >
                        <td className="px-3 py-2 text-[11px] font-medium text-slate-200">
                          HE {row.he.toString().padStart(2, "0")}
                        </td>
                        <td className="px-3 py-2 text-[11px] text-slate-300">
                          {formatNumber(row.forecastAil, 0)}
                        </td>
                        <td className="px-3 py-2 text-[11px] text-slate-300">
                          {formatNumber(row.actualAil, 0)}
                        </td>
                        <td className="px-3 py-2 text-[11px]">
                          {useActual ? "TRUE" : "FALSE"}
                        </td>
                        <td className="px-3 py-2 text-[11px] text-slate-300">
                          $
                          {formatNumber(
                            row.forecastPoolPrice,
                            2 /* keep cents */
                          )}
                        </td>
                        <td className="px-3 py-2 text-[11px] text-slate-300">
                          $
                          {formatNumber(
                            row.actualPoolPrice,
                            2 /* keep cents */
                          )}
                        </td>
                        <td className="px-3 py-2 text-[11px]">
                          {useActualPrice ? "TRUE" : "FALSE"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>

          <p className="mt-3 text-[11px] text-slate-500">
            This table is a direct rendering of the AESO Actual/Forecast WMRQH
            CSV. If a cell shows &quot;—&quot;, that means AESO has not
            published a value for that field yet (for example, future actuals).
          </p>
        </section>
      </div>
    </main>
  );
}
