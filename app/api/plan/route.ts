import { buildPlanningPrompt, parsePlanOutput, PlanRequestSchema } from "../../../lib/planner.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function reply(message: string, status: number) {
  return Response.json({ error: message }, { status, headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) return reply("This request must come from the app.", 403);
  if (Number(request.headers.get("content-length")) > 32000) return reply("Please shorten the profiles or outing request.", 413);

  let input;
  try {
    const raw = await request.text();
    if (raw.length > 32000) return reply("Please shorten the profiles or outing request.", 413);
    const parsed = PlanRequestSchema.safeParse(JSON.parse(raw));
    if (!parsed.success) return reply("Choose at least one person with a name and interests, and describe your outing.", 400);
    input = parsed.data;
  } catch { return reply("The request couldn't be read. Please try again.", 400); }

  const key = process.env.AGENT37_KEY?.trim();
  const instance = process.env.AGENT37_INSTANCE_URL?.trim();
  if (!key || !instance) {
    return reply("Live planning isn't connected yet. Add AGENT37_KEY and AGENT37_INSTANCE_URL to .env, then restart the app.", 503);
  }

  let endpoint: URL;
  try {
    const base = new URL(instance);
    if (base.protocol !== "https:" || !/^[a-z0-9-]+\.agent37\.app$/.test(base.hostname) || base.username || base.password) throw new Error("Invalid instance URL");
    endpoint = new URL("/v1/responses", base);
  } catch { return reply("The configured Agent37 instance URL isn't valid.", 503); }

  try {
    const response = await fetch(endpoint, {
      method: "POST", cache: "no-store", redirect: "error",
      headers: { "Content-Type": "application/json", "X-Agent37-Key": key },
      body: JSON.stringify({
        input: buildPlanningPrompt(input), stream: false,
        ...(input.sessionId ? { session_id: input.sessionId } : {}),
        ...(process.env.AGENT37_MODEL ? { model: process.env.AGENT37_MODEL } : {}),
        ...(process.env.AGENT37_PROVIDER ? { provider: process.env.AGENT37_PROVIDER } : {}),
      }),
      signal: AbortSignal.timeout(300_000),
    });
    if (!response.ok) {
      if (response.status === 401 || response.status === 403) return reply("Agent37 couldn't authorize the connection. Check the server's API key and instance access.", 502);
      if (response.status === 402) return reply("Agent37 needs wallet credit and available instance budget before it can research plans.", 502);
      if (response.status === 409) return reply("This plan is still being worked on. Wait a moment before adjusting it again.", 409);
      return reply("The planning service couldn't accept this request. Please try again shortly.", 502);
    }
    const result = await response.json();
    if (result.status !== "completed") {
      const code = String(result.error?.code ?? "");
      if (/budget|credit|payment/i.test(code)) return reply("Agent37 needs wallet credit and available instance budget before it can research plans.", 502);
      return reply("The agent couldn't finish its research. Check the instance's model, search access, and budget, then try again.", 502);
    }
    if (typeof result.output_text !== "string" || !/^[a-f0-9]{32}$/i.test(result.session_id ?? "")) {
      return reply("The planning service returned an incomplete response. Please try again.", 502);
    }
    try {
      const plan = parsePlanOutput(result.output_text);
      return Response.json({ plan, sessionId: result.session_id, generatedAt: new Date().toISOString() }, {
        headers: { "Cache-Control": "no-store" },
      });
    } catch {
      // Never render the agent's unvalidated output or upstream errors as HTML.
      return reply("The agent couldn't return three complete itineraries in the expected format. Try a clearer date, area, or budget, or check that web search is available.", 502);
    }
  } catch (error) {
    if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) {
      return reply("Research took longer than five minutes. The remote agent may still be running; check its dashboard before starting another request.", 504);
    }
    return reply("Couldn't reach Agent37. Check your internet connection and the instance URL, then retry.", 502);
  }
}
