// app/api/debug/aeso/route.ts
import { NextResponse } from "next/server";

type AesoRow = {
  he: number;
  forecastPoolPrice: number | null;
  actualPoolPrice: number | null;
  forecastAil: number | null;
  actualAil: number | null;
};

// VERY lenient parser: do NOT rely on headers, just pattern-match rows.
function parseAesoCsv(text: string): AesoRow[] {
  const lines = text.split(/\r?\n/);
  const rows: AesoRow[] = [];

  const toNum = (s: string): number | null => {
    const cleaned = s.replace(/[$,]/g, "").trim();
    if (!cleaned) return null;
    const n = parseFloat(cleaned);
    return Number.isFinite(n) ? n : null;
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    const parts = line.split(",");
    if (parts.length < 5) continue;

    const dateField = parts[0].trim();

    // Try a few different date formats we've seen in screenshots:
    // "11/18/2025 01", "11/18/2025 1:00", maybe quoted, etc.
    const plain = dateField.replace(/^"+|"+$/g, "");

    // Match "MM/DD/YYYY HH"
    let m = plain.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2})$/);
    if (!m) {
      // Match "MM/DD/YYYY HH:MM"
      m = plain.match(
        /^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2})$/
      );
    }
    if (!m) continue;

    const he = parseInt(m[4], 10);
    if (!Number.isFinite(he) || he < 1 || he > 24) continue;

    const forecastPoolPrice = toNum(parts[1] ?? "");
    const actualPoolPrice = toNum(parts[2] ?? "");
    const forecastAil = toNum(parts[3] ?? "");
    const actualAil = toNum(parts[4] ?? "");

    if (
      forecastPoolPrice === null &&
      actualPoolPrice === null &&
      forecastAil === null &&
      actualAil === null
    ) {
      // nothing numeric here, probably header or footer
      continue;
    }

    rows.push({
      he,
      forecastPoolPrice,
      actualPoolPrice,
      forecastAil,
      actualAil,
    });
  }

  return rows;
}

export const revalidate = 0; // always live
export const dynamic = "force-dynamic";

export async function GET() {
  const url =
    "http://ets.aeso.ca/ets_web/ip/Market/Reports/ActualForecastWMRQHReportServlet?contentType=csv";

  try {
    const res = await fetch(url, { cache: "no-store" });
    const status = res.status;
    const ok = res.ok;

    let body = "";
    try {
      body = await res.text();
    } catch (e) {
      return NextResponse.json(
        {
          ok,
          status,
          error: "Failed to read response body",
          errorDetail: String(e),
        },
        { status: 500 }
      );
    }

    const lines = body.split(/\r?\n/);

    const parsed = parseAesoCsv(body);

    return NextResponse.json(
      {
        ok,
        status,
        lineCount: lines.length,
        sampleLines: lines.slice(0, 15), // first 15 raw lines of CSV
        parsedRowCount: parsed.length,
        parsedSample: parsed.slice(0, 8), // first 8 parsed rows (HE etc.)
      },
      { status: ok ? 200 : status }
    );
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        status: 500,
        error: "Request to AESO failed completely",
        errorDetail: String(error),
      },
      { status: 500 }
    );
  }
}
