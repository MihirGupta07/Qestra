import { spawn } from "node:child_process";
import { fail, ok, truncate, type ToolDefinition } from "./types";

export interface ShellToolOptions {
  /** Working directory; defaults to the workspace dir or process.cwd(). */
  cwd: string;
  /** Allowed first tokens (executable names). Empty array disables the tool entirely. */
  allowedCommands: string[];
  timeoutMs?: number;
  maxOutputChars?: number;
}

/**
 * `shell.exec` is always sensitive — every invocation goes through the approval
 * gate before it actually runs. The allowlist provides defense in depth in case
 * a human approver isn't paying attention.
 */
export function createShellTool(options: ShellToolOptions): ToolDefinition {
  const allow = new Set(options.allowedCommands.map((command) => command.toLowerCase()));
  const timeoutMs = options.timeoutMs ?? 30_000;
  const maxOutput = options.maxOutputChars ?? 4000;

  return {
    name: "shell.exec",
    description:
      "Run a single shell command from the allowlist. Pass argv as a string array; do not include shell metacharacters. Sensitive: every call requires human approval.",
    requiredScope: "shell:exec",
    sensitive: true,
    parameters: {
      type: "object",
      properties: {
        command: { type: "string", description: "Executable name (must be on the allowlist)." },
        args: { type: "array", items: { type: "string" }, default: [] }
      },
      required: ["command"],
      additionalProperties: false
    },
    async execute(args) {
      const command = String(args.command ?? "");
      const argv = Array.isArray(args.args) ? args.args.map(String) : [];

      if (allow.size === 0) {
        return fail("shell.exec is disabled (QESTRA_SHELL_ALLOWLIST is empty)");
      }
      if (!allow.has(command.toLowerCase())) {
        return fail(`command "${command}" is not on the allowlist`);
      }

      return new Promise((resolve) => {
        const stdout: Buffer[] = [];
        const stderr: Buffer[] = [];
        const child = spawn(command, argv, {
          cwd: options.cwd,
          shell: false,
          windowsHide: true
        });
        const timer = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
        child.stdout.on("data", (chunk) => stdout.push(chunk));
        child.stderr.on("data", (chunk) => stderr.push(chunk));
        child.on("error", (error) => {
          clearTimeout(timer);
          resolve(fail(error.message));
        });
        child.on("close", (code) => {
          clearTimeout(timer);
          const out = Buffer.concat(stdout).toString("utf8");
          const err = Buffer.concat(stderr).toString("utf8");
          const summary = `exit ${code ?? "?"}\n--- stdout ---\n${truncate(out, maxOutput)}\n--- stderr ---\n${truncate(err, 1000)}`;
          if (code === 0) {
            resolve(ok(summary, { exitCode: code, stdout: out.slice(0, 2000), stderr: err.slice(0, 500) }));
          } else {
            resolve({ ok: false, output: summary, errorMessage: `exit ${code}`, data: { exitCode: code } });
          }
        });
      });
    }
  };
}
