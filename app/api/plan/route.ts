import { buildPlanningPrompt, parsePlanOutput, PlanRequestSchema } from "../../../lib/planner.ts";
import { recoverPlan } from "../../../lib/recovery.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function reply(message: string, status: number, recoverable = false) {
  return Response.json({ error: message, recoverable }, { status, headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  const origin = request.headers.get("origin");
  // Next.js can construct request.url with its internal hostname (localhost)
  // even when the browser reached 127.0.0.1. Host identifies the actual target.
  // Do not trust X-Forwarded-Host supplied by the caller.
  const requestUrl = new URL(request.url);
  const expectedOrigin = `${requestUrl.protocol}//${request.headers.get("host") || requestUrl.host}`;
  if (origin && origin !== expectedOrigin) return reply("This request must come from the app.", 403);
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
      signal: AbortSignal.timeout(900_000),
    });
    if (!response.ok) {
      if (response.status === 401 || response.status === 403) return reply("Agent37 couldn't authorize the connection. Check the server's API key and instance access.", 502);
      if (response.status === 402) return reply("Agent37 needs wallet credit and available instance budget before it can research plans.", 502);
      if (response.status === 409) return reply("This plan is still being worked on. Use Resume research to retrieve it.", 409, true);
      return reply("The planning service couldn't accept this request. Please try again shortly.", 502);
    }
    const result = await response.json();
    if (result.status !== "completed") {
      const code = String(result.error?.code ?? "");
      const message = String(result.error?.message ?? "");
      // Hermes can wrap a provider's HTTP 402 inside a generic agent_error,
      // while the gateway itself returns HTTP 200. Inspect both fields.
      if (/instance budget exhausted/i.test(message)) {
        return reply("Agent37 reports: this instance's spending budget is exhausted. Workspace credit is separate from the instance allowance. Open Agent37 → Instances → Budget to allow this instance to use your existing credit.", 502);
      }
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
      return reply("The research connection timed out. Use Resume research to check the same run without starting it again.", 504, true);
    }
    return reply("The connection to Agent37 was interrupted. Use Resume research to check whether the agent continued.", 502, true);
  }
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const origin = request.headers.get("origin");
  const expectedOrigin = `${url.protocol}//${request.headers.get("host") || url.host}`;
  if (origin && origin !== expectedOrigin) return reply("This request must come from the app.", 403);
  const sessionId = url.searchParams.get("sessionId") ?? "";
  if (!/^[a-f0-9]{32}$/i.test(sessionId)) return reply("The saved research session isn't valid.", 400);
  const key = process.env.AGENT37_KEY?.trim();
  if (!key) return reply("Add AGENT37_KEY to .env to reconnect to the agent.", 503);
  let endpoint: URL;
  try {
    const base = new URL(process.env.AGENT37_INSTANCE_URL ?? "");
    if (base.protocol !== "https:" || !/^[a-z0-9-]+\.agent37\.app$/.test(base.hostname) || base.username || base.password) throw new Error();
    endpoint = new URL(`/v1/sessions/${sessionId}`, base);
  } catch { return reply("The configured Agent37 instance URL isn't valid.", 503); }
  try {
    const response = await fetch(endpoint, { headers: { "X-Agent37-Key": key }, cache: "no-store", redirect: "error", signal: AbortSignal.timeout(195_000) });
    if (!response.ok) return reply("Couldn't read the saved research. Please try Resume research again.", 502);
    const data = await response.json();
    if (data.active_response_id) return Response.json({ status: "running" }, { status: 202, headers: { "Cache-Control": "no-store" } });
    try {
      const recovered = recoverPlan(data.history, sessionId);
      return Response.json({ status: "completed", ...recovered }, { headers: { "Cache-Control": "no-store" } });
    } catch {
      return reply("This run ended without three complete itineraries in the expected format. You can start a new search.", 422);
    }
  } catch { return reply("Couldn't reconnect to Agent37. Your saved session is still available to retry.", 502); }
}
