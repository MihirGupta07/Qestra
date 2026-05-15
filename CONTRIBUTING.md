# Contributing

Thanks for helping improve Qestra Orchestrator.

## Development

```powershell
npm install
npm run dev
```

Run the full verification suite before opening a pull request:

```powershell
npm run check
```

## Pull Requests

- Keep changes focused.
- Include tests for API behavior, security-sensitive changes, queues, approvals, or budget logic.
- Update docs when changing setup, configuration, or public behavior.
- Do not commit secrets, local `.env` files, logs, or generated build output.

## Architecture Notes

Qestra is intentionally built around governed orchestration:

- customer-owned provider keys
- approval gates for sensitive tool calls
- durable execution traces
- audit-chain records
- budget and queue controls

Please preserve those constraints when adding tools or agent capabilities.
