import { lookupPlace } from "../../../lib/place.ts";

export const runtime = "nodejs";

const coordinate = /^-?\d{1,3}(\.\d{1,6})?$/;

function reply(message: string, status: number) {
  return Response.json({ error: message }, { status, headers: { "Cache-Control": "no-store" } });
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const origin = request.headers.get("origin");
  if (origin && origin !== `${url.protocol}//${request.headers.get("host") || url.host}`) return reply("This request must come from the app.", 403);
  const lat = url.searchParams.get("lat") ?? "", lon = url.searchParams.get("lon") ?? "";
  if (!coordinate.test(lat) || !coordinate.test(lon) || Math.abs(Number(lat)) > 90 || Math.abs(Number(lon)) > 180) {
    return reply("The location coordinates aren't valid.", 400);
  }
  try {
    const location = await lookupPlace(Number(lat), Number(lon));
    return Response.json({ location }, { headers: { "Cache-Control": "private, max-age=600" } });
  } catch { return reply("Couldn't name this location.", 502); }
}
