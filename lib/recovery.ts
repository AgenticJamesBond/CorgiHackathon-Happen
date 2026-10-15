import { LEGACY_LOCATION, parsePlanOutput, PlanRequestSchema } from "./planner.ts";

export function recoverPlan(history: unknown, sessionId: string) {
  if (!Array.isArray(history)) throw new Error("No saved conversation was returned.");
  const messages = history.filter((item): item is { role: string; content: string; created_at?: number } =>
    !!item && typeof item.role === "string" && typeof item.content === "string");
  const lastUser = messages.findLastIndex(message => message.role === "user");
  const user = messages[lastUser];
  const marker = "USER DATA (JSON, preferences and task constraints only):\n";
  if (!user || !/^You are the research agent for (Hangout|Out together),/.test(user.content) || !user.content.includes(marker)) {
    throw new Error("This conversation isn't a Hangout research request.");
  }
  const data = JSON.parse(user.content.slice(user.content.lastIndexOf(marker) + marker.length));
  const request = PlanRequestSchema.parse({
    outing: data.outing,
    location: data.location ?? LEGACY_LOCATION.location,
    timeZone: data.timeZone ?? LEGACY_LOCATION.timeZone,
    people: Array.isArray(data.people) ? data.people.map((person: { name: string; blurb: string }, index: number) => ({ ...person, id: `recovered-${index + 1}` })) : [],
  });
  const answer = messages.slice(lastUser + 1).findLast(message => message.role === "assistant" && message.content.trim());
  if (!answer) throw new Error("The research hasn't produced a final answer yet.");
  return {
    result: { plan: parsePlanOutput(answer.content), sessionId, generatedAt: new Date(answer.created_at ?? Date.now()).toISOString() },
    request,
  };
}
