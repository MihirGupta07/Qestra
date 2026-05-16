# Qestra Orchestrator

![CI](https://github.com/MihirGupta07/Qestra/actions/workflows/ci.yml/badge.svg)
![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)

Qestra is a self-hostable agent runner with a real iterative LLM/tool loop, human-in-the-loop approval gates for sensitive actions, durable executions and tool-call records, per-agent budget caps, and a hash-chained audit log — all behind a Next.js dashboard.

It is provider-agnostic: anything that speaks the OpenAI Chat Completions API (OpenAI, Groq, Nvidia NIM, Together, OpenRouter, Ollama, vLLM, …) or Anthropic's Messages API works out of the box. You bring your own key.

## What's actually in the box

Real, working:

- **Agent runtime** that calls an LLM with tool specs, executes returned tool calls, feeds results back, and loops until the model returns a final answer (capped by `QESTRA_MAX_RUNTIME_STEPS`).
- **Approval gate** — when the model wants to call a `sensitive: true` tool (e.g. `shell.exec`), the execution pauses and persists its conversation state. After a human approves or rejects in the dashboard, the loop resumes from the saved state.
- **Tools**
  - `http.fetch` — SSRF-guarded (private IPs blocked), optional host allow/deny lists
  - `file.list` / `file.read` / `file.write` — sandboxed inside `QESTRA_WORKSPACE_DIR`
  - `notes.set` / `notes.get` / `notes.list` — persistent key/value store for long-term memory
  - `shell.exec` — sensitive; argv-only (no shell metacharacters), allowlist-filtered, always requires approval
- **Providers**
  - `mock` — deterministic, no key required; drives the demo offline
  - `openai-compatible` — set `baseUrl` for OpenAI, Groq, Nvidia NIM, Together, OpenRouter, Ollama
  - `anthropic` — native Claude `tool_use`
- **Storage** — in-memory by default; Mongo when `MONGODB_URI` is set
- **Queue** — direct execution by default; BullMQ when `REDIS_URL` is set
- **API hardening** — Helmet, rate limiting, CORS allowlist, RBAC, bearer token in production
- **BYOK** — provider keys stored AES-256-GCM encrypted; only `apiKeyLast4` ever returned

Not yet (Phase 2):

- AWS Bedrock (needs SigV4)
- Per-user accounts (currently a single shared bearer token + `x-user-role` header)
- Streaming responses in the dashboard
- Per-agent custom system prompts and per-agent tool subsets

## Quick Start

```powershell
git clone https://github.com/MihirGupta07/Qestra.git
cd Qestra
npm install
npm run dev
```

Open <http://127.0.0.1:4173>.

The default config runs entirely offline with the `mock` provider, so the demo works without any keys or external services. Click **Run Heartbeat** to process the seeded task.

## Using your own keys

1. Open the dashboard.
2. In the **LLM Keys** panel, pick a provider and paste your key:
   - **openai-compatible** — leave `baseUrl` as `https://api.openai.com/v1` for OpenAI; set it to `https://api.groq.com/openai/v1` for Groq, `https://integrate.api.nvidia.com/v1` for Nvidia NIM, `http://localhost:11434/v1` for Ollama, etc.
   - **anthropic** — set the model to e.g. `claude-haiku-4-5-20251001`.
3. Click **Test** to verify the connection (real round-trip to the provider).
4. Click **Save**. Subsequent heartbeats use the stored key.

The key is encrypted with `ENCRYPTION_SECRET` before being written to disk and never returned to the browser — the dashboard only sees `apiKeyLast4`.

## Try a real task

1. Create a task like *"Read README.md and summarize it"* assigned to **Researcher**.
2. Click **Run Heartbeat**. The agent will call `file.list`, then `file.read`, then return a summary.
3. Expand the execution to see the full LLM transcript and per-step tool calls.

For an approval-gated example, assign a task to **Engineer** with a goal like *"Run git status"* — `shell.exec` is sensitive, so the execution pauses for your approval before running. Set `QESTRA_SHELL_ALLOWLIST=git,ls,cat` (or whatever you trust) in `.env` first.

## Configuration

Copy `.env.example` to `.env`. Everything is optional for local development.

Useful knobs:

| Variable | Purpose |
| --- | --- |
| `MONGODB_URI` | Switch to Mongo storage; without this, state is in-memory and lost on restart |
| `REDIS_URL` | Switch to BullMQ workers; without this, heartbeats run inline |
| `QESTRA_WORKSPACE_DIR` | Sandbox dir for the `file.*` tools (default `./workspace`) |
| `QESTRA_SHELL_ALLOWLIST` | Comma-separated executable names for `shell.exec` (e.g. `git,ls,cat,npm`) |
| `QESTRA_HTTP_ALLOW_HOSTS` / `QESTRA_HTTP_DENY_HOSTS` | Host filters for `http.fetch` |
| `QESTRA_MAX_RUNTIME_STEPS` | LLM/tool loop iteration cap per execution (default 6) |
| `QESTRA_AUTO_HEARTBEAT_SECONDS` | Auto-tick interval; 0 = manual via the dashboard button |
| `LLM_PROVIDER` / `LLM_MODEL` / `LLM_API_KEY` / `LLM_BASE_URL` | Process-level fallback used only if no key is stored via the dashboard |

For production:

```txt
NODE_ENV=production
API_AUTH_TOKEN=<at least 32 characters>
ENCRYPTION_SECRET=<at least 32 characters>
MONGODB_URI=<mongodb connection string>
CORS_ORIGINS=<allowed browser origins>
BACKEND_API_BASE=<Fastify API URL for the Next.js server proxy>
```

`API_AUTH_TOKEN` is used server-to-server by the Next.js proxy. Do not expose it as `NEXT_PUBLIC_*`.

## Verification

```powershell
npm run check
```

This runs:

```txt
TypeScript typecheck (across all packages and apps)
Agent runtime + API hardening tests (Node test runner)
Next.js production build
```

## Architecture

```txt
apps/
  api/        Fastify server, RBAC, provider settings, heartbeat orchestrator
  web/        Next.js dashboard + API proxy
  workers/    Optional BullMQ worker (uses the same heartbeat orchestrator)
packages/
  llm/        Provider abstraction + OpenAI-compatible / Anthropic / Mock implementations
  tools/      Tool definitions (http, file, notes, shell), router, registry
  agents/     The runtime loop — pure, doesn't touch storage
```

The runtime in `packages/agents/src/runtime.ts` is intentionally storage-free: it takes a provider + router + state and produces events + a new state. The repository layer translates those events into Mongo/in-memory writes. This is what makes the same loop work behind either backend and lets the BullMQ worker reuse the API server's orchestrator verbatim.

## Docker

Infrastructure only:

```powershell
docker compose up -d mongodb redis
```

Full app stack:

```powershell
docker compose --profile app up --build
```

## Roadmap

- AWS Bedrock provider (SigV4)
- Real user accounts + per-user RBAC instead of shared bearer token
- Streaming the LLM response to the dashboard during execution
- Per-agent custom system prompts and tool subsets
- Scheduled / cron triggers for tasks
- More tools: git, GitHub PRs, Linear, Slack

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md). Run `npm run check` before opening a PR.

## Security

Please do not open public issues for vulnerabilities. See [SECURITY.md](./SECURITY.md).

## License

MIT. See [LICENSE](./LICENSE).
