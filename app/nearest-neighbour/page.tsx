// app/nearest-neighbour/page.tsx

import Link from "next/link";
import NavTabs from "../components/NavTabs";
import { getTodayVsNearestNeighbourFromHistory } from "../../lib/marketData";

export const revalidate = 60;

/* ---------- small helpers ---------- */

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

type PriceSource = "actual" | "forecast" | null;

type NearestNeighbourRow = {
  he: number;
  todayPrice: number | null;
  todayPriceSource: PriceSource;
  nnPrice: number | null;
  deltaPrice: number | null;
  todayLoad: number | null;
  nnLoad: number | null;
  deltaLoad: number | null;
};

/**
 * One candidate analogue day. `score` is optional and can be used
 * to show the "distance" / fit quality if your backend provides it.
 */
type NearestNeighbourCandidate = {
  nnDate: string;
  rows: NearestNeighbourRow[];
  score?: number | null;
};

/**
 * Flexible result type that supports:
 *
 * - v1 (current): { todayDate, nnDate, rows }
 * - v2 (future): { todayDate, candidates: NearestNeighbourCandidate[] }
 */
type NearestNeighbourMultiResult = {
  todayDate: string;
  // v1 fields:
  nnDate?: string;
  rows?: NearestNeighbourRow[];
  // v2 fields:
  candidates?: NearestNeighbourCandidate[];
};

type PageProps = {
  searchParams?: { [key: string]: string | string[] | undefined };
};

/* ---------- page ---------- */

export default async function NearestNeighbourPage({
  searchParams,
}: PageProps) {
  const raw = (await getTodayVsNearestNeighbourFromHistory()) as
    | NearestNeighbourMultiResult
    | null;

  // Normalise into a candidate list (up to 10).
  let todayDate: string | null = raw?.todayDate ?? null;
  let candidates: NearestNeighbourCandidate[] = [];

  if (raw) {
    if (raw.candidates && raw.candidates.length > 0) {
      // New multi-candidate shape
      candidates = raw.candidates.slice(0, 10);
    } else if (raw.nnDate && raw.rows) {
      // Legacy single-candidate shape
      candidates = [{ nnDate: raw.nnDate, rows: raw.rows }];
    }
  }

  const hasResult = !!raw && candidates.length > 0;

  // Determine which candidate is selected based on ?nnRank=1..N
  const rankParamRaw =
    (typeof searchParams?.nnRank === "string"
      ? searchParams?.nnRank
      : undefined) ??
    (typeof searchParams?.nn === "string"
      ? searchParams?.nn
      : undefined);

  let selectedIndex = 0;
  if (rankParamRaw && candidates.length > 0) {
    const parsed = Number(rankParamRaw);
    if (
      Number.isFinite(parsed) &&
      parsed >= 1 &&
      parsed <= candidates.length
    ) {
      selectedIndex = parsed - 1;
    }
  }

  const selectedCandidate = hasResult ? candidates[selectedIndex] : null;

  return (
    <main className="min-h-screen bg-slate-950 text-slate-100">
      <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
        {/* ---------- Header ---------- */}
        <header className="mb-4">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-baseline sm:justify-between">
            <div>
              <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
                Nearest Neighbour Analysis
              </h1>
              <p className="mt-1 max-w-2xl text-sm text-slate-400">
                Compares{" "}
                <span className="font-medium text-slate-200">
                  today&apos;s AESO load and price profile
                </span>{" "}
                to{" "}
                <span className="font-medium text-slate-200">
                  similar historical days from AESO data
                </span>
                . Today&apos;s curve is built from the AESO Actual/Forecast
                (WMRQH) report, and candidate analogue days are chosen from
                historical hourly pool price and AIL based on a combined match
                of{" "}
                <span className="font-medium text-slate-200">
                  load shape and price shape
                </span>
                .
              </p>
            </div>

            {hasResult && selectedCandidate && (
              <dl className="mt-2 grid gap-2 text-xs text-slate-400 sm:text-right">
                <div>
                  <dt className="inline text-slate-500">Today (Alberta): </dt>
                  <dd className="inline font-medium text-slate-200">
                    {todayDate || "—"}
                  </dd>
                </div>
                <div>
                  <dt className="inline text-slate-500">
                    Selected neighbour day:{" "}
                  </dt>
                  <dd className="inline font-medium text-slate-200">
                    {selectedCandidate.nnDate || "—"}
                  </dd>
                </div>
                {candidates.length > 1 && (
                  <div>
                    <dt className="inline text-slate-500">Candidate rank: </dt>
                    <dd className="inline font-medium text-slate-200">
                      #{selectedIndex + 1} of {candidates.length}
                    </dd>
                  </div>
                )}
              </dl>
            )}
          </div>
        </header>

        <NavTabs />

        {!hasResult || !selectedCandidate ? (
          <section className="mt-4 rounded-2xl border border-slate-800 bg-slate-900/80 p-4 text-sm text-slate-300">
            Unable to compute a nearest neighbour using the available AESO
            data. Check that:
            <ul className="mt-2 list-disc pl-5 text-xs text-slate-400">
              <li>
                The AESO Actual/Forecast (WMRQH) report is reachable for today.
              </li>
              <li>
                Your historical AESO CSV (e.g.{" "}
                <code className="rounded bg-slate-950 px-1 py-0.5 text-[11px]">
                  lib/data/nn-history.csv
                </code>
                ) contains at least one full day of hourly pool price and AIL.
              </li>
              <li>
                (Optional) Your NN backend provides multiple candidates in
                descending similarity if you want the top 10 tabs populated.
              </li>
            </ul>
          </section>
        ) : (
          <section className="mt-4 rounded-2xl border border-slate-800 bg-slate-900/80 p-4">
            {/* Candidate tabs */}
            {candidates.length > 1 && (
              <div className="mb-4 flex flex-wrap gap-1.5">
                {candidates.map((cand, idx) => {
                  const isActive = idx === selectedIndex;
                  const rank = idx + 1;
                  return (
                    <Link
                      key={cand.nnDate + "-" + idx}
                      href={`/nearest-neighbour?nnRank=${rank}`}
                      scroll={false}
                      className={
                        "inline-flex items-center rounded-full border px-3 py-1 text-[11px] font-medium transition " +
                        (isActive
                          ? "border-emerald-500/80 bg-emerald-900/60 text-emerald-100"
                          : "border-slate-700 bg-slate-900/60 text-slate-300 hover:border-slate-500 hover:bg-slate-800/70")
                      }
                    >
                      <span className="mr-1 text-[10px] text-slate-400">
                        #{rank}
                      </span>
                      <span className="font-mono">{cand.nnDate}</span>
                      {typeof cand.score === "number" && (
                        <span className="ml-2 text-[10px] text-slate-400">
                          score {cand.score.toFixed(2)}
                        </span>
                      )}
                    </Link>
                  );
                })}
              </div>
            )}

            <div className="mb-2 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <h2 className="text-sm font-semibold tracking-tight text-slate-200">
                Today vs Selected Nearest Neighbour (HE 1–24)
              </h2>
              <div className="flex flex-wrap items-center gap-3 text-[11px] text-slate-400">
                <span className="flex items-center gap-1">
                  <span className="inline-block h-2 w-2 rounded-full bg-emerald-400" />
                  <span>Today price uses AESO actual</span>
                </span>
                <span className="flex items-center gap-1">
                  <span className="inline-block h-2 w-2 rounded-full bg-sky-400" />
                  <span>Today price uses AESO forecast</span>
                </span>
                <span className="text-slate-500">
                  A/F tag beside price = Actual / Forecast
                </span>
              </div>
            </div>

            <p className="mb-3 text-[11px] text-slate-400">
              For each hour ending (HE) this table compares today&apos;s{" "}
              <span className="font-medium text-slate-200">
                best-known price
              </span>{" "}
              (actual where published, otherwise forecast) and{" "}
              <span className="font-medium text-slate-200">
                best-known AIL
              </span>{" "}
              against the{" "}
              <span className="font-medium text-slate-200">
                selected historical analogue day
              </span>{" "}
              from AESO&apos;s hourly pool price &amp; AIL history. The
              candidate nearest neighbours are ranked by similarity of both load
              and price profiles.
            </p>

            <div className="overflow-x-auto rounded-xl border border-slate-800 bg-slate-950/40">
              <table className="min-w-full text-left text-xs">
                <thead className="bg-slate-900/80 text-[11px] uppercase tracking-wide text-slate-400">
                  <tr>
                    <th className="px-3 py-2">HE</th>
                    <th className="px-3 py-2">Today Price</th>
                    <th className="px-3 py-2">NN Price</th>
                    <th className="px-3 py-2">Δ Price</th>
                    <th className="px-3 py-2">Today Load (AIL)</th>
                    <th className="px-3 py-2">NN Load (AIL)</th>
                    <th className="px-3 py-2">Δ Load</th>
                  </tr>
                </thead>
                <tbody>
                  {selectedCandidate.rows.map((row) => {
                    const dPrice = row.deltaPrice ?? null;
                    const dLoad = row.deltaLoad ?? null;

                    const todayPriceClass =
                      row.todayPriceSource === "actual"
                        ? "text-emerald-300"
                        : row.todayPriceSource === "forecast"
                        ? "text-sky-300"
                        : "text-slate-300";

                    const priceClass =
                      dPrice == null
                        ? "text-slate-300"
                        : dPrice > 0
                        ? "text-emerald-400"
                        : dPrice < 0
                        ? "text-red-400"
                        : "text-slate-300";

                    const loadClass =
                      dLoad == null
                        ? "text-slate-300"
                        : dLoad > 0
                        ? "text-red-400"
                        : dLoad < 0
                        ? "text-emerald-400"
                        : "text-slate-300";

                    return (
                      <tr
                        key={row.he}
                        className="border-t border-slate-800/60 hover:bg-slate-900/40"
                      >
                        <td className="px-3 py-2 text-[11px] font-medium text-slate-200">
                          HE {row.he.toString().padStart(2, "0")}
                        </td>

                        {/* Today price with actual/forecast colouring */}
                        <td
                          className={`px-3 py-2 text-[11px] ${todayPriceClass}`}
                        >
                          {row.todayPrice == null
                            ? "—"
                            : `$${formatNumber(row.todayPrice, 0)}`}
                          {row.todayPriceSource && (
                            <span className="ml-1 rounded bg-slate-900 px-1 py-[1px] text-[9px] font-semibold uppercase tracking-wide text-slate-400">
                              {row.todayPriceSource === "actual" ? "A" : "F"}
                            </span>
                          )}
                        </td>

                        <td className="px-3 py-2 text-[11px] text-slate-300">
                          {row.nnPrice == null
                            ? "—"
                            : `$${formatNumber(row.nnPrice, 0)}`}
                        </td>

                        <td className={`px-3 py-2 text-[11px] ${priceClass}`}>
                          {dPrice == null
                            ? "—"
                            : `${dPrice >= 0 ? "+" : ""}${formatNumber(
                                dPrice,
                                0
                              )}`}
                        </td>

                        <td className="px-3 py-2 text-[11px] text-slate-300">
                          {formatNumber(row.todayLoad, 0)}
                        </td>
                        <td className="px-3 py-2 text-[11px] text-slate-300">
                          {formatNumber(row.nnLoad, 0)}
                        </td>

                        <td className={`px-3 py-2 text-[11px] ${loadClass}`}>
                          {dLoad == null
                            ? "—"
                            : `${dLoad >= 0 ? "+" : ""}${formatNumber(
                                dLoad,
                                0
                              )}`}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <p className="mt-3 text-[11px] text-slate-500">
              Data sources (no synthetic values): today&apos;s curve comes from
              the AESO <span className="font-medium">Actual / Forecast</span>{" "}
              (WMRQH) report, using actuals where published and forecasts
              elsewhere. Each candidate nearest-neighbour curve is selected from
              historical hourly pool price and AIL (e.g. the AESO
              &quot;Hourly Metered Volumes and Pool Price and AIL&quot; data
              you trimmed into your local history file), based on similarity of
              both load and price profiles.
            </p>
          </section>
        )}
      </div>
    </main>
  );
}
