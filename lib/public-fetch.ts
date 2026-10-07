import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";

export function isPublicIPv4(address: string): boolean {
  if (isIP(address) !== 4) return false;
  const [a, b, c] = address.split(".").map(Number);
  return !(a === 0 || a === 10 || a === 127 || a >= 224 ||
    (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && (b === 168 || b === 0 || (b === 88 && c === 99))) ||
    (a === 100 && b >= 64 && b <= 127) || (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) ||
    (a === 203 && b === 0 && c === 113));
}

export function publicUrl(value: string): URL {
  if (value.length > 2048) throw new Error("URL too long");
  const url = new URL(value);
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.port ||
    !url.hostname.includes(".") || /\.(localhost|local|internal|test|invalid)$/i.test(url.hostname) ||
    (isIP(url.hostname) && !isPublicIPv4(url.hostname))) throw new Error("Not a public web URL");
  return url;
}

export type PublicResource = { bytes: Buffer; contentType: string; url: string };

// Resolve and pin a public IPv4 address on every hop. Never forward cookies,
// credentials, or incoming headers to websites. This also prevents DNS rebinding.
export async function fetchPublicResource(value: string, kind: "html" | "image", redirects = 0): Promise<PublicResource> {
  const url = publicUrl(value);
  const addresses = await lookup(url.hostname, { family: 4, all: true });
  if (!addresses.length || addresses.some(item => !isPublicIPv4(item.address))) throw new Error("Private address blocked");
  const maxBytes = kind === "html" ? 1_500_000 : 6_000_000;
  const send = url.protocol === "https:" ? httpsRequest : httpRequest;
  return new Promise((resolve, reject) => {
    const req = send(url, {
      agent: false, family: 4,
      lookup: (_hostname, _options, callback) => callback(null, addresses[0].address, 4),
      headers: { "User-Agent": "OutTogether/0.1 (venue image preview)", Accept: kind === "html" ? "text/html,application/xhtml+xml" : "image/avif,image/webp,image/*", "Accept-Encoding": "identity" },
    }, response => {
      const status = response.statusCode ?? 0;
      if ([301, 302, 303, 307, 308].includes(status) && response.headers.location) {
        response.resume();
        if (redirects >= 3) { reject(new Error("Too many redirects")); return; }
        try { resolve(fetchPublicResource(new URL(response.headers.location, url).href, kind, redirects + 1)); }
        catch (error) { reject(error); }
        return;
      }
      const contentType = String(response.headers["content-type"] ?? "").split(";")[0].trim().toLowerCase();
      const expected = kind === "html" ? /^(text\/html|application\/xhtml\+xml)$/ : /^image\/(jpeg|png|webp|gif|avif)$/;
      if (status !== 200 || !expected.test(contentType) || Number(response.headers["content-length"]) > maxBytes) {
        response.destroy(); reject(new Error("Resource unavailable")); return;
      }
      const chunks: Buffer[] = []; let length = 0;
      response.on("data", (chunk: Buffer) => {
        length += chunk.length;
        if (length > maxBytes) { req.destroy(new Error("Resource too large")); return; }
        chunks.push(chunk);
      });
      response.on("error", reject);
      response.on("end", () => resolve({ bytes: Buffer.concat(chunks), contentType, url: url.href }));
    });
    const timer = setTimeout(() => req.destroy(new Error("Image source timed out")), 8000);
    req.on("close", () => clearTimeout(timer));
    req.on("error", reject);
    req.end();
  });
}
