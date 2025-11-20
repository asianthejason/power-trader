// app/interties/page.tsx

import NavTabs from "../components/NavTabs";

// Revalidate every minute – this page is a thin wrapper around AESO's
// real-time Current Supply Demand (CSD) report, so we keep it reasonably fresh.
export const revalidate = 60;

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

// Rough "now" in Alberta (UTC-7). Same idea as your load-forecast page.
function approxAlbertaNow() {
  const nowUtc = new Date();
  const nowAb = new Date(nowUtc.getTime() - 7 * 60 * 60 * 1000); // UTC-7
  const isoDate = nowAb.toISOString().slice(0, 10);
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
    const res = await fetch(AESO_CSD_URL, {
      cache: "no-store",
      next: { revalidate: 0 },
    });

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

/* ---------- page ---------- */

export default async function IntertiesPage() {
  const { asOfAb, rows, systemNetInterchangeMw } =
    await fetchAesoInterchangeSnapshot();

  const hasPathData = rows.some((r) => r.actualFlowMw != null);
  const sumOfPathsMw = rows.reduce((acc, r) => {
    if (r.actualFlowMw == null) return acc;
    return acc + r.actualFlowMw;
  }, 0);

  const deltaSystemVsPaths =
    systemNetInterchangeMw != null && hasPathData
      ? systemNetInterchangeMw - sumOfPathsMw
      : null;

  return (
    <main className="min-h-screen bg-slate-950 text-slate-100">
      <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
        {/* Header */}
        <header className="mb-4 space-y-2">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-baseline sm:justify-between">
            <div>
              <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
                Interties
              </h1>
              <p className="max-w-2xl text-sm text-slate-400">
                Real-time net flows on the Alberta interties, pulled directly
                from AESO&apos;s Current Supply Demand report. Positive values
                mean Alberta is exporting; negative values mean Alberta is
                importing. No synthetic modelling is used on this page.
              </p>
            </div>

            <div className="flex flex-col items-start gap-1 text-[11px] text-slate-400 sm:items-end">
              <span className="inline-flex items-center rounded-full border border-slate-700 bg-slate-900/70 px-2 py-0.5">
                <span className="mr-1.5 h-1.5 w-1.5 rounded-full bg-emerald-400" />
                Live snapshot from AESO CSD
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

        {/* Path table */}
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
                Capability / ATC APIs and your own persisted time series.
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
                {rows.map((row) => {
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
                        Positive = exports from Alberta; negative = imports
                        into Alberta. Values should line up with the
                        corresponding rows in the CSD INTERCHANGE table.
                      </td>
                    </tr>
                  );
                })}

                {!rows.length && (
                  <tr>
                    <td
                      className="px-3 py-4 text-center text-[11px] text-slate-500"
                      colSpan={5}
                    >
                      Could not fetch intertie data from AESO right now.
                      This can happen when the CSD page is temporarily
                      unavailable. No synthetic fallback is used – refresh
                      later to try again.
                    </td>
                  </tr>
                )}

                {rows.length > 0 && !hasPathData && (
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
            Data source: AESO Current Supply Demand Report (CSD). To add Import
            / Export ATC and scheduled flows per HE, connect to AESO&apos;s
            ATC / Interchange Capability APIs or the ATC public report at
            itc.aeso.ca from your backend and join those series to your own
            persisted CSD snapshots.
          </p>
        </section>
      </div>
    </main>
  );
}
