import { fetchPublicResource, publicUrl } from "./public-fetch.ts";

export type VenuePhoto = { imageUrl: string; sourceUrl: string; venue: string; alt: string };
type Candidate = { url: string; alt: string };

function decode(value: string): string {
  const names: Record<string, string> = { amp: "&", quot: '"', apos: "'", lt: "<", gt: ">", nbsp: " " };
  return value.replace(/&(#x[\da-f]+|#\d+|amp|quot|apos|lt|gt|nbsp);/gi, (match, entity: string) => {
    if (entity[0] !== "#") return names[entity.toLowerCase()] ?? match;
    const code = entity[1].toLowerCase() === "x" ? parseInt(entity.slice(2), 16) : parseInt(entity.slice(1), 10);
    return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : "";
  });
}
function attributes(tag: string): Record<string, string> {
  return Object.fromEntries([...tag.matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/g)]
    .map(match => [match[1].toLowerCase(), decode(match[2] ?? match[3] ?? match[4] ?? "")]));
}

export function extractImages(html: string, sourceUrl: string): Candidate[] {
  const candidates: Candidate[] = [];
  const isHomepage = new URL(sourceUrl).pathname.replace(/\/+$/, "") === "";
  function add(value: unknown, alt = "") {
    if (typeof value !== "string" || !value.trim()) return;
    try {
      const url = publicUrl(new URL(decode(value.trim()), sourceUrl).href);
      if (/\.(svg|ico)(?:$|[?#])/i.test(url.href) || /(?:logo|favicon|sprite|spacer|tracking|avatar)/i.test(url.pathname + " " + alt)) return;
      if (!candidates.some(item => item.url === url.href)) candidates.push({ url: url.href, alt: alt.slice(0, 240) });
    } catch { /* Ignore invalid, private, and non-web image references. */ }
  }
  const metadata = [...html.matchAll(/<meta\b[^>]*>/gi)].map(match => attributes(match[0]));
  const alt = metadata.find(meta => meta.property?.toLowerCase() === "og:image:alt")?.content ?? "";
  for (const key of ["og:image:secure_url", "og:image", "og:image:url", "twitter:image", "twitter:image:src"]) {
    for (const meta of metadata) if ((meta.property || meta.name)?.toLowerCase() === key) add(meta.content, alt);
  }
  // A homepage's social preview is often its logo. Prefer actual page images
  // there, while event/detail pages keep their explicitly chosen social image.
  const social = isHomepage ? candidates.splice(0) : [];
  const socialFiles = new Set(social.map(image => new URL(image.url).pathname.split("/").pop()?.toLowerCase()));
  const repeatedSocial: Candidate[] = [];
  function structured(value: unknown, depth = 0) {
    if (depth > 4 || !value || typeof value !== "object") return;
    if (Array.isArray(value)) { value.slice(0, 20).forEach(item => structured(item, depth + 1)); return; }
    const obj = value as Record<string, unknown>;
    if (obj.image) {
      for (const item of Array.isArray(obj.image) ? obj.image : [obj.image]) {
        if (typeof item === "string") add(item);
        else if (item && typeof item === "object") add(item.contentUrl || item.url, typeof item.caption === "string" ? item.caption : "");
      }
    }
    if (obj["@graph"]) structured(obj["@graph"], depth + 1);
  }
  for (const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    if (attributes(match[1]).type?.toLowerCase() !== "application/ld+json") continue;
    try { structured(JSON.parse(match[2])); } catch { /* Some publishers emit invalid JSON-LD. */ }
  }
  for (const match of html.matchAll(/<img\b[^>]*>/gi)) {
    const attrs = attributes(match[0]);
    const width = parseInt(attrs.width || "0"), height = parseInt(attrs.height || "0");
    if ((width && width < 300) || (height && height < 160) || (width && height && width / height > 3.5)) continue;
    const srcset = attrs.srcset || attrs["data-srcset"];
    const large = srcset?.split(",").map(item => item.trim().split(/\s+/)).filter(item => parseInt(item[1] ?? "0") >= 600)[0]?.[0];
    const src = large || attrs["data-src"] || attrs.src;
    try {
      const resolved = new URL(src, sourceUrl);
      if (socialFiles.has(resolved.pathname.split("/").pop()?.toLowerCase())) {
        repeatedSocial.push({ url: resolved.href, alt: attrs.alt ?? "" }); continue;
      }
    } catch { /* add() below handles malformed references. */ }
    add(src, attrs.alt);
    if (candidates.length >= 12) break;
  }
  for (const candidate of [...social, ...repeatedSocial]) add(candidate.url, candidate.alt);
  return candidates.slice(0, 8);
}

const pages = new Map<string, { expires: number; promise: Promise<Candidate[]> }>();
function imagesForPage(source: string): Promise<Candidate[]> {
  const cached = pages.get(source);
  if (cached && cached.expires > Date.now()) return cached.promise;
  if (pages.size >= 120) pages.delete(pages.keys().next().value!);
  const promise = fetchPublicResource(source, "html").then(page => extractImages(page.bytes.toString("utf8"), page.url)).catch(() => []);
  pages.set(source, { expires: Date.now() + 10 * 60_000, promise });
  return promise;
}

export async function findVenuePhotos(sources: { sourceUrl: string; venue: string }[]): Promise<VenuePhoto[]> {
  const groups = await Promise.all(sources.map(async source => {
    const images = await imagesForPage(source.sourceUrl);
    return images.slice(0, 4).map(candidate => ({
      imageUrl: `/api/image?url=${encodeURIComponent(candidate.url)}`,
      sourceUrl: source.sourceUrl, venue: source.venue,
      alt: candidate.alt && !/^(picture|image|photo|img)(\s*\d+)?$/i.test(candidate.alt) ? candidate.alt : `Image from the website for ${source.venue}`,
    }));
  }));
  // Lead with one image per stop; later candidates cover broken source images.
  const photos: VenuePhoto[] = [];
  for (let i = 0; i < 4; i++) for (const group of groups) if (group[i] && !photos.some(photo => photo.imageUrl === group[i].imageUrl)) photos.push(group[i]);
  return photos.slice(0, 8);
}
