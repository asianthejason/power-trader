// app/capability/page.tsx

import NavTabs from "../components/NavTabs";
import {
  getTodayHourlyStates,
  summarizeDay,
  fetchAesoActualForecastRows,
  type HourlyState,
  type AesoForecastDebug,
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
/*  AESO 7-Day Hourly Available Capability (HTML) debug helper        */
/* ------------------------------------------------------------------ */

/**
 * NOTE: AESO publishes the 7-Day Hourly Available Capability report
 * only as HTML, not CSV. This helper *does not* try to parse it – it just
 * fetches the raw HTML and exposes basic debug info so you can confirm
 * what the Vercel backend is seeing.
 *
 * You can open exactly the same HTML in your browser with the button
 * on the page.
 */
const AESO_7DAY_CAPABILITY_HTML_URL =
  "http://ets.aeso.ca/ets_web/ip/Market/Reports/SevenDaysHourlyAvailableCapabilityReportServlet?contentType=html";

type Aeso7DayDebug = {
  ok: boolean;
  httpStatus: number;
  bodyLength: number;
  errorMessage?: string;
};

async function fetchAeso7DayCapabilityHtmlDebug(): Promise<Aeso7DayDebug> {
  let httpStatus = 0;

  try {
    const res = await fetch(AESO_7DAY_CAPABILITY_HTML_URL, {
      cache: "no-store",
    });
    httpStatus = res.status;

    if (!res.ok) {
      return {
        ok: false,
        httpStatus,
        bodyLength: 0,
        errorMessage: `HTTP ${res.status} ${res.statusText}`,
      };
    }

    const text = await res.text();
    return {
      ok: true,
      httpStatus,
      bodyLength: text.length,
    };
  } catch (err: any) {
    return {
      ok: false,
      httpStatus,
      bodyLength: 0,
      errorMessage: String(err?.message ?? err),
    };
  }
}

/* ---------- main page ---------- */

export default async function CapabilityPage() {
  // Pull today’s hourly states (pure WMRQH data, no synthetic),
  // WMRQH debug info, and a simple 7-Day HTML debug in parallel.
  const [
    states,
    { debug: wmrqhDebug },
    sevenDayDebug,
  ] = await Promise.all([
    getTodayHourlyStates() as Promise<HourlyState[]>,
    fetchAesoActualForecastRows(),
    fetchAeso7DayCapabilityHtmlDebug(),
  ]);

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

  // Use Alberta HE when report date matches today; otherwise fall back
  // to a mid-day HE from the dataset.
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

  const has7Day = sevenDayDebug.ok;

  return (
    <main className="min-h-screen bg-slate-950 text-slate-100">
      <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
        {/* Page header */}
        <header className="mb-4 space-y-2">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-baseline sm:justify-between">
            <div>
              <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
                Market Capability (Real AESO Load &amp; Price – Capability
                Pending)
              </h1>
              <p className="max-w-3xl text-sm text-slate-400">
                This view now uses AESO&apos;s Actual/Forecast WMRQH report
                for load and pool price. Availability by fuel will come from
                AESO&apos;s 7-Day Hourly Available Capability report
                (HTML) in a later phase once a robust HTML parser / ETL
                is in place. No synthetic modelling is used here.
              </p>
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
        </header>

        {/* Shared nav bar */}
        <NavTabs />

        {/* Summary banner: WMRQH + 7-Day debug */}
        <section className="mt-4 rounded-2xl border border-sky-900 bg-sky-950/40 px-4 py-3 text-xs text-sky-100">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            {/* Left: WMRQH (load & price) */}
            <div className="space-y-1">
              <div className="inline-flex items-center gap-2 rounded-full bg-sky-900/80 px-3 py-1 text-[11px] font-medium">
                <span className="h-2 w-2 rounded-full bg-sky-400" />
                <span>SOURCE: AESO ActualForecastWMRQH (load &amp; price)</span>
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

              <div className="mt-1 text-[11px] text-sky-300/80">
                WMRQH debug: HTTP {wmrqhDebug.httpStatus || 0}, rows{" "}
                {wmrqhDebug.parsedRowCount}, dates{" "}
                {wmrqhDebug.reportDates.length
                  ? wmrqhDebug.reportDates.join(", ")
                  : "none"}
                {wmrqhDebug.errorMessage
                  ? ` · error: ${wmrqhDebug.errorMessage}`
                  : null}
              </div>
            </div>

            {/* Right: 7-Day HTML debug */}
            <div className="max-w-xs space-y-1 text-[11px] text-sky-200/80">
              <p>
                The 7-Day Hourly Available Capability report is published by
                AESO only in HTML format. To keep this backend simple and
                robust, we are not yet parsing that HTML into a machine-readable
                feed. Use the button above to open the official AESO report in
                a new tab and compare directly.
              </p>
              <p className="mt-1 text-[11px] text-sky-100/90">
                7-Day capability debug: HTTP {sevenDayDebug.httpStatus || 0},{" "}
                body length {sevenDayDebug.bodyLength} chars
                {sevenDayDebug.errorMessage
                  ? ` · error: ${sevenDayDebug.errorMessage}`
                  : ""}
                .
              </p>
            </div>
          </div>
        </section>

        {/* Capability tables – explicitly marked as “pending” */}
        <section className="mt-6 space-y-8">
          {/* Current hour capability */}
          <section className="space-y-3">
            <div className="flex items-baseline justify-between gap-4">
              <h2 className="text-lg font-semibold">
                Current Hour Availability by Fuel (HE {formatHe(currentHe)})
              </h2>
              <span className="text-xs text-amber-300">
                Availability by fuel has not yet been wired to the AESO 7-Day
                report – shown as empty.
              </span>
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
                  <tr>
                    <td
                      colSpan={2}
                      className="px-3 py-4 text-center text-slate-500"
                    >
                      Capability data by fuel will appear here once the AESO
                      7-Day Hourly Available Capability HTML is parsed and
                      integrated.
                    </td>
                  </tr>
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
                  <tr>
                    <td
                      colSpan={2}
                      className="px-3 py-4 text-center text-slate-500"
                    >
                      Daily capability statistics will appear here once the AESO
                      7-Day report is ingested into a machine-readable format
                      for this date.
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </section>
        </section>
      </div>
    </main>
  );
}
