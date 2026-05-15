# Qestra Orchestrator

![CI](https://github.com/MihirGupta07/Qestra/actions/workflows/ci.yml/badge.svg)
![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)

Qestra Orchestrator is an open-source foundation for building governed multi-agent systems.

It treats agents less like chatbots and more like accountable workers: they receive ticket-backed tasks, run through controlled execution loops, request approval for sensitive actions, write durable traces, and spend against explicit budgets.

## Why This Exists

Most agent products overfocus on prompts and underfocus on orchestration. Qestra is built around the operational layer:

- durable tasks and executions
- approval gates
- customer-owned LLM keys
- audit logs
- queues and workers
- budget controls
- dashboard visibility

## Stack

```txt
Next.js dashboard
Fastify API
MongoDB primary store
Redis + BullMQ workers
OpenAI / Anthropic / mock LLM providers
```

## Features

- Agent roster, task queue, approval queue, and execution dashboard
- Fastify API with protected command routes
- Customer BYOK provider settings with encrypted key storage
- Mock, OpenAI, and Anthropic LLM provider abstraction
- Sensitive tool-call approval gates
- Execution, tool-call, and audit-chain records
- Optional Redis/BullMQ worker path
- MongoDB repository with in-memory local fallback
- Dockerfiles and Docker Compose
- GitHub Actions CI

## Quick Start

```powershell
git clone https://github.com/MihirGupta07/Qestra.git
cd Qestra
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

## Configuration

Copy `.env.example` to `.env`.

For local development, most values can stay blank.

For production, set:

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

## Roadmap

- Real user auth and company membership
- GitHub / Linear / Slack tools
- Sandboxed shell execution
- Agent memory and retrieval
- Billing and workspace limits
- Deployment templates
- More test coverage around queues, budgets, and audit-chain integrity

## Contributing

Contributions are welcome. Start with [CONTRIBUTING.md](./CONTRIBUTING.md).

Please run:

```powershell
npm run check
```

before opening a pull request.

## Security

Please do not open public issues for vulnerabilities. See [SECURITY.md](./SECURITY.md).

## License

MIT. See [LICENSE](./LICENSE).
