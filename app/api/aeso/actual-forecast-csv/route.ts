// app/api/aeso/actual-forecast-csv/route.ts

// Use the SAME HTTP endpoint you already use in lib/marketData.ts.
// The server fetches this over HTTP, then we serve it to the browser
// over HTTPS from your own domain, so users don't hit AESO directly.
const AESO_WMRQH_CSV_URL =
  "http://ets.aeso.ca/ets_web/ip/Market/Reports/ActualForecastWMRQHReportServlet?contentType=csv";

export async function GET() {
  try {
    const res = await fetch(AESO_WMRQH_CSV_URL, {
      // Always get a fresh copy
      cache: "no-store",
    });

    const text = await res.text();

    if (!res.ok) {
      console.error(
        "AESO CSV proxy HTTP error:",
        res.status,
        res.statusText,
        "body snippet:",
        text.slice(0, 200)
      );

      return new Response(
        `Failed to fetch AESO CSV. HTTP ${res.status} ${res.statusText}\n\n${text}`,
        {
          status: 502,
          headers: {
            "Content-Type": "text/plain; charset=utf-8",
          },
        }
      );
    }

    // Success: stream the raw CSV back to the browser
    return new Response(text, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        // This makes browsers download the file by default, but
        // users can still open it directly if they want.
        "Content-Disposition":
          'attachment; filename="AESO_ActualForecastWMRQH.csv"',
        "Cache-Control": "no-store, no-cache, must-revalidate",
      },
    });
  } catch (err) {
    console.error("Error proxying AESO CSV:", err);
    return new Response("Error proxying AESO CSV from AESO.", {
      status: 500,
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
      },
    });
  }
}
