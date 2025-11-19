// app/capability/page.tsx

import NavTabs from "../components/NavTabs";
import {
  getTodayHourlyStates,
  summarizeDay,
  fetchAesoActualForecastRows,
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

/** Same Alberta-time helper as /load-forecast */
function approxAlbertaNow() {
  const nowUtc = new Date();
  const nowAb = new Date(nowUtc.getTime() - 7 * 60 * 60 * 1000); // UTC-7
  const isoDate = nowAb.toISOString().slice(0, 10);
  // HE 01 is 00:00–01:00; approximate from hour.
  const he = ((nowAb.getHours() + 23) % 24) + 1;
  return { nowAb, isoDate, he };
}

/* ------------------------------------------------------------------ */
/*  AESO 7-Day Hourly Available Capability (HTML) parser               */
/* ------------------------------------------------------------------ */

/**
 * Public HTML URL for the 7-Day Hourly Available Capability report.
 * This is intentionally HTTP (not HTTPS) – the HTTPS endpoint often
 * requires a client certificate.
 */
const AESO_7DAY_CAPABILITY_HTML_URL =
  "http://ets.aeso.ca/ets_web/ip/Market/Reports/SevenDaysHourlyAvailableCapabilityReportServlet?contentType=html";

type Aeso7DayCapabilityCell = {
  date: string; // YYYY-MM-DD
  he: number; // 1..24
  fuel: string;
  availabilityPct: number; // already in %, e.g. 76.3
};

type Aeso7DayDebug = {
  ok: boolean;
  httpStatus: number;
  bodyLength: number;
  parsedCellCount: number;
  dates: string[];
  fuels: string[];
  sampleRows: string[];
  errorMessage?: string;
};

/** Parse "19-Nov-25" -> "2025-11-19" */
function parseShortDateToIso(s: string): string | null {
  const m = s.trim().match(/^(\d{1,2})-([A-Za-z]{3})-(\d{2})$/);
  if (!m) return null;
  const day = Number(m[1]);
  const monStr = m[2].toLowerCase();
  const yy = Number(m[3]);

  const monthMap: Record<string, number> = {
    jan: 1,
    feb: 2,
    mar: 3,
    apr: 4,
    may: 5,
    jun: 6,
    jul: 7,
    aug: 8,
    sep: 9,
    oct: 10,
    nov: 11,
    dec: 12,
  };
  const month = monthMap[monStr];
  if (!month || !day || !Number.isFinite(yy)) return null;

  const year = 2000 + yy;
  const mm = month.toString().padStart(2, "0");
  const dd = day.toString().padStart(2, "0");
  return `${year}-${mm}-${dd}`;
}

function isDateLike(s: string): boolean {
  return parseShortDateToIso(s) !== null;
}

/** Grab all cell texts from a single <tr> using a very loose HTML regex. */
function extractCellsFromRow(rowHtml: string): string[] {
  const cells: string[] = [];
  // No "s" (dotAll) flag so it works with ES2017; use [\s\S]*? instead.
  const cellRegex = /<(td|th)[^>]*>([\s\S]*?)<\/t[dh]>/gi;
  let m: RegExpExecArray | null;
  while ((m = cellRegex.exec(rowHtml)) !== null) {
    const inner = m[2]
      .replace(/<br\s*\/?>/gi, " ")
      .replace(/&nbsp;/gi, " ")
      .replace(/<[^>]*>/g, "")
      .trim();
    cells.push(inner);
  }
  return cells;
}

/**
 * Find the header row that contains "Hour Ending", then – in the same
 * table – find a nearby row that contains HE numbers 1..24. This
 * handles both one-row and two-row header layouts.
 */
function deriveHeColumnMap(
  rowHtmls: string[]
): { heToIndex: Map<number, number>; headerRowIndex: number } | null {
  // Step 1: locate the first row that mentions "Hour Ending".
  let hourEndingRowIndex = -1;
  for (let i = 0; i < rowHtmls.length; i++) {
    if (/hour\s*ending/i.test(rowHtmls[i])) {
      hourEndingRowIndex = i;
      break;
    }
  }
  if (hourEndingRowIndex === -1) return null;

  // Step 2: from that row forward, look at the next few rows (including it)
  // for a row whose cells are the HE numbers 1..24.
  const maxSearchIndex = Math.min(rowHtmls.length, hourEndingRowIndex + 4);
  for (let i = hourEndingRowIndex; i < maxSearchIndex; i++) {
    const row = rowHtmls[i];
    const cells = extractCellsFromRow(row);
    const heToIndex = new Map<number, number>();

    cells.forEach((cell, idx) => {
      const m = cell.replace(/\s+/g, "").match(/^(\d{1,2})$/);
      if (!m) return;
      const n = Number(m[1]);
      if (Number.isFinite(n) && n >= 1 && n <= 24) {
        heToIndex.set(n, idx);
      }
    });

    if (heToIndex.size > 0) {
      return { heToIndex, headerRowIndex: i };
    }
  }

  return null;
}

/** Parse the AESO HTML into capability cells. */
function parseAeso7DayHtml(html: string): {
  cells: Aeso7DayCapabilityCell[];
  debug: Aeso7DayDebug;
} {
  // There are multiple tables; find the one that actually contains
  // "Hour Ending" (the main data grid).
  const tableRegex = /<table[^>]*>([\s\S]*?)<\/table>/gi;
  let m: RegExpExecArray | null;
  let chosenInner: string | null = null;

  while ((m = tableRegex.exec(html)) !== null) {
    const inner = m[1];
    if (/hour\s*ending/i.test(inner)) {
      chosenInner = inner;
      break;
    }
    if (chosenInner === null) {
      // fall back to first table if none contain "Hour Ending"
      chosenInner = inner;
    }
  }

  if (!chosenInner) {
    return {
      cells: [],
      debug: {
        ok: false,
        httpStatus: 200,
        bodyLength: html.length,
        parsedCellCount: 0,
        dates: [],
        fuels: [],
        sampleRows: [],
        errorMessage: "No <table> element containing 'Hour Ending' found",
      },
    };
  }

  const rowHtmls = chosenInner
    .split(/<\/tr>/i)
    .filter((r) => r.trim().length > 0);

  const heMeta = deriveHeColumnMap(rowHtmls);
  if (!heMeta) {
    return {
      cells: [],
      debug: {
        ok: false,
        httpStatus: 200,
        bodyLength: html.length,
        parsedCellCount: 0,
        dates: [],
        fuels: [],
        sampleRows: [],
        errorMessage:
          'Could not find a header row containing "Hour Ending" followed by HE 1–24 columns',
      },
    };
  }

  const { heToIndex, headerRowIndex } = heMeta;
  const cellsOut: Aeso7DayCapabilityCell[] = [];
  let currentFuel = "";

  // Start after the header rows.
  for (let i = headerRowIndex + 1; i < rowHtmls.length; i++) {
    const rowHtml = rowHtmls[i];
    const cells = extractCellsFromRow(rowHtml).map((c) =>
      c.replace(/\s+/g, " ").trim()
    );
    if (!cells.length) continue;

    // Find a date-like cell in this row.
    let dateIdx = -1;
    let dateIso: string | null = null;
    for (let idx = 0; idx < cells.length; idx++) {
      const iso = parseShortDateToIso(cells[idx]);
      if (iso) {
        dateIdx = idx;
        dateIso = iso;
        break;
      }
    }
    if (dateIdx === -1 || !dateIso) continue;

    // Fuel label normally lives in a separate column (rowspan) next to
    // the date column. We take the cell immediately BEFORE the date
    // if it is not itself a date; otherwise we carry forward the
    // previous fuel name.
    let fuel = currentFuel;
    if (dateIdx > 0 && cells[dateIdx - 1] && !isDateLike(cells[dateIdx - 1])) {
      fuel = cells[dateIdx - 1];
      currentFuel = fuel;
    }
    if (!fuel) continue;

    // For each HE column, pull the numeric percentage.
    heToIndex.forEach((colIdx, he) => {
      if (colIdx >= cells.length) return;
      const raw = cells[colIdx];
      if (!raw) return;
      const numMatch = raw.match(/(\d+(?:\.\d+)?)/);
      if (!numMatch) return;
      const val = Number(numMatch[1]);
      if (!Number.isFinite(val)) return;

      cellsOut.push({
        date: dateIso!,
        he,
        fuel,
        availabilityPct: val,
      });
    });
  }

  const dates = Array.from(new Set(cellsOut.map((c) => c.date))).sort();
  const fuels = Array.from(new Set(cellsOut.map((c) => c.fuel))).sort();
  const sampleRows = cellsOut.slice(0, 12).map((c) => {
    return `${c.date} HE${formatHe(c.he)} ${c.fuel}: ${c.availabilityPct.toFixed(
      1
    )}%`;
  });

  return {
    cells: cellsOut,
    debug: {
      ok: cellsOut.length > 0,
      httpStatus: 200,
      bodyLength: html.length,
      parsedCellCount: cellsOut.length,
      dates,
      fuels,
      sampleRows,
    },
  };
}

/** Fetch the AESO 7-Day HTML and parse it into cells + debug info. */
async function fetchAeso7DayCapabilityCells(): Promise<{
  cells: Aeso7DayCapabilityCell[];
  debug: Aeso7DayDebug;
}> {
  let httpStatus = 0;
  let text: string | null = null;

  try {
    const res = await fetch(AESO_7DAY_CAPABILITY_HTML_URL, {
      cache: "no-store",
    });
    httpStatus = res.status;

    if (!res.ok) {
      return {
        cells: [],
        debug: {
          ok: false,
          httpStatus,
          bodyLength: 0,
          parsedCellCount: 0,
          dates: [],
          fuels: [],
          sampleRows: [],
          errorMessage: `HTTP ${res.status} ${res.statusText}`,
        },
      };
    }

    text = await res.text();
  } catch (err: any) {
    return {
      cells: [],
      debug: {
        ok: false,
        httpStatus,
        bodyLength: 0,
        parsedCellCount: 0,
        dates: [],
        fuels: [],
        sampleRows: [],
        errorMessage: String(err?.message ?? err),
      },
    };
  }

  if (!text) {
    return {
      cells: [],
      debug: {
        ok: false,
        httpStatus,
        bodyLength: 0,
        parsedCellCount: 0,
        dates: [],
        fuels: [],
        sampleRows: [],
        errorMessage: "Empty response body from AESO 7-Day Capability HTML",
      },
    };
  }

  const parsed = parseAeso7DayHtml(text);
  return {
    cells: parsed.cells,
    debug: {
      ...parsed.debug,
      httpStatus,
      bodyLength: text.length,
    },
  };
}

/* ---------- main page ---------- */

export default async function CapabilityPage() {
  const [{ rows, debug: wmrqhDebug }, states, sevenDay] = await Promise.all([
    fetchAesoActualForecastRows(),
    getTodayHourlyStates() as Promise<HourlyState[]>,
    fetchAeso7DayCapabilityCells(),
  ]);

  const { cells: capCells, debug: capDebug } = sevenDay;

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
              This view depends on AESO&apos;s Actual/Forecast WMRQH report.
              Right now, no rows could be loaded, so the page cannot show
              current load, price, or capability yet.
            </p>
          </header>

          <NavTabs />

          <section className="mt-6 rounded-2xl border border-slate-800 bg-slate-900/70 px-4 py-3 text-xs text-slate-300">
            <p className="font-medium text-slate-200">
              No AESO WMRQH data available.
            </p>
            <p className="mt-1 text-[11px] text-slate-400">
              Debug: HTTP {wmrqhDebug.httpStatus || 0}, parsed rows{" "}
              {wmrqhDebug.parsedRowCount}, report dates{" "}
              {wmrqhDebug.reportDates.length
                ? wmrqhDebug.reportDates.join(", ")
                : "none"}
              {wmrqhDebug.errorMessage
                ? ` · error: ${wmrqhDebug.errorMessage}`
                : null}
            </p>
          </section>
        </div>
      </main>
    );
  }

  const summary = summarizeDay(states);
  const { isoDate: todayAbIso, he: approxHe } = approxAlbertaNow();
  const reportDate = summary.date;

  // Choose a "current" HE:
  let chosenHe: number;
  if (reportDate === todayAbIso) {
    chosenHe = approxHe;
  } else if (summary.current) {
    chosenHe = summary.current.he;
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

  /* ----- Shape 7-Day capability into "current HE" + daily averages ----- */

  let capDate = reportDate;
  let capCellsForDate = capCells.filter((c) => c.date === capDate);

  if (!capCellsForDate.length && capCells.length) {
    const allDates = Array.from(new Set(capCells.map((c) => c.date))).sort();
    capDate = allDates[allDates.length - 1];
    capCellsForDate = capCells.filter((c) => c.date === capDate);
  }

  const hasCapability = capCellsForDate.length > 0;

  const currentCells = capCellsForDate.filter((c) => c.he === currentHe);
  const currentAvailByFuel: Record<string, number> = {};
  for (const c of currentCells) {
    currentAvailByFuel[c.fuel] = c.availabilityPct;
  }

  const dailyAvgAvailByFuel: Record<string, number> = {};
  if (hasCapability) {
    const sums: Record<string, { sum: number; count: number }> = {};
    for (const c of capCellsForDate) {
      if (!sums[c.fuel]) sums[c.fuel] = { sum: 0, count: 0 };
      sums[c.fuel].sum += c.availabilityPct;
      sums[c.fuel].count += 1;
    }
    for (const [fuel, { sum, count }] of Object.entries(sums)) {
      dailyAvgAvailByFuel[fuel] = sum / Math.max(count, 1);
    }
  }

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
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
            Market Capability (Real AESO Load, Price &amp; Availability)
          </h1>
          <p className="max-w-3xl text-sm text-slate-400">
            This view combines AESO&apos;s Actual/Forecast WMRQH report
            (load and pool price) with the 7-Day Hourly Available
            Capability report. Availability by fuel is interpreted directly
            from AESO&apos;s HTML (scaled as percentages). No synthetic
            modelling is used.
          </p>
        </header>

        {/* Shared nav bar */}
        <NavTabs />

        {/* Summary banner: WMRQH + compact 7-Day debug, link inside bar */}
        <section className="mt-4 rounded-2xl border border-sky-900 bg-sky-950/40 px-4 py-3 text-xs text-sky-100">
          <div className="space-y-2">
            {/* Top row: source chip + 7-day link button */}
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div className="inline-flex items-center gap-2 rounded-full bg-sky-900/80 px-3 py-1 text-[11px] font-medium">
                <span className="h-2 w-2 rounded-full bg-sky-400" />
                <span>SOURCE: AESO ActualForecastWMRQH (load &amp; price)</span>
              </div>

              <a
                href={AESO_7DAY_CAPABILITY_HTML_URL}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center justify-center rounded-full border border-sky-500/70 bg-sky-900/40 px-3 py-1.5 text-[11px] font-semibold text-sky-100 hover:bg-sky-800/60"
              >
                Open AESO 7-Day Capability (HTML)
              </a>
            </div>

            {/* WMRQH date & HE */}
            <div className="text-[11px] text-sky-200/80">
              WMRQH report date:{" "}
              <span className="font-mono">{reportDate}</span> · Current HE
              (approx, Alberta):{" "}
              <span className="font-mono">HE {formatHe(currentHe)}</span>
            </div>

            {/* Current load & price snapshot */}
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

            {/* Compact debug lines */}
            <div className="mt-1 space-y-1 text-[11px] text-sky-300/80">
              <p>
                WMRQH debug: HTTP {wmrqhDebug.httpStatus || 0}, rows{" "}
                {wmrqhDebug.parsedRowCount}, dates{" "}
                {wmrqhDebug.reportDates.length
                  ? wmrqhDebug.reportDates.join(", ")
                  : "none"}
                {wmrqhDebug.errorMessage
                  ? ` · error: ${wmrqhDebug.errorMessage}`
                  : null}
              </p>
              <p>
                7-Day capability debug: HTTP {capDebug.httpStatus || 0},{" "}
                body length {capDebug.bodyLength} chars, parsed cells{" "}
                {capDebug.parsedCellCount}
                {capDebug.dates.length
                  ? ` · dates: ${capDebug.dates.join(", ")}`
                  : ""}
                {capDebug.errorMessage
                  ? ` · error: ${capDebug.errorMessage}`
                  : ""}
              </p>
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
                  {capDate}.
                </span>
              ) : (
                <span className="text-xs text-amber-300">
                  No parsed capability rows found for this date/HE yet.
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
                        Capability data by fuel could not be derived from the
                        AESO 7-Day report for this date/hour (or no rows were
                        parsed).
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
                        AESO 7-Day report is successfully parsed for this date.
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
