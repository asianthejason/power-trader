// src/app/interties/page.tsx

import NavTabs from "../components/NavTabs";
import AutoRefresh from "./AutoRefresh";

// Revalidate every 30 seconds – matches the client-side refresh interval.
export const revalidate = 30;

/* ---------- helpers ---------- */

function formatNumber(
  n: number | null | undefined,
  decimals = 0
): string {
  if (n == null || Number.isNaN(n)) return "—";
  return n.toLocaleString(undefined, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

// Approximate "now" in Alberta as UTC-7.
function approxAlbertaNow() {
  const nowUtc = new Date();
  const offsetMs = 7 * 60 * 60 * 1000; // 7 hours
  const nowAb = new Date(nowUtc.getTime() - offsetMs);
  const isoDate = nowAb.toISOString().slice(0, 10); // YYYY-MM-DD
  return { nowAb, isoDate };
}

type IntertiePath = "AB-BC" | "AB-SK" | "AB-MATL";

type IntertieSnapshot = {
  path: IntertiePath;
  counterparty: string;
  // Net actual flow from AESO CSD, MW. Positive = exports from Alberta,
  // negative = imports into Alberta (matches AESO convention).
  actualFlowMw: number | null;
};

type IntertieSnapshotResult = {
  asOfAb: Date | null;
  rows: IntertieSnapshot[];
  systemNetInterchangeMw: number | null;
};

/**
 * Very small HTML scraper for AESO's Current Supply Demand report.
 *
 * We only touch:
 *   - the INTERCHANGE table (BC / Montana / Saskatchewan)
 *   - the SUMMARY row "Net Actual Interchange"
 *
 * No synthetic numbers – if parsing fails we surface nulls.
 *
 * Source:
 *   http://ets.aeso.ca/ets_web/ip/Market/Reports/CSDReportServlet
 */
async function fetchAesoInterchangeSnapshot(): Promise<IntertieSnapshotResult> {
  const AESO_CSD_URL =
    "http://ets.aeso.ca/ets_web/ip/Market/Reports/CSDReportServlet";

  try {
    // Let Next.js handle caching at the page level via export const revalidate.
    const res = await fetch(AESO_CSD_URL);

    if (!res.ok) {
      console.error("Failed to fetch AESO CSD:", res.status, res.statusText);
      return { asOfAb: null, rows: [], systemNetInterchangeMw: null };
    }

    const html = await res.text();

    // Path-level net flows from INTERCHANGE table
    const bc = extractFlowForLabel(html, "British Columbia");
    const mt = extractFlowForLabel(html, "Montana");
    const sk = extractFlowForLabel(html, "Saskatchewan");

    // System-wide net interchange from SUMMARY table
    const systemNet = extractFlowForLabel(html, "Net Actual Interchange");

    const { nowAb } = approxAlbertaNow();

    const rows: IntertieSnapshot[] = [
      {
        path: "AB-BC",
        counterparty: "British Columbia",
        actualFlowMw: bc,
      },
      {
        path: "AB-MATL",
        counterparty: "Montana (MATL)",
        actualFlowMw: mt,
      },
      {
        path: "AB-SK",
        counterparty: "Saskatchewan",
        actualFlowMw: sk,
      },
    ];

    return { asOfAb: nowAb, rows, systemNetInterchangeMw: systemNet };
  } catch (err) {
    console.error("Error fetching/parsing AESO CSD:", err);
    return { asOfAb: null, rows: [], systemNetInterchangeMw: null };
  }
}

/**
 * Given the raw HTML from CSDReportServlet, find the numeric MW value
 * that appears in a table row after the given label.
 *
 * The HTML for those rows typically looks like:
 *
 *   <tr><td>British Columbia</td><td>-435</td></tr>
 *   <tr><td>Net Actual Interchange</td><td>-489</td></tr>
 *
 * So we:
 *   1. Find the first occurrence of the label string.
 *   2. Look ahead for "</td><td>NUMBER</td>".
 */
function extractFlowForLabel(html: string, label: string): number | null {
  const idx = html.indexOf(label);
  if (idx === -1) return null;

  const tail = html.slice(idx);
  const match = tail.match(/<\/td>\s*<td>\s*(-?\d+)\s*<\/td>/i);
  if (!match) return null;

  const n = Number(match[1]);
  return Number.isFinite(n) ? n : null;
}

/* ---------- ATC / capability (api/v2/interchange) ---------- */

type HourlyAtcRow = {
  he: number;
  bcImportCap: number | null;
  bcExportCap: number | null;
  matlImportCap: number | null;
  matlExportCap: number | null;
  skImportCap: number | null;
  skExportCap: number | null;
  systemImportCap: number | null;
  systemExportCap: number | null;
  bcMatlImportCap: number | null;
  bcMatlExportCap: number | null;
};

type AesoAllocation = {
  date?: string;
  he?: string;
  name?: string;
  import?: { atc?: number | null } | null;
  export?: { atc?: number | null } | null;
};

type AesoInterchangeJson = {
  message?: string;
  responseCode?: string;
  localTimestamp?: string;
  return?: {
    [key: string]:
      | {
          Allocations?: AesoAllocation[];
        }
      | undefined;
  };
};

/**
 * Pull today’s ATC capability curves from AESO’s
 *   https://itc.aeso.ca/itc/public/api/v2/interchange
 *
 * We request dataType=ATC and then collapse the JSON into one row per HE
 * with BC / MATL / SK / System / BC+MATL capability.
 *
 * All numbers are straight from AESO; no synthetic modelling.
 */
async function fetchTodayAtcRows(): Promise<{
  date: string;
  rows: HourlyAtcRow[];
}> {
  const { isoDate } = approxAlbertaNow();
  const dateParam = isoDate.replace(/-/g, "");

  const url = new URL(
    "https://itc.aeso.ca/itc/public/api/v2/interchange"
  );
  url.searchParams.set("startDate", dateParam);
  url.searchParams.set("endDate", dateParam);
  url.searchParams.set("startHE", "1");
  url.searchParams.set("endHE", "24");
  url.searchParams.set("Accept", "application/json");
  url.searchParams.set("version", "false");
  url.searchParams.set("dataType", "ATC");

  const blankRows: Record<number, HourlyAtcRow> = {};
  for (let he = 1; he <= 24; he++) {
    blankRows[he] = {
      he,
      bcImportCap: null,
      bcExportCap: null,
      matlImportCap: null,
      matlExportCap: null,
      skImportCap: null,
      skExportCap: null,
      systemImportCap: null,
      systemExportCap: null,
      bcMatlImportCap: null,
      bcMatlExportCap: null,
    };
  }

  try {
    const res = await fetch(url.toString());

    if (!res.ok) {
      console.error("Failed to fetch AESO ATC JSON:", res.statusText);
      return { date: isoDate, rows: Object.values(blankRows) };
    }

    const data = (await res.json()) as AesoInterchangeJson;
    const ret = data.return || {};

    const flowgateKeys = [
      "BcIntertie",
      "SkIntertie",
      "MatlIntertie",
      "SystemlFlowgate",
      "BcMatlFlowgate",
    ] as const;

    for (const key of flowgateKeys) {
      const section = ret[key];
      if (!section || !Array.isArray(section.Allocations)) continue;

      for (const alloc of section.Allocations) {
        if (!alloc || alloc.date !== isoDate) continue;
        const heNum = Number(alloc.he);
        if (!Number.isFinite(heNum) || heNum < 1 || heNum > 24) continue;

        const row = blankRows[heNum];
        const importAtc =
          alloc.import && typeof alloc.import.atc === "number"
            ? alloc.import.atc
            : null;
        const exportAtc =
          alloc.export && typeof alloc.export.atc === "number"
            ? alloc.export.atc
            : null;

        switch (key) {
          case "BcIntertie":
            row.bcImportCap = importAtc;
            row.bcExportCap = exportAtc;
            break;
          case "SkIntertie":
            row.skImportCap = importAtc;
            row.skExportCap = exportAtc;
            break;
          case "MatlIntertie":
            row.matlImportCap = importAtc;
            row.matlExportCap = exportAtc;
            break;
          case "SystemlFlowgate":
            row.systemImportCap = importAtc;
            row.systemExportCap = exportAtc;
            break;
          case "BcMatlFlowgate":
            row.bcMatlImportCap = importAtc;
            row.bcMatlExportCap = exportAtc;
            break;
        }
      }
    }

    return {
      date: isoDate,
      rows: Object.values(blankRows).sort((a, b) => a.he - b.he),
    };
  } catch (err) {
    console.error("Error fetching/parsing AESO ATC JSON:", err);
    return { date: isoDate, rows: Object.values(blankRows) };
  }
}

/* ---------- page ---------- */

export default async function IntertiesPage() {
  const [
    { asOfAb, rows: pathRows, systemNetInterchangeMw },
    { date: atcDate, rows: atcRows },
  ] = await Promise.all([
    fetchAesoInterchangeSnapshot(),
    fetchTodayAtcRows(),
  ]);

  const hasPathData = pathRows.some((r) => r.actualFlowMw != null);
  const sumOfPathsMw = pathRows.reduce((acc, r) => {
    if (r.actualFlowMw == null) return acc;
    return acc + r.actualFlowMw;
  }, 0);

  const deltaSystemVsPaths =
    systemNetInterchangeMw != null && hasPathData
      ? systemNetInterchangeMw - sumOfPathsMw
      : null;

  const hasAnyAtc =
    atcRows.length > 0 &&
    atcRows.some(
      (r) =>
        r.bcImportCap != null ||
        r.bcExportCap != null ||
        r.matlImportCap != null ||
        r.matlExportCap != null ||
        r.skImportCap != null ||
        r.skExportCap != null ||
        r.systemImportCap != null ||
        r.systemExportCap != null ||
        r.bcMatlImportCap != null ||
        r.bcMatlExportCap != null
    );

  return (
    <main className="min-h-screen bg-slate-950 text-slate-100">
      {/* client-side auto-refresh every 30s */}
      <AutoRefresh intervalMs={30000} />

      <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
        {/* Header */}
        <header className="mb-4 space-y-2">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-baseline sm:justify-between">
            <div>
              <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
                Interties
              </h1>
              <p className="max-w-2xl text-sm text-slate-400">
                Real-time net flows and hourly transfer capability on the
                Alberta interties, pulled directly from AESO&apos;s Current
                Supply Demand report and Interchange ATC API. Positive values
                mean Alberta is exporting; negative values mean Alberta is
                importing. No synthetic modelling is used on this page.
              </p>
            </div>

            <div className="flex flex-col items-start gap-1 text-[11px] text-slate-400 sm:items-end">
              <span className="inline-flex items-center rounded-full border border-slate-700 bg-slate-900/70 px-2 py-0.5">
                <span className="mr-1.5 h-1.5 w-1.5 rounded-full bg-emerald-400" />
                Live snapshot from AESO CSD / ATC
              </span>
              {asOfAb && (
                <span className="font-mono">
                  As of approx.&nbsp;
                  {asOfAb.toLocaleString("en-CA", {
                    timeZone: "America/Edmonton",
                    hour12: false,
                  })}
                  &nbsp;AB time
                </span>
              )}
            </div>
          </div>
        </header>

        <NavTabs />

        {/* System summary cards */}
        <section className="mt-4 mb-4 grid gap-3 sm:grid-cols-3">
          <div className="rounded-2xl border border-slate-800 bg-slate-900/80 p-3">
            <div className="text-[11px] uppercase tracking-wide text-slate-400">
              System Net Actual Interchange
            </div>
            <div className="mt-1 flex items-baseline gap-2">
              <div className="text-lg font-semibold">
                {systemNetInterchangeMw != null
                  ? `${formatNumber(systemNetInterchangeMw, 0)} MW`
                  : "—"}
              </div>
            </div>
            <p className="mt-1 text-[11px] text-slate-500">
              From the CSD summary row &quot;Net Actual Interchange&quot;.
              Positive = net export from Alberta; negative = net import into
              Alberta.
            </p>
          </div>

          <div className="rounded-2xl border border-slate-800 bg-slate-900/80 p-3">
            <div className="text-[11px] uppercase tracking-wide text-slate-400">
              Sum of path flows (AB-BC, AB-MATL, AB-SK)
            </div>
            <div className="mt-1 text-lg font-semibold">
              {hasPathData ? `${formatNumber(sumOfPathsMw, 0)} MW` : "—"}
            </div>
            <p className="mt-1 text-[11px] text-slate-500">
              Simple sum of the three intertie paths shown below. Should be
              close to the system net interchange, with differences due to
              losses, metering, and any additional paths/model details.
            </p>
          </div>

          <div className="rounded-2xl border border-slate-800 bg-slate-900/80 p-3">
            <div className="text-[11px] uppercase tracking-wide text-slate-400">
              Difference (system − path sum)
            </div>
            <div className="mt-1 text-lg font-semibold">
              {deltaSystemVsPaths != null
                ? `${formatNumber(deltaSystemVsPaths, 0)} MW`
                : "—"}
            </div>
            <p className="mt-1 text-[11px] text-slate-500">
              Quick sanity check. Large persistent deltas are a cue to look more
              closely at AESO&apos;s reports and your parsing.
            </p>
          </div>
        </section>

        {/* Path net flow table */}
        <section className="rounded-2xl border border-slate-800 bg-slate-900/80 p-4">
          <div className="mb-3 flex items-baseline justify-between gap-2">
            <div>
              <h2 className="text-sm font-semibold tracking-tight">
                Current Intertie Flows by Path
              </h2>
              <p className="text-[11px] text-slate-400">
                Snapshot of net interchange on each path from the INTERCHANGE
                table in AESO&apos;s Current Supply Demand report. To build a
                full HE-by-HE history with Import/Export ATC and scheduled
                volumes, you&apos;ll wire this page to AESO&apos;s Interchange
                capability APIs and your own persisted time series.
              </p>
            </div>
          </div>

          <div className="overflow-x-auto rounded-xl border border-slate-800 bg-slate-950/40">
            <table className="min-w-full text-left text-xs">
              <thead className="bg-slate-900/80 text-[11px] uppercase tracking-wide text-slate-400">
                <tr>
                  <th className="px-3 py-2">Path</th>
                  <th className="px-3 py-2">Counterparty</th>
                  <th className="px-3 py-2">Net flow (MW)</th>
                  <th className="px-3 py-2">Direction</th>
                  <th className="px-3 py-2">Notes</th>
                </tr>
              </thead>
              <tbody>
                {pathRows.map((row) => {
                  const v = row.actualFlowMw;
                  let direction: string = "—";
                  if (v != null) {
                    if (v > 0) direction = "Export from Alberta";
                    else if (v < 0) direction = "Import into Alberta";
                    else direction = "Balanced";
                  }

                  return (
                    <tr
                      key={row.path}
                      className="border-t border-slate-800/60 hover:bg-slate-900/40"
                    >
                      <td className="px-3 py-2 text-[11px] font-medium text-slate-200">
                        {row.path}
                      </td>
                      <td className="px-3 py-2 text-[11px] text-slate-300">
                        {row.counterparty}
                      </td>
                      <td className="px-3 py-2 text-[11px] text-slate-200">
                        {v != null ? formatNumber(v, 0) : "—"}
                      </td>
                      <td className="px-3 py-2 text-[11px] text-slate-300">
                        {direction}
                      </td>
                      <td className="px-3 py-2 text-[11px] text-slate-400">
                        Positive = exports from Alberta; negative = imports into
                        Alberta. Values should line up with the corresponding
                        rows in the CSD INTERCHANGE table.
                      </td>
                    </tr>
                  );
                })}

                {!pathRows.length && (
                  <tr>
                    <td
                      className="px-3 py-4 text-center text-[11px] text-slate-500"
                      colSpan={5}
                    >
                      Could not fetch intertie data from AESO right now. This
                      can happen when the CSD page is temporarily unavailable.
                      No synthetic fallback is used – refresh later to try
                      again.
                    </td>
                  </tr>
                )}

                {pathRows.length > 0 && !hasPathData && (
                  <tr>
                    <td
                      className="px-3 py-3 text-center text-[11px] text-amber-400/90"
                      colSpan={5}
                    >
                      The CSD page responded, but the INTERCHANGE rows for
                      British Columbia, Montana, and Saskatchewan did not parse
                      cleanly. Check AESO&apos;s HTML – this scraper assumes
                      simple table rows with the label followed by a numeric MW
                      value.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <p className="mt-2 text-[11px] text-slate-500">
            Data source: AESO Current Supply Demand Report (CSD).
          </p>
        </section>

        {/* Hour-by-hour ATC / capability table */}
        <section className="mt-6 rounded-2xl border border-slate-800 bg-slate-900/80 p-4">
          <div className="mb-3 flex items-baseline justify-between gap-2">
            <div>
              <h2 className="text-sm font-semibold tracking-tight">
                Today&apos;s Intertie ATC by Hour
              </h2>
              <p className="text-[11px] text-slate-400">
                Hour-ending capabilities from AESO&apos;s Interchange ATC API
                (dataType=ATC) for {atcDate}. Import / export ATC are shown in
                MW for each path and for the combined BC+MATL flowgate and
                provincial system.
              </p>
            </div>
          </div>

          <div className="overflow-x-auto rounded-xl border border-slate-800 bg-slate-950/40">
            <table className="min-w-full text-left text-xs">
              <thead className="bg-slate-900/80 text-[11px] uppercase tracking-wide text-slate-400">
                <tr>
                  <th className="px-3 py-2">HE</th>
                  <th className="px-3 py-2">BC Import ATC</th>
                  <th className="px-3 py-2">BC Export ATC</th>
                  <th className="px-3 py-2">MATL Import ATC</th>
                  <th className="px-3 py-2">MATL Export ATC</th>
                  <th className="px-3 py-2">SK Import ATC</th>
                  <th className="px-3 py-2">SK Export ATC</th>
                  <th className="px-3 py-2">BC+MATL Import ATC</th>
                  <th className="px-3 py-2">BC+MATL Export ATC</th>
                  <th className="px-3 py-2">System Import ATC</th>
                  <th className="px-3 py-2">System Export ATC</th>
                </tr>
              </thead>
              <tbody>
                {hasAnyAtc ? (
                  atcRows.map((r) => (
                    <tr
                      key={r.he}
                      className="border-t border-slate-800/60 hover:bg-slate-900/40"
                    >
                      <td className="px-3 py-2 text-[11px] font-medium text-slate-200">
                        HE {r.he.toString().padStart(2, "0")}
                      </td>
                      <td className="px-3 py-2 text-[11px] text-slate-300">
                        {formatNumber(r.bcImportCap, 0)}
                      </td>
                      <td className="px-3 py-2 text-[11px] text-slate-300">
                        {formatNumber(r.bcExportCap, 0)}
                      </td>
                      <td className="px-3 py-2 text-[11px] text-slate-300">
                        {formatNumber(r.matlImportCap, 0)}
                      </td>
                      <td className="px-3 py-2 text-[11px] text-slate-300">
                        {formatNumber(r.matlExportCap, 0)}
                      </td>
                      <td className="px-3 py-2 text-[11px] text-slate-300">
                        {formatNumber(r.skImportCap, 0)}
                      </td>
                      <td className="px-3 py-2 text-[11px] text-slate-300">
                        {formatNumber(r.skExportCap, 0)}
                      </td>
                      <td className="px-3 py-2 text-[11px] text-slate-300">
                        {formatNumber(r.bcMatlImportCap, 0)}
                      </td>
                      <td className="px-3 py-2 text-[11px] text-slate-300">
                        {formatNumber(r.bcMatlExportCap, 0)}
                      </td>
                      <td className="px-3 py-2 text-[11px] text-slate-300">
                        {formatNumber(r.systemImportCap, 0)}
                      </td>
                      <td className="px-3 py-2 text-[11px] text-slate-300">
                        {formatNumber(r.systemExportCap, 0)}
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td
                      className="px-3 py-4 text-center text-[11px] text-slate-500"
                      colSpan={11}
                    >
                      Could not fetch ATC capability data from AESO&apos;s
                      Interchange API right now. No synthetic fallback is used –
                      refresh later to try again.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <p className="mt-2 text-[11px] text-slate-500">
            Data source: AESO Interchange ATC API
            (itc.aeso.ca/itc/public/api/v2/interchange, dataType=ATC). These are
            the same curves that back your Excel &quot;Provincial Available
            Transfer Capacity&quot; sheet – you can append additional derived
            columns (TRM, expected provincial flow, &quot;we can&quot; MW,
            etc.) in your own model or a future backend job without introducing
            synthetic inputs.
          </p>
        </section>
      </div>
    </main>
  );
}
