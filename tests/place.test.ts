import test from "node:test";
import assert from "node:assert/strict";
import { placeLabel } from "../lib/place.ts";
import { GET } from "../app/api/place/route.ts";

const place = (query: string, headers?: HeadersInit) => GET(new Request(`http://localhost:3000/api/place?${query}`, { headers }));

test("names a place without its postcode", () => {
  assert.equal(placeLabel({ display_name: "Mission, San Francisco, California, 94110, United States", address: { postcode: "94110" } }), "Mission, San Francisco, California, United States");
  assert.equal(placeLabel({ display_name: "Shibuya, Tokyo, Japan", address: {} }), "Shibuya, Tokyo, Japan");
  assert.throws(() => placeLabel({ error: "Unable to geocode" }));
});
test("rejects invalid coordinates and other origins before looking anything up", async () => {
  assert.equal((await place("lat=&lon=")).status, 400);
  assert.equal((await place("lat=91&lon=0")).status, 400);
  assert.equal((await place("lat=37.76&lon=-122.41;rm")).status, 400);
  assert.equal((await place("lat=37.76&lon=-122.41", { Origin: "https://unrelated.example" })).status, 403);
});
test("looks up rounded coordinates once with an identifying User-Agent", async () => {
  const previous = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async (url, init) => {
    calls++;
    const lookup = new URL(String(url));
    assert.equal(lookup.origin, "https://nominatim.openstreetmap.org");
    assert.equal(lookup.searchParams.get("lat"), "37.760"); assert.equal(lookup.searchParams.get("lon"), "-122.415");
    assert.match(new Headers(init?.headers).get("User-Agent") ?? "", /^Hangout\//);
    return Response.json({ display_name: "Mission, San Francisco, California, 94110, United States", address: { postcode: "94110" } });
  };
  try {
    for (const query of ["lat=37.76012&lon=-122.41498", "lat=37.7604&lon=-122.4154"]) {
      const response = await place(query);
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), { location: "Mission, San Francisco, California, United States" });
    }
    assert.equal(calls, 1);
  } finally { globalThis.fetch = previous; }
});
