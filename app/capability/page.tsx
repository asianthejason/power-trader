// app/capability/page.tsx

import NavTabs from "../components/NavTabs";
import {
  getTodayHourlyStates,
  summarizeDay,
  type HourlyState,
} from "../../lib/marketData";

export const revalidate = 60;

/* ---------- small helpers ---------- */

function formatHe(he: number): string {
  return he.toString().padStart(2, "0");
}

function formatNumber(
  n: number | null | undefined,
  decimals = 0
): string {
  if (n == null || Number.isNaN(n)) return "—";
  return (n as number).toLocaleString(undefined, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

function formatPrice(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return "$—";
  return `$${formatNumber(n, 2)}`;
}

/** Same Alberta-time helper you use on /load-forecast */
function approxAlbertaNow() {
  const nowUtc = new Date();
  const nowAb = new Date(nowUtc.getTime() - 7 * 60 * 60 * 1000); // UTC-7
  const isoDate = nowAb.toISOString().slice(0, 10);
  // HE 01 is 00:00–01:00; approximate from hour.
  const he = ((nowAb.getHours() + 23) % 24) + 1;
  return { nowAb, isoDate, he };
}

/* ------------------------------------------------------------------ */
/*  AESO 7-Day Hourly Available Capability (CSV) helpers               */
/* ------------------------------------------------------------------ */

const AESO_7DAY_CAPABILITY_CSV_URL =
  "http://ets.aeso.ca/ets_web/ip/Market/Reports/SevenDaysHourlyAvailableCapabilityReportServlet?contentType=csv";

type AesoCapabilityRow = {
  date: string; // YYYY-MM-DD
  he: number; // 1..24
  values: Record<string, number>; // fuel -> availability factor or %
};

type AesoCapabilityDebug = {
  ok: boolean;
  httpStatus: number;
  lineCount: number;
  parsedRowCount: number;
  fuels: string[];
  errorMessage?: string;
};

// Parse "11/19/2025 01" -> { dateIso: "2025-11-19", he: 1 }
function parseMdyHe(field: string): { dateIso: string; he: number } | null {
  const m = field.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2})$/);
  if (!m) return null;
  const month = Number(m[1]);
  const day = Number(m[2]);
  const year = Number(m[3]);
  const he = Number(m[4]);
  if (!Number.isFinite(he) || he < 1 || he > 24) return null;

  const mm = month.toString().padStart(2, "0");
  const dd = day.toString().padStart(2, "0");
  const dateIso = `${year}-${mm}-${dd}`;
  return { dateIso, he };
}

// Very simple CSV extractor for fully-quoted fields (AESO style)
function csvToFields(line: string): string[] {
  const fields: string[] = [];
  const re = /"([^"]*)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(line)) !== null) {
    fields.push(m[1]);
  }
  // Fallback if nothing was quoted (just in case)
  if (!fields.length) {
    return line.split(",").map((s) => s.trim());
  }
  return fields;
}

function toNumOrNull(s: string): number | null {
  const cleaned = s.replace(/[$,%]/g, "").trim();
  if (!cleaned || cleaned === "-" || cleaned === "--") return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

/**
 * Fetch and parse AESO 7-Day Hourly Available Capability as a generic
 * "availability by fuel" dataset.
 *
 * NOTE: If AESO is temporarily returning an HTML error stub instead of
 * a full CSV, this will log HTTP 200 but 0 rows and an explanatory message.
 */
async function fetchAesoCapabilityRows(): Promise<{
  rows: AesoCapabilityRow[];
  debug: AesoCapabilityDebug;
}> {
  let httpStatus = 0;
  let text: string | null = null;

  try {
    const res = await fetch(AESO_7DAY_CAPABILITY_CSV_URL, {
      cache: "no-store",
    });
    httpStatus = res.status;
    if (!res.ok) {
      return {
        rows: [],
        debug: {
          ok: false,
          httpStatus,
          lineCount: 0,
          parsedRowCount: 0,
          fuels: [],
          errorMessage: `HTTP ${res.status} ${res.statusText}`,
        },
      };
    }
    text = await res.text();
  } catch (err: any) {
    return {
      rows: [],
      debug: {
        ok: false,
        httpStatus,
        lineCount: 0,
        parsedRowCount: 0,
        fuels: [],
        errorMessage: String(err?.message ?? err),
      },
    };
  }

  if (!text) {
    return {
      rows: [],
      debug: {
        ok: false,
        httpStatus,
        lineCount: 0,
        parsedRowCount: 0,
        fuels: [],
        errorMessage: "Empty response from AESO 7-Day Capability report",
      },
    };
  }

  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) {
    return {
      rows: [],
      debug: {
        ok: false,
        httpStatus,
        lineCount: lines.length,
        parsedRowCount: 0,
        fuels: [],
        errorMessage:
          "Response from AESO 7-Day Capability report is too short to be a valid CSV (often an HTML error stub).",
      },
    };
  }

  const header = csvToFields(lines[0]);
  // All columns after the first date/HE column are treated as fuels,
  // except any that clearly look like extra labels.
  const fuelColumns: { index: number; fuel: string }[] = [];

  header.forEach((name, idx) => {
    if (idx === 0) return;
    const label = name.trim();
    if (!label) return;
    if (/^he\b/i.test(label)) return;
    if (/date/i.test(label)) return;
    fuelColumns.push({ index: idx, fuel: label });
  });

  const rows: AesoCapabilityRow[] = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line.startsWith('"')) continue; // skip non-data lines

    const fields = csvToFields(line);
    if (!fields.length || !fields[0]) continue;

    const dt = parseMdyHe(fields[0]);
    if (!dt) continue;

    const { dateIso, he } = dt;
    const values: Record<string, number> = {};

    for (const col of fuelColumns) {
      const raw = toNumOrNull(fields[col.index] ?? "");
      if (raw != null) {
        values[col.fuel] = raw;
      }
    }

    if (Object.keys(values).length === 0) continue;

    rows.push({
      date: dateIso,
      he,
      values,
    });
  }

  const fuelsSet = new Set<string>();
  rows.forEach((r) => {
    Object.keys(r.values).forEach((f) => fuelsSet.add(f));
  });

  return {
    rows,
    debug: {
      ok: rows.length > 0,
      httpStatus,
      lineCount: lines.length,
      parsedRowCount: rows.length,
      fuels: Array.from(fuelsSet).sort(),
    },
  };
}

/**
 * Determine whether the availability numbers look like fractions (0–1)
 * or percentages (0–100), and return a scale factor to convert them
 * to a displayable percentage.
 */
function determineAvailabilityScale(rows: AesoCapabilityRow[]): number {
  let maxVal = 0;
  for (const r of rows) {
    for (const v of Object.values(r.values)) {
      if (v > maxVal) maxVal = v;
    }
  }
  if (maxVal === 0) return 1;
  // If everything is <= 1.5, assume 0–1 fraction and scale by 100.
  if (maxVal <= 1.5) return 100;
  return 1; // assume already in percent
}

/* ---------- main page ---------- */

export default async function CapabilityPage() {
  const states: HourlyState[] = await getTodayHourlyStates();

  // If we couldn't load WMRQH at all, show a graceful message.
  if (!states.length) {
    return (
      <main className="min-h-screen bg-slate-950 text-slate-100">
        <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
          <header className="mb-4 space-y-2">
            <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
              Market Capability
            </h1>
            <p className="max-w-2xl text-sm text-slate-400">
              This view depends on AESO data. Right now, no rows could be
              loaded from the Actual/Forecast WMRQH report, so the page
              cannot show current conditions or capability yet.
            </p>
          </header>

          <NavTabs />

          <section className="mt-6 rounded-2xl border border-slate-800 bg-slate-900/70 px-4 py-3 text-xs text-slate-300">
            <p className="font-medium text-slate-200">
              No AESO WMRQH data available.
            </p>
            <p className="mt-1 text-[11px] text-slate-400">
              Once the AESO report is reachable again, this page will show
              the latest load &amp; price from WMRQH and capability by fuel
              from the AESO 7-Day Hourly Available Capability report.
            </p>
          </section>
        </div>
      </main>
    );
  }

  const summary = summarizeDay(states);
  const { isoDate: todayAbIso, he: approxHe } = approxAlbertaNow();

  const reportDate = summary.date;

  // Use Alberta HE when report date matches today; otherwise fall back
  // to mid-day HE from the dataset.
  let chosenHe: number;
  if (reportDate === todayAbIso) {
    chosenHe = approxHe;
  } else {
    chosenHe = states[Math.floor(states.length / 2)].he;
  }

  const current =
    states.find((s) => s.he === chosenHe) ||
    summary.current ||
    states[0];

  const currentHe = current.he;
  const currentLoadActual = current.actualLoad;
  const currentLoadForecast = current.forecastLoad;
  const currentPriceActual = current.actualPoolPrice;
  const currentPriceForecast = current.forecastPoolPrice;

  // ----- Fetch and shape AESO 7-Day capability data -----
  const { rows: capRows, debug: capDebug } = await fetchAesoCapabilityRows();

  // Focus on the same report date the WMRQH summary is using.
  let rowsForDate = capRows.filter((r) => r.date === reportDate);

  // If that date isn't in the capability report (e.g. report lag), fall
  // back to the latest date present in the capability dataset.
  if (!rowsForDate.length && capRows.length) {
    const allDates = Array.from(new Set(capRows.map((r) => r.date))).sort();
    const latestDate = allDates[allDates.length - 1];
    rowsForDate = capRows.filter((r) => r.date === latestDate);
  }

  const hasCapability = rowsForDate.length > 0;
  const scale = hasCapability ? determineAvailabilityScale(rowsForDate) : 1;

  // Current-hour availability by fuel
  let currentAvailByFuel: Record<string, number> = {};
  if (hasCapability) {
    const rowForCurrentHe =
      rowsForDate.find((r) => r.he === currentHe) ?? rowsForDate[0];
    currentAvailByFuel = Object.fromEntries(
      Object.entries(rowForCurrentHe.values).map(([fuel, v]) => [
        fuel,
        v * scale,
      ])
    );
  }

  // Daily average availability by fuel
  const dailyAvgAvailByFuel: Record<string, number> = {};
  if (hasCapability) {
    const allFuels = new Set<string>();
    rowsForDate.forEach((r) => {
      Object.keys(r.values).forEach((f) => allFuels.add(f));
    });

    for (const fuel of allFuels) {
      const vals: number[] = [];
      for (const r of rowsForDate) {
        const v = r.values[fuel];
        if (v != null && !Number.isNaN(v)) vals.push(v);
      }
      if (!vals.length) continue;
      const avgRaw =
        vals.reduce((sum, v) => sum + v, 0) / Math.max(vals.length, 1);
      dailyAvgAvailByFuel[fuel] = avgRaw * scale;
    }
  }

  // Sort fuels by descending current availability (or name as fallback)
  const sortedCurrentFuels = Object.keys(currentAvailByFuel).sort((a, b) => {
    const av = currentAvailByFuel[a] ?? 0;
    const bv = currentAvailByFuel[b] ?? 0;
    if (bv !== av) return bv - av;
    return a.localeCompare(b);
  });

  const sortedAvgFuels = Object.keys(dailyAvgAvailByFuel).sort((a, b) => {
    const av = dailyAvgAvailByFuel[a] ?? 0;
    const bv = dailyAvgAvailByFuel[b] ?? 0;
    if (bv !== av) return bv - av;
    return a.localeCompare(b);
  });

  return (
    <main className="min-h-screen bg-slate-950 text-slate-100">
      <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
        {/* Page header */}
        <header className="mb-4 space-y-2">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-baseline sm:justify-between">
            <div>
              <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
                Market Capability (Real AESO Load, Price &amp; Availability)
              </h1>
              <p className="max-w-3xl text-sm text-slate-400">
                This view combines AESO&apos;s Actual/Forecast WMRQH report
                (load and pool price) with the Seven-Day Hourly Available
                Capability report. Availability by fuel is shown as delivered
                by AESO (scaled to percentage where appropriate). No synthetic
                modelling is used.
              </p>
            </div>
            <a
              href={AESO_7DAY_CAPABILITY_CSV_URL}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center justify-center rounded-full border border-sky-500/70 bg-sky-900/40 px-3 py-1.5 text-[11px] font-semibold text-sky-100 hover:bg-sky-800/60"
            >
              Download 7-Day Capability CSV
            </a>
          </div>
        </header>

        {/* Shared nav bar */}
        <NavTabs />

        {/* Real-time summary banner using WMRQH-based states */}
        <section className="mt-4 rounded-2xl border border-sky-900 bg-sky-950/40 px-4 py-3 text-xs text-sky-100">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="space-y-1">
              <div className="inline-flex items-center gap-2 rounded-full bg-sky-900/80 px-3 py-1 text-[11px] font-medium">
                <span className="h-2 w-2 rounded-full bg-sky-400" />
                <span>
                  SOURCE: AESO ActualForecastWMRQH (load &amp; price) +
                  Seven-Day Hourly Available Capability (fuel availability)
                </span>
              </div>
              <div className="text-[11px] text-sky-200/80">
                WMRQH report date:{" "}
                <span className="font-mono">{reportDate}</span> · Current HE
                (approx, Alberta):{" "}
                <span className="font-mono">
                  HE {formatHe(currentHe)}
                </span>
              </div>
              <div className="flex flex-wrap gap-3 text-[11px] text-sky-100/90">
                <span>
                  AIL (actual):{" "}
                  <span className="font-mono">
                    {formatNumber(currentLoadActual, 0)} MW
                  </span>
                </span>
                <span>
                  AIL (forecast):{" "}
                  <span className="font-mono">
                    {formatNumber(currentLoadForecast, 0)} MW
                  </span>
                </span>
                <span>
                  Pool Price (actual):{" "}
                  <span className="font-mono">
                    {formatPrice(currentPriceActual)}
                  </span>
                </span>
                <span>
                  Pool Price (forecast):{" "}
                  <span className="font-mono">
                    {formatPrice(currentPriceForecast)}
                  </span>
                </span>
              </div>
            </div>

            <div className="max-w-xs space-y-1 text-[11px] text-sky-200/80">
              <p>
                Availability values are taken directly from AESO&apos;s
                Seven-Day Hourly Available Capability report. Numbers are
                treated as availability factors (0–1) where appropriate and
                scaled to percentage for display.
              </p>
              {!capDebug.ok && (
                <p className="text-[11px] text-amber-200/90">
                  Capability debug: HTTP {capDebug.httpStatus || 0}, rows{" "}
                  {capDebug.parsedRowCount}, lines {capDebug.lineCount}.{" "}
                  {capDebug.errorMessage ? capDebug.errorMessage : null}
                </p>
              )}
            </div>
          </div>
        </section>

        {/* Capability tables */}
        <section className="mt-6 space-y-8">
          {/* Current hour capability */}
          <section className="space-y-3">
            <div className="flex items-baseline justify-between gap-4">
              <h2 className="text-lg font-semibold">
                Current Hour Availability by Fuel (HE {formatHe(currentHe)})
              </h2>
              {hasCapability ? (
                <span className="text-xs text-slate-400">
                  From AESO 7-Day Hourly Available Capability report, date{" "}
                  {rowsForDate[0].date}.
                </span>
              ) : (
                <span className="text-xs text-amber-300">
                  No matching capability rows found for this date yet.
                </span>
              )}
            </div>

            <div className="overflow-x-auto rounded-xl border border-slate-800 bg-slate-950/60">
              <table className="min-w-full text-sm">
                <thead className="bg-slate-900/80 text-xs uppercase tracking-wide text-slate-300">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium">Fuel</th>
                    <th className="px-3 py-2 text-right font-medium">
                      Availability (%)
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {!hasCapability || sortedCurrentFuels.length === 0 ? (
                    <tr>
                      <td
                        colSpan={2}
                        className="px-3 py-4 text-center text-slate-500"
                      >
                        Capability data by fuel could not be parsed from the
                        AESO 7-Day report for this date/hour.
                      </td>
                    </tr>
                  ) : (
                    sortedCurrentFuels.map((fuel) => (
                      <tr
                        key={fuel}
                        className="border-t border-slate-800"
                      >
                        <td className="px-3 py-2 font-mono text-xs">
                          {fuel}
                        </td>
                        <td className="px-3 py-2 text-right">
                          {formatNumber(currentAvailByFuel[fuel], 1)}%
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </section>

          {/* Average capability over the day */}
          <section className="space-y-3">
            <h2 className="text-lg font-semibold">
              Average Availability Over the Day
            </h2>
            <div className="overflow-x-auto rounded-xl border border-slate-800 bg-slate-950/60">
              <table className="min-w-full text-sm">
                <thead className="bg-slate-900/80 text-xs uppercase tracking-wide text-slate-300">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium">Fuel</th>
                    <th className="px-3 py-2 text-right font-medium">
                      Avg Availability (%)
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {!hasCapability || sortedAvgFuels.length === 0 ? (
                    <tr>
                      <td
                        colSpan={2}
                        className="px-3 py-4 text-center text-slate-500"
                      >
                        Daily capability statistics will appear here once the
                        AESO 7-Day report format is successfully parsed for
                        this date.
                      </td>
                    </tr>
                  ) : (
                    sortedAvgFuels.map((fuel) => (
                      <tr
                        key={fuel}
                        className="border-t border-slate-800"
                      >
                        <td className="px-3 py-2 font-mono text-xs">
                          {fuel}
                        </td>
                        <td className="px-3 py-2 text-right">
                          {formatNumber(dailyAvgAvailByFuel[fuel], 1)}%
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </section>
      </div>
    </main>
  );
}
