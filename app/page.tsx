"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { z } from "zod";
import { PersonSchema, PlanRequestSchema, PlanResultSchema, type Person, type PlanOption, type PlanRequest, type PlanResult } from "@/lib/planner";

const STORAGE_KEY = "out-together:v1";
const PENDING_KEY = "out-together:pending-session";
const examples: Person[] = [
  { id: "jamie", name: "Jamie", blurb: "Likes bookstores, live music, and trying new food. Prefers relaxed places and getting around on foot." },
  { id: "alex", name: "Alex", blurb: "Likes art, hands-on activities, and being outdoors. Vegetarian. Happy with a little walking, but not a long hike." },
];
const RunSchema = z.object({ people: z.array(PersonSchema).min(1).max(8), outing: z.string().max(3000) });
type Run = z.infer<typeof RunSchema>;
const SavedSchema = z.object({
  people: z.array(PersonSchema).max(8), selectedIds: z.array(z.string()).max(8), outing: z.string().max(3000),
  result: PlanResultSchema.nullable(), lastRun: RunSchema.nullable(),
});

function duration(minutes: number) {
  const hours = Math.floor(minutes / 60);
  return [hours ? `${hours} hr` : "", minutes % 60 ? `${minutes % 60} min` : ""].filter(Boolean).join(" ");
}

function OptionCard({ option, index, busy, onRefine }: {
  option: PlanOption; index: number; busy: boolean; onRefine: (id: string, adjustment: string) => Promise<boolean>;
}) {
  const [adjusting, setAdjusting] = useState(false);
  const [adjustment, setAdjustment] = useState("");
  const money = (amount: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(amount);
  return <article className="option-card">
    <div className="option-number">Option {index + 1}</div>
    <h3>{option.title}</h3>
    <p>{option.description}</p>
    <div className="option-meta"><span>{duration(option.durationMinutes)}</span><span>{money(option.totalCost.min)}–{money(option.totalCost.max)} total</span></div>
    <p className="small muted">{option.totalCost.note}</p>
    <div className="fit"><strong>Why it fits</strong><p>{option.whyFits}</p></div>
    <ol className="stops">{option.stops.map((stop, i) => <li key={`${i}-${stop.venue}`}>
      <div className="stop-time">{stop.time} · {duration(stop.durationMinutes)}</div>
      <h4>{stop.venue}</h4>
      <p>{stop.activity}</p>
      <p className="small muted">{stop.address}</p>
      <p className="small">{stop.estimatedCost}</p>
      <p className="small muted">{stop.availabilityNote}</p>
      <div className="stop-links"><a href={stop.sourceUrl} target="_blank" rel="noopener noreferrer">Source ↗</a>{stop.bookingUrl && <a href={stop.bookingUrl} target="_blank" rel="noopener noreferrer">Check booking ↗</a>}</div>
      {i < option.stops.length - 1 && <p className="travel">↓ {stop.travelToNext}</p>}
    </li>)}</ol>
    <div className="adjustment">
      {!adjusting ? <button type="button" className="secondary full-width" disabled={busy} onClick={() => setAdjusting(true)}>Adjust this option</button> : <form onSubmit={async event => {
        event.preventDefault();
        if (adjustment.trim() && await onRefine(option.id, adjustment.trim())) { setAdjustment(""); setAdjusting(false); }
      }}>
        <label htmlFor={`adjust-${option.id}`}>What would you change?</label>
        <textarea id={`adjust-${option.id}`} value={adjustment} onChange={event => setAdjustment(event.target.value)} maxLength={1000} rows={3} placeholder="A little cheaper, and swap the museum for something outside." required disabled={busy} />
        <div className="button-row"><button type="submit" disabled={busy || !adjustment.trim()}>Update option</button><button type="button" className="quiet" disabled={busy} onClick={() => setAdjusting(false)}>Cancel</button></div>
      </form>}
    </div>
  </article>;
}

export default function Home() {
  const [people, setPeople] = useState<Person[]>(examples);
  const [selectedIds, setSelectedIds] = useState(["jamie", "alex"]);
  const [outing, setOuting] = useState("");
  const [editing, setEditing] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const [result, setResult] = useState<PlanResult | null>(null);
  const [lastRun, setLastRun] = useState<Run | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [storageNote, setStorageNote] = useState("");
  const [elapsed, setElapsed] = useState(0);
  const [pendingSession, setPendingSession] = useState("");
  const inFlight = useRef(false);
  const resultHeading = useRef<HTMLHeadingElement>(null);
  const selected = people.filter(person => selectedIds.includes(person.id));

  useEffect(() => {
    try {
      const resume = new URLSearchParams(window.location.search).get("resume") || localStorage.getItem(PENDING_KEY);
      if (resume && /^[a-f0-9]{32}$/i.test(resume)) setPendingSession(resume);
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const saved = SavedSchema.safeParse(JSON.parse(raw));
        if (saved.success) {
          const data = saved.data;
          setPeople(data.people); setSelectedIds(data.selectedIds.filter(id => data.people.some(person => person.id === id)));
          setOuting(data.outing);
          if (data.result && data.lastRun) { setResult(data.result); setLastRun(data.lastRun); }
        } else setStorageNote("Your saved data couldn't be loaded. You can start a new plan.");
      }
    } catch { setStorageNote("Browser storage isn't available. Changes will last for this visit only."); }
    setHydrated(true);
  }, []);

  const rememberSession = useCallback((sessionId: string) => {
    setPendingSession(sessionId);
    try { if (sessionId) localStorage.setItem(PENDING_KEY, sessionId); else localStorage.removeItem(PENDING_KEY); } catch { /* The current tab can still recover. */ }
    if (!sessionId && new URLSearchParams(window.location.search).has("resume")) {
      const url = new URL(window.location.href); url.searchParams.delete("resume"); window.history.replaceState(null, "", url);
    }
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ people, selectedIds, outing, result, lastRun })); }
    catch { setStorageNote("Couldn't save to this browser. Keep this tab open to preserve your plan."); }
  }, [people, selectedIds, outing, result, lastRun, hydrated]);

  useEffect(() => {
    if (!busy) return;
    const started = Date.now();
    const timer = setInterval(() => setElapsed(Math.floor((Date.now() - started) / 1000)), 1000);
    return () => clearInterval(timer);
  }, [busy]);

  const generate = useCallback(async (request: PlanRequest): Promise<boolean> => {
    if (inFlight.current) return false;
    inFlight.current = true; setBusy(true); setError(""); setElapsed(0);
    // Hermes accepts a caller-chosen session ID. Save it before starting work so
    // a dropped connection or page refresh cannot lose the running agent.
    const sessionId = request.sessionId || crypto.randomUUID().replaceAll("-", "");
    rememberSession(sessionId);
    try {
      const response = await fetch("/api/plan", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...request, sessionId }),
        signal: AbortSignal.timeout(915_000),
      });
      const data = await response.json();
      if (!response.ok) {
        if (!data.recoverable) rememberSession("");
        throw new Error(typeof data.error === "string" ? data.error : "Something went wrong. Please try again.");
      }
      const next = PlanResultSchema.safeParse(data);
      if (!next.success) throw new Error("The response wasn't a complete plan. Please try again.");
      setResult(next.data); setLastRun({ people: request.people, outing: request.outing });
      rememberSession("");
      requestAnimationFrame(() => resultHeading.current?.focus());
      return true;
    } catch (caught) {
      setError(caught instanceof Error && caught.name === "TimeoutError"
        ? "The connection timed out. Use Resume research to retrieve the same run without starting over."
        : caught instanceof Error ? caught.message : "Couldn't connect. Please try again.");
      return false;
    } finally { inFlight.current = false; setBusy(false); }
  }, [rememberSession]);

  async function resumeResearch() {
    if (inFlight.current || !pendingSession) return;
    inFlight.current = true; setBusy(true); setElapsed(0); setError("");
    try {
      const started = Date.now();
      while (Date.now() - started < 900_000) {
        const response = await fetch(`/api/plan?sessionId=${encodeURIComponent(pendingSession)}`, { cache: "no-store", signal: AbortSignal.timeout(200_000) });
        const data = await response.json();
        if (response.status === 202) { await new Promise(resolve => setTimeout(resolve, 5000)); continue; }
        if (!response.ok) {
          if (response.status === 422 || response.status === 400) rememberSession("");
          throw new Error(data.error || "Couldn't retrieve this research yet.");
        }
        const recovered = PlanResultSchema.parse(data.result);
        const request = PlanRequestSchema.parse(data.request);
        setResult(recovered); setLastRun({ people: request.people, outing: request.outing }); rememberSession("");
        requestAnimationFrame(() => resultHeading.current?.focus());
        return;
      }
      setError("The agent is still working. You can resume this research again later.");
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Couldn't reconnect. Your research session is saved."); }
    finally { inFlight.current = false; setBusy(false); }
  }

  // A browser agent can prepare the same form without bypassing the user's Generate action.
  useEffect(() => {
    type Context = { registerTool: (tool: { name: string; description: string; inputSchema: unknown; execute: (args: { outing: string }) => Promise<unknown> }) => void; unregisterTool: (name: string) => void };
    const context = (document as Document & { modelContext?: Context }).modelContext;
    if (!context) return;
    try {
      context.registerTool({ name: "prepare_outing", description: "Fill the outing request in Out together. The user reviews it and clicks Find three options to start research.", inputSchema: { type: "object", properties: { outing: { type: "string", maxLength: 3000 } }, required: ["outing"], additionalProperties: false }, execute: async ({ outing: next }) => {
        if (inFlight.current || typeof next !== "string" || !next.trim() || next.length > 3000) return { content: [{ type: "text", text: "The form is busy or the request is invalid." }], isError: true };
        setOuting(next); return { content: [{ type: "text", text: "Outing request filled. Ready for the user to review." }] };
      } });
    } catch { return; }
    return () => { try { context.unregisterTool("prepare_outing"); } catch { /* Optional browser capability. */ } };
  }, []);

  function updatePerson(id: string, change: Partial<Person>) {
    setPeople(current => current.map(person => person.id === id ? { ...person, ...change } : person));
  }

  return <main>
    <header className="site-header"><a className="brand" href="/">Out together<span className="brand-dot" aria-hidden="true">.</span></a><span className="city">San Francisco</span></header>
    <section className="intro"><p className="eyebrow">LESS PLANNING. MORE TIME TOGETHER.</p><h1>What should we do?</h1><p>Pick your people, tell us what you have in mind, and get three ways to spend the time.</p></section>
    <section className="planner" aria-label="Plan an outing">
      <form onSubmit={async event => {
        event.preventDefault();
        if (!selected.length) { setError("Choose at least one person."); return; }
        if (selected.some(person => !person.name.trim() || !person.blurb.trim())) { setError("Add a name and a few interests for everyone you've selected."); setEditing(true); return; }
        if (!outing.trim()) { setError("Tell us what you have in mind for the outing."); return; }
        await generate({ people: selected, outing: outing.trim() });
      }}>
        <fieldset disabled={busy || !hydrated || !!pendingSession}>
          <div className="field-header"><label id="people-label">Who's coming?</label><button type="button" className="text-button" onClick={() => setEditing(!editing)} aria-expanded={editing} aria-controls="people-editor">{editing ? "Done editing" : "Edit people"}</button></div>
          <details className="people-select"><summary aria-labelledby="people-label selected-people"><span id="selected-people">{selected.length ? selected.map(person => person.name || "Unnamed person").join(", ") : "Choose people"}</span><span aria-hidden="true">⌄</span></summary><div className="people-menu">{people.length ? people.map(person => <label key={person.id} className="person-choice"><input type="checkbox" checked={selectedIds.includes(person.id)} onChange={event => setSelectedIds(current => event.target.checked ? [...current, person.id] : current.filter(id => id !== person.id))} /><span><strong>{person.name || "Unnamed person"}</strong><span className="choice-blurb">{person.blurb || "Add their interests in Edit people."}</span></span></label>) : <p className="small muted">Add someone using Edit people.</p>}</div></details>
          {editing && <div id="people-editor" className="people-editor">
            <p className="small muted">A short blurb is enough: interests, food preferences, things to avoid. Replace the example people with your own.</p>
            {people.map((person, index) => <div className="person-editor" key={person.id}>
              <div className="field-header"><label htmlFor={`name-${person.id}`}>Person {index + 1}</label><button type="button" className="text-button" aria-label={`Remove ${person.name || "person"}`} onClick={() => { setPeople(current => current.filter(p => p.id !== person.id)); setSelectedIds(current => current.filter(id => id !== person.id)); }}>Remove</button></div>
              <input id={`name-${person.id}`} value={person.name} onChange={event => updatePerson(person.id, { name: event.target.value })} placeholder="Name" maxLength={80} />
              <label className="sr-only" htmlFor={`blurb-${person.id}`}>Interests and preferences for {person.name || `person ${index + 1}`}</label>
              <textarea id={`blurb-${person.id}`} value={person.blurb} onChange={event => updatePerson(person.id, { blurb: event.target.value })} placeholder="Loves live music and bookstores. Vegetarian. Prefers quieter places." rows={3} maxLength={2500} />
            </div>)}
            <button type="button" className="secondary" disabled={people.length >= 8} onClick={() => { const id = crypto.randomUUID(); setPeople(current => [...current, { id, name: "", blurb: "" }]); setSelectedIds(current => [...current, id]); }}>+ Add person</button>
          </div>}
          {!editing && <p className="field-note">People and their interests are saved in this browser. Edit the examples to make them yours.</p>}
          <label htmlFor="outing" className="outing-label">What do you have in mind?</label>
          <textarea id="outing" value={outing} onChange={event => setOuting(event.target.value)} rows={3} maxLength={3000} placeholder="Saturday afternoon, 3 hours, under $100 total. Starting in the Mission. Something relaxed." required aria-describedby="outing-help" />
          <div id="outing-help" className="field-note">A day, how much time you have, a total budget, and where you'll start.</div>
          <div className="submit-row"><button type="submit" disabled={busy || !hydrated}>{busy ? "Researching…" : "Find three options"}<span aria-hidden="true"> →</span></button><span className="small muted">Researched by your Hermes agent</span></div>
        </fieldset>
      </form>
      {storageNote && <p className="notice" role="status">{storageNote}</p>}
      {busy && <div className="loading" role="status"><span className="spinner" aria-hidden="true" /><div><strong>Finding options that fit</strong><p>Your agent is researching venues and building itineraries. This can take a few minutes.</p><span className="small muted" aria-hidden="true">{Math.floor(elapsed / 60)}:{String(elapsed % 60).padStart(2, "0")} elapsed</span></div></div>}
      {error && <p className="error" role="alert">{error}</p>}
      {pendingSession && !busy && <div className="resume-row"><p className="small muted">A research session is saved. Reconnect to retrieve its result without starting another search.</p><button type="button" onClick={resumeResearch}>Resume research</button></div>}
    </section>
    {result && lastRun ? <section className="results" aria-busy={busy}>
      <div className="results-header"><h2 ref={resultHeading} tabIndex={-1}>A few good ways to spend the day</h2><p>{result.plan.summary}</p><p className="small muted">For {lastRun.people.map(person => person.name).join(" & ")} · Researched {new Date(result.generatedAt).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "America/Los_Angeles" })} SF time</p><details className="plan-context"><summary>Request & assumptions</summary><p>{lastRun.outing}</p>{result.plan.assumptions.length > 0 && <ul>{result.plan.assumptions.map((assumption, i) => <li key={i}>{assumption}</li>)}</ul>}</details></div>
      <div className="options-grid">{result.plan.options.map((option, index) => <OptionCard key={`${result.sessionId}-${option.id}`} option={option} index={index} busy={busy} onRefine={async (optionId, refinement) => generate({ ...lastRun, sessionId: result.sessionId, optionId, refinement })} />)}</div>
    </section> : <section className="empty-state"><span className="empty-symbol" aria-hidden="true">↗</span><h2>A little less “I don't know, you pick.”</h2><p>Your options will appear here, with a plan for the time, estimated costs, and links to the places.</p></section>}
    <footer>Made for time together in San Francisco.</footer>
  </main>;
}
