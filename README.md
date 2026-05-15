# Qestra Orchestrator

Qestra is a production-shaped foundation for a governed multi-agent orchestration platform: agents work on ticket-backed tasks, execution is logged, sensitive tool calls require approval, spend is tracked, and customer-owned LLM keys are encrypted per workspace.

## Stack

```txt
Next.js dashboard
Fastify API
MongoDB primary store
Redis + BullMQ workers
OpenAI / Anthropic / mock LLM providers
```

## Local Development

```powershell
npm install
npm run dev
```

Open:

```txt
http://127.0.0.1:4173
```

Run MongoDB and Redis locally:

```powershell
docker compose up -d mongodb redis
```

Run API, dashboard, and worker:

```powershell
npm run dev:full
```

## Production Environment

Copy `.env.example` to `.env` and set strong values:

```txt
NODE_ENV=production
API_AUTH_TOKEN=<at least 32 characters>
ENCRYPTION_SECRET=<at least 32 characters>
MONGODB_URI=<mongodb connection string>
REDIS_URL=<redis connection string>
BACKEND_API_BASE=<Fastify API URL for the Next.js server proxy>
CORS_ORIGINS=<allowed browser origins>
```

`API_AUTH_TOKEN` is used server-to-server by the Next.js proxy. Do not expose it as `NEXT_PUBLIC_*`.

## Customer API Keys

Customer-owned LLM keys are stored per company through:

```txt
GET  /api/settings/provider
PUT  /api/settings/provider
POST /api/settings/provider/test
```

Keys are encrypted with `ENCRYPTION_SECRET` before storage. API responses only expose:

```txt
apiKeySet
apiKeyLast4
provider
model
```

## Governance

- `operator` can create tasks and run heartbeats.
- `admin` and `owner` can approve or reject sensitive actions.
- Protected API routes require `Authorization: Bearer <API_AUTH_TOKEN>` when configured.
- Every execution and approval appends an audit-chain record.
- Shell, deploy, delete, and external-write style tool requests are approval gated.

## Verification

```powershell
npm run check
```

This runs:

```txt
TypeScript typecheck
API hardening tests
Next.js production build
```

## Docker

Infrastructure only:

```powershell
docker compose up -d mongodb redis
```

App stack:

```powershell
docker compose --profile app up --build
```

## Notes

The current auth layer is intentionally minimal and suitable for an MVP/private beta. Before broad customer launch, replace role headers with real user auth and company membership resolution.
