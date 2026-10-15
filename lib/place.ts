import { z } from "zod";

const ReverseSchema = z.object({
  display_name: z.string().min(1),
  address: z.object({ postcode: z.string().optional() }).passthrough().optional(),
});

export function placeLabel(result: unknown): string {
  const { display_name, address } = ReverseSchema.parse(result);
  const label = display_name.split(",").map(part => part.trim()).filter(part => part && part !== address?.postcode).join(", ").slice(0, 200).trim();
  if (!label) throw new Error("No place name was returned.");
  return label;
}

const cache = new Map<string, string>();
let queue: Promise<unknown> = Promise.resolve();

// Nominatim's usage policy allows at most one request per second per application.
function throttled<T>(task: () => Promise<T>): Promise<T> {
  const run = queue.then(task);
  const pause = () => new Promise(resolve => setTimeout(resolve, 1000));
  queue = run.then(pause, pause);
  return run;
}

export async function lookupPlace(latitude: number, longitude: number): Promise<string> {
  const lat = latitude.toFixed(3), lon = longitude.toFixed(3);
  const key = `${lat},${lon}`;
  const cached = cache.get(key);
  if (cached) return cached;
  const label = await throttled(async () => {
    const endpoint = new URL("https://nominatim.openstreetmap.org/reverse");
    endpoint.search = new URLSearchParams({ format: "jsonv2", lat, lon, zoom: "13", "accept-language": "en" }).toString();
    const response = await fetch(endpoint, {
      headers: { "User-Agent": "Hangout/0.1 (local outing planner)", Accept: "application/json" },
      cache: "no-store", redirect: "error", signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error(`Place lookup failed with HTTP ${response.status}.`);
    return placeLabel(await response.json());
  });
  if (cache.size >= 500) cache.delete(cache.keys().next().value!);
  cache.set(key, label);
  return label;
}
