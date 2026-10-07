import test from "node:test";
import assert from "node:assert/strict";
import { extractImages } from "../lib/photos.ts";
import { fetchPublicResource, isPublicIPv4, publicUrl } from "../lib/public-fetch.ts";

test("extracts published social images with arbitrary attribute order and HTML entities", () => {
  const images = extractImages(`<meta content="/concert.jpg?a=1&amp;b=2" property='og:image'><meta property="og:image:alt" content="Musicians &#38; dancers"><meta name="twitter:image" content="https://cdn.example.org/second.webp">`, "https://example.org/events/music");
  assert.deepEqual(images, [{ url: "https://example.org/concert.jpg?a=1&b=2", alt: "Musicians & dancers" }, { url: "https://cdn.example.org/second.webp", alt: "Musicians & dancers" }]);
});
test("falls back to structured images and large lazy-loaded photos, not logos and banners", () => {
  const html = `<img src="/logo.png" width="600" height="400"><img src="/banner.jpg" width="900" height="80"><script type="application/ld+json">{"@graph":[{"@type":"Event","image":{"contentUrl":"/stage.jpg","caption":"The stage"}}]}</script><img data-src="/mural.jpg" width="1000" height="700" alt="A painted mural">`;
  assert.deepEqual(extractImages(html, "https://example.org/event"), [{ url: "https://example.org/stage.jpg", alt: "The stage" }, { url: "https://example.org/mural.jpg", alt: "A painted mural" }]);
});
test("homepage photos take priority over generic social previews", () => {
  const html = `<meta property="og:image" content="/social-tile.jpg"><img src="https://cdn.example.org/social-tile.jpg?width=900" width="900" height="900"><img src="/gallery.jpg" width="900" height="600" alt="The gallery">`;
  assert.equal(extractImages(html, "https://example.org/")[0].url, "https://example.org/gallery.jpg");
  assert.equal(extractImages(html, "https://example.org/event")[0].url, "https://example.org/social-tile.jpg");
});
test("rejects non-web and private image references without executing page content", () => {
  const html = `<meta property="og:image" content="javascript:alert(1)"><img src="http://127.0.0.1/secret"><img src="file:///etc/passwd"><img src="https://example.org/vector.svg"><script type="application/ld+json">not json</script>`;
  assert.deepEqual(extractImages(html, "https://example.org/event"), []);
});
test("public fetch excludes loopback, metadata services, private networks, credentials and ports", async () => {
  for (const address of ["127.0.0.1", "10.1.2.3", "192.168.1.2", "172.31.255.255", "169.254.169.254", "100.100.100.200", "0.0.0.0", "198.18.0.1", "224.0.0.1", "::1", "::ffff:127.0.0.1"]) assert.equal(isPublicIPv4(address), false, address);
  assert.equal(isPublicIPv4("93.184.216.34"), true);
  for (const url of ["http://127.0.0.1", "http://2130706433", "http://0x7f000001", "http://[::1]", "http://localhost", "http://host.internal", "https://user:password@example.org", "https://example.org:8443", "file:///etc/passwd"]) assert.throws(() => publicUrl(url), url);
  await assert.rejects(fetchPublicResource("http://169.254.169.254/latest/meta-data/", "html"));
  assert.equal(publicUrl("https://example.org/photo.jpg").hostname, "example.org");
});
