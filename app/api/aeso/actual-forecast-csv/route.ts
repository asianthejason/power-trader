// app/api/aeso/actual-forecast-csv/route.ts

// Original AESO Actual/Forecast WMRQH CSV endpoint.
// We just redirect the browser straight here so users can
// download / view the raw file directly from AESO.
const AESO_WMRQH_CSV_URL =
  "https://ets.aeso.ca/ets_web/ip/Market/Reports/ActualForecastWMRQHReportServlet?contentType=csv";

export async function GET() {
  // 302 so the browser opens the AESO URL in a new tab and
  // lets the user handle it (view or download) normally.
  return Response.redirect(AESO_WMRQH_CSV_URL, 302);
}
