import { fetchPublicResource, type PublicResource } from "../../../lib/public-fetch.ts";

export const runtime = "nodejs";
const cache = new Map<string, { expires: number; image: PublicResource }>();
let cachedBytes = 0;

export async function GET(request: Request) {
  const url = new URL(request.url).searchParams.get("url") ?? "";
  try {
    const existing = cache.get(url);
    const resource = existing && existing.expires > Date.now() ? existing.image : await fetchPublicResource(url, "image");
    if (resource !== existing?.image) {
      if (existing) { cachedBytes -= existing.image.bytes.length; cache.delete(url); }
      while (cache.size && cachedBytes + resource.bytes.length > 24_000_000) {
        const oldest = cache.keys().next().value!;
        cachedBytes -= cache.get(oldest)!.image.bytes.length; cache.delete(oldest);
      }
      cache.set(url, { expires: Date.now() + 60 * 60_000, image: resource }); cachedBytes += resource.bytes.length;
    }
    return new Response(new Uint8Array(resource.bytes), { headers: {
      "Content-Type": resource.contentType, "Cache-Control": "public, max-age=3600",
      "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "default-src 'none'; sandbox",
    } });
  } catch { return new Response(null, { status: 404, headers: { "Cache-Control": "no-store" } }); }
}
