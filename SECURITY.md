# Security Policy

Qestra Orchestrator handles sensitive data such as customer-owned LLM provider keys, execution logs, and approval records.

## Supported Versions

The `main` branch is the currently supported development branch.

## Reporting a Vulnerability

Please do not open public issues for security vulnerabilities.

Use GitHub private vulnerability reporting or contact the maintainer through the repository owner account.

Include:

- affected component
- reproduction steps
- impact
- suggested fix, if known

## Secret Handling

- Never commit `.env` files.
- Use `ENCRYPTION_SECRET` with at least 32 characters in production.
- Rotate customer provider keys if there is any suspected exposure.
- Do not expose `API_AUTH_TOKEN` to browser code or `NEXT_PUBLIC_*` variables.

## Production Notes

The current role system is an MVP layer. Production deployments should replace role headers with real authentication, company membership, and server-side authorization checks.
