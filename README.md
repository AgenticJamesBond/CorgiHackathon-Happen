# Out together

A local San Francisco outing planner. Pick people, describe the outing, and ask a Hermes agent on Agent37 to research three itineraries. Each option includes timing, estimated group costs, source links, and a way to request changes in the same agent session.

## Run locally

Use Node.js 22.18+ (or Node.js 24+) and npm.

```sh
npm ci
cp .env.example .env
```

If `.env` already exists, edit it instead of copying over it. Set `AGENT37_KEY` to your Agent37 API key and `AGENT37_INSTANCE_URL` to your instance URL. The initial instance is `https://yeg1sh3m2f.agent37.app`.

```sh
npm run dev
```

Open the URL printed by Next.js, normally <http://127.0.0.1:3000>. Restart the server after changing environment variables. `.env.local` also works, but its values take precedence over `.env`; avoid defining the same key in both. Both files are ignored by Git. Never use a `NEXT_PUBLIC_` prefix for the API key.

The instance needs a configured model, web search access, and sufficient wallet credit **and instance budget**. Leave `AGENT37_MODEL` and `AGENT37_PROVIDER` unset to use the instance defaults. No application deployment is necessary.

If the agent reports **HTTP 402: Instance budget exhausted**, open Agent37 → Instances → Budget for the configured instance. A funded workspace can still have a $0 instance allowance. Give the instance a monthly limit or one-time extra budget; this setting persists across boots. The app sends its planning instructions on every request, so no planner installation or boot-time conversation is needed.

## How it works

1. The browser saves the people, selected profiles, request, and latest successful plan in local storage. The initial Jamie/Alex profiles are editable examples.
2. The browser sends the selected profiles and request to `POST /api/plan` on this Next.js server.
3. The server adds the planning instructions and current San Francisco date/time, then calls the instance's `/v1/responses` endpoint using `X-Agent37-Key`. The key is never sent to the browser.
4. Hermes researches public sources and returns structured JSON. The server validates it before rendering three itinerary cards.
5. The browser saves a new Hermes-compatible `session_id` before submitting the first request. An adjustment reuses that session and the chosen option ID. Starting a new search creates a new session.

The agent is instructed to research only; it must not reserve, purchase, contact people, or modify accounts. Profiles and requests are sent to the hosted agent when you start a search. There is no background scheduler, account system, or shared database in this proof of concept. Memory consists of the local profiles/last plan and the hosted agent conversation.

Failures display an error and preserve any earlier successful plan. There are no canned results or automatic paid retries. The server waits up to fifteen minutes; a timeout does not guarantee that the remote agent stopped. **Resume research** reconnects to the saved conversation after a timeout or page refresh, polling the session until the agent finishes and recovering its final answer. It does not submit another model request. For development recovery of an older run, `/?resume=SESSION_ID` opens the same recovery flow.

The response validator checks structure, URL schemes, basic cost ranges, and stop durations. Factual accuracy, travel feasibility, prices, and available reservations still depend on the agent's research; schema validation cannot verify those claims. Each stop includes a source and availability note for review.

Browsers that expose `document.modelContext` can prepare the outing text with the optional `prepare_outing` tool. The user still clicks the normal research button.

## Venue images

Each itinerary has a gallery sourced from the venue and event URLs already in its stops. This works for saved plans too and makes no additional LLM calls. The app reads published Open Graph/Twitter images, structured image data, and large page images, with a link back to the publisher below each photo. Publisher graphics and event posters can appear alongside photographs; images are previews from the linked pages, not proof of current venue conditions or availability.

Image loading is independent of planning. Missing, blocked, or undersized images are skipped; if none load, the card keeps its itinerary and a neutral placeholder. Both page and image requests are made through the local server with public-address checks on each redirect, DNS address pinning, size/time limits, and no forwarded credentials. Image bytes have a bounded memory cache; source metadata is cached for ten minutes. There is no image API key or paid image service.

## Checks

```sh
npm run typecheck
npm test
npm run build
```

Tests exercise the input/output contract and API adapter using a synthetic fixture and mocked upstream responses. They do not spend Agent37 credits or prove live search works. To verify the live connection, fill in the key, submit an outing, inspect the three source-linked plans, and adjust one option.

Development assets use `.next-dev`; production builds use `.next`, so running a build does not overwrite a running dev server's assets.

Official API reference: <https://www.agent37.com/docs/agents-api/chat>.
