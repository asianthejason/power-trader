// app/api/debug/aeso/route.ts
import { NextResponse } from "next/server";

// ---------- Small CSV helpers (same idea as in lib/marketData.ts) ----------

function splitCsvLine(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];

    if (ch === '"') {
      inQuotes = !inQuotes;
    } else if (ch === "," && !inQuotes) {
      result.push(current);
      current = "";
    } else {
      current += ch;
    }
  }

  result.push(current);
  return result;
}

function stripQuotes(s: string): string {
  return s.replace(/^"+|"+$/g, "");
}

function toNum(s: string): number | null {
  const cleaned = s.replace(/[$,]/g, "").trim();
  if (!cleaned || cleaned === "-") return null;
  const n = parseFloat(cleaned);
  return Number.isFinite(n) ? n : null;
}

type AesoRow = {
  he: number;
  forecastPoolPrice: number | null;
  actualPoolPrice: number | null;
  forecastAil: number | null;
  actualAil: number | null;
};

function parseAesoCsv(text: string): AesoRow[] {
  const lines = text.split(/\r?\n/);
  const rows: AesoRow[] = [];

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    const parts = splitCsvLine(line);
    if (parts.length < 5) continue;

    const dateField = stripQuotes(parts[0].trim());

    // Match "MM/DD/YYYY HH"
    const m = dateField.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2})$/);
    if (!m) continue;

    const he = parseInt(m[4], 10);
    if (!Number.isFinite(he) || he < 1 || he > 24) continue;

    const forecastPoolPrice = toNum(stripQuotes(parts[1] ?? ""));
    const actualPoolPrice = toNum(stripQuotes(parts[2] ?? ""));
    const forecastAil = toNum(stripQuotes(parts[3] ?? ""));
    const actualAil = toNum(stripQuotes(parts[4] ?? ""));

    if (
      forecastPoolPrice === null &&
      actualPoolPrice === null &&
      forecastAil === null &&
      actualAil === null
    ) {
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

// ---------- API handler ----------

export const revalidate = 0;
export const dynamic = "force-dynamic";

export async function GET() {
  const url =
    "http://ets.aeso.ca/ets_web/ip/Market/Reports/ActualForecastWMRQHReportServlet?contentType=csv";

  try {
    const res = await fetch(url, { cache: "no-store" });
    const status = res.status;
    const ok = res.ok;

    const body = await res.text();
    const lines = body.split(/\r?\n/);
    const parsed = parseAesoCsv(body);

    return NextResponse.json(
      {
        ok,
        status,
        lineCount: lines.length,
        sampleLines: lines.slice(0, 15),
        parsedRowCount: parsed.length,
        parsedSample: parsed.slice(0, 8),
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
