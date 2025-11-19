// app/load-forecast/page.tsx
import NavTabs from "../components/NavTabs";

export const revalidate = 60; // re-fetch AESO data at most once per minute

type AesoForecastRow = {
  he: number;
  forecastPoolPrice: number | null;
  actualPoolPrice: number | null;
  forecastAil: number | null;
  actualAil: number | null;
};

type AesoForecastDay = {
  dateLabel: string; // e.g. "November 19, 2025"
  rows: AesoForecastRow[];
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

/* ---------- AESO fetch (no synthetic at all) ---------- */

async function fetchAesoActualForecastToday(): Promise<AesoForecastDay | null> {
  const url =
    "http://ets.aeso.ca/ets_web/ip/Market/Reports/ActualForecastWMRQHReportServlet?contentType=csv";

  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) {
    console.error("AESO ActualForecast fetch failed:", res.status, res.statusText);
    return null;
  }

  const text = await res.text();
  const rawLines = text.split(/\r?\n/);

  let dateLabel = "";
  const rows: AesoForecastRow[] = [];

  for (const raw of rawLines) {
    const line = raw.trim();
    if (!line) continue;

    // Title / section headers we don't need
    if (line.startsWith("Actual / Forecast")) continue;
    if (line.startsWith("Date,Forecast Pool Price")) continue;

    // Capture the "November 19, 2025." line as a friendly label
    const monthMatch = line.match(
      /^"?(January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},\s+\d{4}/
    );
    if (monthMatch) {
      dateLabel = monthMatch[0].replace(/^"|"$/g, "");
      continue;
    }

    // Data rows start with something like "11/19/2025 01"
    if (!/^\d{1,2}\/\d{1,2}\/\d{4}/.test(line)) continue;

    const parts = parseCsvLine(line);
    if (parts.length < 5) continue;

    const dateField = parts[0].replace(/"/g, "").trim(); // "11/19/2025 01"
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

  if (rows.length === 0) return null;

  rows.sort((a, b) => a.he - b.he);

  if (!dateLabel) {
    // Fallback: build a simple ISO-like label from the first row's date
    dateLabel = "Today (AESO Actual / Forecast)";
  }

  return { dateLabel, rows };
}

/* ---------- Page component ---------- */

export default async function LoadForecastPage() {
  const data = await fetchAesoActualForecastToday();
  const nowHe = getCurrentHeInAlberta();

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
            {data && (
              <>
                <div className="h-3 w-px bg-slate-700" />
                <div className="font-mono text-slate-400">
                  Report date:{" "}
                  <span className="text-slate-100">{data.dateLabel}</span>
                </div>
                <div className="h-3 w-px bg-slate-700" />
                <div className="font-mono text-slate-400">
                  Rows parsed:{" "}
                  <span className="text-slate-100">{data.rows.length}</span>
                </div>
              </>
            )}
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
            {!data ? (
              <div className="px-4 py-6 text-xs text-slate-400">
                Unable to load AESO Actual/Forecast data right now.
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
                  {data.rows.map((row) => {
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
                          {formatNumber(row.forecastPoolPrice, 2 /* keep cents */)}
                        </td>
                        <td className="px-3 py-2 text-[11px] text-slate-300">
                          $
                          {formatNumber(row.actualPoolPrice, 2 /* keep cents */)}
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
