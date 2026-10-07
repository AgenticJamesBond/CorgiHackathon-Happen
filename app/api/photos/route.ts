import { z } from "zod";
import { findVenuePhotos } from "../../../lib/photos.ts";

export const runtime = "nodejs";
export async function POST(request: Request) {
  const url = new URL(request.url);
  const origin = request.headers.get("origin");
  if (origin && origin !== `${url.protocol}//${request.headers.get("host") || url.host}`) return Response.json({ photos: [] }, { status: 403 });
  try {
    if (Number(request.headers.get("content-length")) > 16000) return Response.json({ photos: [] }, { status: 413 });
    const raw = await request.text();
    if (raw.length > 16000) return Response.json({ photos: [] }, { status: 413 });
    const sources = z.array(z.object({ sourceUrl: z.string().url().max(2048), venue: z.string().trim().min(1).max(160) })).min(1).max(5).parse(JSON.parse(raw));
    const photos = await findVenuePhotos(sources);
    return Response.json({ photos }, { headers: { "Cache-Control": "private, max-age=600" } });
  } catch { return Response.json({ photos: [] }, { status: 400 }); }
}
