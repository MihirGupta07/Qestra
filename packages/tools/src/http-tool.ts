import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { fail, ok, truncate, type ToolDefinition } from "./types";

export interface HttpToolOptions {
  /** If set, only these hostnames (suffix-match) are allowed. */
  allowHosts?: string[];
  /** Always-denied hostnames. */
  denyHosts?: string[];
  /** Hard cap on the response body returned to the LLM. */
  maxResponseChars?: number;
  /** Per-request timeout. */
  timeoutMs?: number;
}

export function createHttpFetchTool(options: HttpToolOptions = {}): ToolDefinition {
  const allowHosts = (options.allowHosts ?? []).map((host) => host.toLowerCase());
  const denyHosts = (options.denyHosts ?? []).map((host) => host.toLowerCase());
  const maxChars = options.maxResponseChars ?? 4000;
  const timeoutMs = options.timeoutMs ?? 15_000;

  return {
    name: "http.fetch",
    description:
      "Fetch a URL and return the response body. Use for reading web pages or calling APIs. Always returns text; binary responses are truncated.",
    requiredScope: "http:fetch",
    sensitive: false,
    parameters: {
      type: "object",
      properties: {
        url: { type: "string", description: "Absolute http(s) URL." },
        method: { type: "string", enum: ["GET", "POST", "PUT", "DELETE", "PATCH"], default: "GET" },
        headers: { type: "object", additionalProperties: { type: "string" } },
        body: { type: "string", description: "Request body (string). For JSON, pre-serialize it." }
      },
      required: ["url"],
      additionalProperties: false
    },
    async execute(args) {
      const url = String(args.url ?? "");
      const method = String(args.method ?? "GET").toUpperCase();
      const headers = (args.headers ?? {}) as Record<string, string>;
      const body = args.body as string | undefined;

      let parsed: URL;
      try {
        parsed = new URL(url);
      } catch {
        return fail(`invalid URL: ${url}`);
      }

      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        return fail(`unsupported protocol ${parsed.protocol}`);
      }

      const host = parsed.hostname.toLowerCase();

      if (denyHosts.some((deny) => host === deny || host.endsWith(`.${deny}`))) {
        return fail(`host ${host} is on the deny list`);
      }
      if (allowHosts.length > 0 && !allowHosts.some((allow) => host === allow || host.endsWith(`.${allow}`))) {
        return fail(`host ${host} is not on the allow list`);
      }

      // SSRF guard: resolve the host and block private/loopback/link-local ranges.
      try {
        const addresses = isIP(host) ? [{ address: host, family: isIP(host) }] : await lookup(host, { all: true });
        for (const { address } of addresses) {
          if (isPrivateAddress(address)) {
            return fail(`refusing to fetch private network address ${address}`);
          }
        }
      } catch (error) {
        return fail(`DNS lookup failed: ${(error as Error).message}`);
      }

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);

      try {
        const response = await fetch(url, {
          method,
          headers: { "user-agent": "qestra-agent/0.1", ...headers },
          body: method === "GET" || method === "HEAD" ? undefined : body,
          signal: controller.signal
        });

        const text = await response.text();
        const summary = `HTTP ${response.status} ${response.statusText} (${text.length} bytes)\n${truncate(text, maxChars)}`;

        return ok(summary, {
          status: response.status,
          headers: Object.fromEntries(response.headers.entries()),
          bodyPreview: text.slice(0, 500)
        });
      } catch (error) {
        if ((error as Error).name === "AbortError") {
          return fail(`timeout after ${timeoutMs}ms`);
        }
        return fail((error as Error).message);
      } finally {
        clearTimeout(timer);
      }
    }
  };
}

function isPrivateAddress(address: string): boolean {
  if (address === "0.0.0.0" || address === "::" || address === "::1") return true;
  if (address.startsWith("127.")) return true;
  if (address.startsWith("10.")) return true;
  if (address.startsWith("192.168.")) return true;
  if (address.startsWith("169.254.")) return true; // link-local
  if (address.startsWith("fc") || address.startsWith("fd")) return true; // IPv6 ULA
  if (address.startsWith("fe80")) return true; // IPv6 link-local
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(address)) return true; // 172.16/12
  return false;
}
