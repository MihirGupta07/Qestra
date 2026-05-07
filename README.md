# Qestra-Style Orchestrator Prototype

This is the first build slice for a platform where agents behave like governable workers instead of free-floating chatbots.

The prototype focuses on the core product loop:

```txt
Create agent -> assign task -> run execution -> log tool calls -> request approval -> enforce budget
```

## Stack Direction

```txt
Next.js dashboard later; static dashboard for the first slice
Fastify API
MongoDB primary store
Redis later
BullMQ open source for queued heartbeats
```

The API runs without MongoDB by default using an in-memory repository. Set `MONGODB_URI` when you want persistence.

BullMQ is scaffolded but optional until `REDIS_URL` is set.

## What Is Included

- A dependency-light dashboard in `apps/web`
- A Fastify API in `apps/api`
- Shared TypeScript domain models in `packages/shared`
- Agent planning/runtime scaffolding in `packages/agents`
- Tool routing and governance scaffolding in `packages/tools`
- LLM provider abstraction in `packages/llm`
- MongoDB collection/index plan in `packages/db`
- API and worker placeholders in `apps/api` and `apps/workers`

## Run Locally

Install dependencies:

```txt
npm install
```

Optional local infrastructure:

```txt
docker compose up -d mongodb redis
```

Copy `.env.example` to `.env` and set `MONGODB_URI` when you want MongoDB persistence. Leave it blank for in-memory mode.

Run API and dashboard:

```txt
npm run dev
```

Run the full stack when Redis is configured:

```txt
npm run dev:full
```

Then open:

```txt
http://localhost:4173
```

The dashboard talks to the API at `http://localhost:4000` and falls back to browser state if the API is not running.

## Environment Modes

```txt
No MONGODB_URI  -> in-memory repository
MONGODB_URI     -> MongoDB repository with seed data and indexes
No REDIS_URL    -> direct heartbeat execution
REDIS_URL       -> BullMQ queue available for worker-driven heartbeats
```

## LLM Providers

```txt
LLM_PROVIDER=mock       -> local deterministic planning
LLM_PROVIDER=openai     -> requires OPENAI_API_KEY
LLM_PROVIDER=anthropic  -> requires ANTHROPIC_API_KEY
```

The API and BullMQ worker both use the same provider factory.

## Customer API Keys

Customer-owned provider keys are stored per company through:

```txt
GET  /api/settings/provider
PUT  /api/settings/provider
POST /api/settings/provider/test
```

Keys are encrypted with `ENCRYPTION_SECRET` before storage. API responses only expose `apiKeySet` and `apiKeyLast4`.

## Governance

- `x-user-role: operator` can create tasks and run heartbeats.
- `x-user-role: admin` or `owner` can approve and reject sensitive actions.
- Viewer requests to protected command endpoints return `403`.
- Every execution and approval writes to the audit chain.

## Open The Static Prototype

Open this file in a browser:

```txt
apps/web/index.html
```

No install step is required for the static prototype.

## Suggested Next Slice

1. Swap the static dashboard for a Next.js app.
2. Turn the MongoDB repository into the default persistence layer.
3. Enable BullMQ when Redis is available.
4. Add real OpenAI/Anthropic providers behind the `LLMProvider` interface.
