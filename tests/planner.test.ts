import test from "node:test";
import assert from "node:assert/strict";
import { buildPlanningPrompt, parsePlanOutput, PlanRequestSchema, type Plan } from "../lib/planner.ts";
import { POST } from "../app/api/plan/route.ts";

// Synthetic contract data for tests only; never served by the application.
function fixture(): Plan {
  return {
    summary: "A test outing on October 10, 2026.", assumptions: ["Walking between stops."],
    options: [1, 2, 3].map(index => ({
      id: `option-${index}`, title: `Test option ${index}`, description: "Synthetic itinerary.", whyFits: "Shared interests.", durationMinutes: 120,
      totalCost: { min: 20, max: 50, currency: "USD" as const, note: "Test estimate for the group." },
      stops: [{ time: "2:00 PM", venue: "Test venue", activity: "Test activity", address: "Test address", durationMinutes: 60, travelToNext: "End of outing", estimatedCost: "$20 total", availabilityNote: "Availability not verified.", sourceUrl: "https://example.com/venue", bookingUrl: null }],
    })),
  };
}
const input = { people: [{ id: "person", name: "Sam", blurb: "Art, vegetarian food." }], outing: "Saturday, 2 hours, under $80 total." };
const session = "a".repeat(32);
function request(body: unknown, origin = "http://localhost:3000") {
  return new Request("http://localhost:3000/api/plan", { method: "POST", headers: { "Content-Type": "application/json", Origin: origin }, body: JSON.stringify(body) });
}

test("accepts valid JSON and a JSON code fence", () => {
  assert.deepEqual(parsePlanOutput(JSON.stringify(fixture())), fixture());
  assert.deepEqual(parsePlanOutput("```json\n" + JSON.stringify(fixture()) + "\n```"), fixture());
});
test("rejects incomplete plans and unsafe source links", () => {
  const plan = fixture(); plan.options.pop(); assert.throws(() => parsePlanOutput(JSON.stringify(plan)));
  const unsafe = fixture(); unsafe.options[0].stops[0].sourceUrl = "javascript:alert(1)";
  assert.throws(() => parsePlanOutput(JSON.stringify(unsafe)));
  assert.throws(() => parsePlanOutput('{"error":"Search unavailable"}'));
});
test("rejects inconsistent costs, duration, and option IDs", () => {
  const cost = fixture(); cost.options[0].totalCost.max = 1; assert.throws(() => parsePlanOutput(JSON.stringify(cost)));
  const timing = fixture(); timing.options[0].durationMinutes = 30; assert.throws(() => parsePlanOutput(JSON.stringify(timing)));
  const ids = fixture(); ids.options[1].id = ids.options[0].id; assert.throws(() => parsePlanOutput(JSON.stringify(ids)));
});
test("requires selected profiles and session context for an adjustment", () => {
  assert.equal(PlanRequestSchema.safeParse(input).success, true);
  assert.equal(PlanRequestSchema.safeParse({ ...input, people: [] }).success, false);
  assert.equal(PlanRequestSchema.safeParse({ ...input, refinement: "Cheaper" }).success, false);
  assert.equal(PlanRequestSchema.safeParse({ ...input, sessionId: session, optionId: "option-1", refinement: "Cheaper" }).success, true);
});
test("prompt includes SF local date, selected profiles, and refinement context", () => {
  const prompt = buildPlanningPrompt({ ...input, sessionId: session, optionId: "option-2", refinement: "Less walking" }, new Date("2026-10-08T01:00:00Z"));
  assert.match(prompt, /October 7, 2026/); assert.match(prompt, /Sam/); assert.match(prompt, /option-2/); assert.match(prompt, /Less walking/);
  assert.match(prompt, /Do not make bookings/); assert.match(prompt, /TOTAL for all selected people/);
});
test("API validates requests before contacting Agent37", async () => {
  assert.equal((await POST(request({ people: [] }))).status, 400);
  assert.equal((await POST(request(input, "https://unrelated.example"))).status, 403);
});
test("API keeps credentials on the server and reuses the session for refinements", async () => {
  const previous = { key: process.env.AGENT37_KEY, instance: process.env.AGENT37_INSTANCE_URL, fetch: globalThis.fetch };
  process.env.AGENT37_KEY = "test-server-only-key";
  process.env.AGENT37_INSTANCE_URL = "https://test-instance.agent37.app";
  let called = false;
  globalThis.fetch = async (url, init) => {
    called = true;
    assert.equal(String(url), "https://test-instance.agent37.app/v1/responses");
    assert.equal(new Headers(init?.headers).get("X-Agent37-Key"), "test-server-only-key");
    const body = JSON.parse(String(init?.body));
    assert.equal(body.session_id, session); assert.equal(body.stream, false); assert.match(body.input, /Cheaper/);
    return Response.json({ status: "completed", output_text: JSON.stringify(fixture()), session_id: session });
  };
  try {
    const response = await POST(request({ ...input, sessionId: session, refinement: "Cheaper", optionId: "option-1" }));
    assert.equal(response.status, 200);
    const data = await response.json();
    assert.equal(called, true); assert.equal(data.sessionId, session); assert.deepEqual(data.plan, fixture());
    assert.doesNotMatch(JSON.stringify(data), /test-server-only-key/);
  } finally { restore(previous); }
});
test("API returns clear errors for missing credentials, budget failure, and bad output", async () => {
  const previous = { key: process.env.AGENT37_KEY, instance: process.env.AGENT37_INSTANCE_URL, fetch: globalThis.fetch };
  delete process.env.AGENT37_KEY;
  try {
    assert.equal((await POST(request(input))).status, 503);
    process.env.AGENT37_KEY = "test-key"; process.env.AGENT37_INSTANCE_URL = "https://test-instance.agent37.app";
    globalThis.fetch = async () => Response.json({ status: "failed", error: { code: "budget_exceeded" } });
    const budget = await POST(request(input)); assert.equal(budget.status, 502); assert.match((await budget.json()).error, /budget/);
    globalThis.fetch = async () => Response.json({ status: "completed", session_id: session, output_text: "<script>untrusted</script>" });
    const malformed = await POST(request(input)); assert.equal(malformed.status, 502); assert.doesNotMatch(JSON.stringify(await malformed.json()), /untrusted/);
  } finally { restore(previous); }
});
function restore(previous: { key: string | undefined; instance: string | undefined; fetch: typeof fetch }) {
  if (previous.key === undefined) delete process.env.AGENT37_KEY; else process.env.AGENT37_KEY = previous.key;
  if (previous.instance === undefined) delete process.env.AGENT37_INSTANCE_URL; else process.env.AGENT37_INSTANCE_URL = previous.instance;
  globalThis.fetch = previous.fetch;
}
