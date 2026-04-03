import { NextRequest, NextResponse } from "next/server";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { lead_id, meeting_date, meeting_time, notes, business_name } = body;

    let google_event_id = null;

    // Try Google Calendar if configured
    const clientId = process.env.GOOGLE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
    const refreshToken = process.env.GOOGLE_REFRESH_TOKEN;
    const calendarId = process.env.GOOGLE_CALENDAR_ID || "primary";

    if (clientId && clientSecret && refreshToken) {
      try {
        // Get access token
        const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            client_id: clientId,
            client_secret: clientSecret,
            refresh_token: refreshToken,
            grant_type: "refresh_token",
          }),
        });
        const tokenData = await tokenRes.json();
        const accessToken = tokenData.access_token;

        if (accessToken) {
          // Parse date and time
          const [hours, minutes] = meeting_time.split(":");
          const startDate = new Date(`${meeting_date}T${meeting_time}:00`);
          const endDate = new Date(startDate.getTime() + 30 * 60000); // 30 min meeting

          const event = {
            summary: `Full Stack Services — Meeting with ${business_name || "Lead"}`,
            description: `Sales meeting booked via Full Stack Services CRM.\n\nLead ID: ${lead_id}\n${notes ? `Notes: ${notes}` : ""}`,
            start: {
              dateTime: startDate.toISOString(),
              timeZone: "America/Phoenix",
            },
            end: {
              dateTime: endDate.toISOString(),
              timeZone: "America/Phoenix",
            },
            reminders: {
              useDefault: false,
              overrides: [
                { method: "popup", minutes: 30 },
                { method: "popup", minutes: 10 },
              ],
            },
          };

          const calRes = await fetch(
            `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`,
            {
              method: "POST",
              headers: {
                Authorization: `Bearer ${accessToken}`,
                "Content-Type": "application/json",
              },
              body: JSON.stringify(event),
            }
          );

          const calData = await calRes.json();
          if (calData.id) {
            google_event_id = calData.id;
          }
        }
      } catch (calError) {
        console.error("Google Calendar error:", calError);
      }
    }

    return NextResponse.json({
      success: true,
      google_event_id,
      message: google_event_id
        ? "Meeting booked and added to Google Calendar"
        : "Meeting booked (Google Calendar not configured)",
    });
  } catch {
    return NextResponse.json({ success: false, error: "Invalid request" }, { status: 400 });
  }
}
