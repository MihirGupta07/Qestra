import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { join, normalize, relative, resolve, sep } from "node:path";
import { fail, ok, truncate, type ToolDefinition } from "./types";

export interface FileToolOptions {
  /** Absolute path to the workspace directory. All paths are confined here. */
  workspaceDir: string;
  /** Max bytes of file body returned to the LLM. */
  maxReadChars?: number;
  /** Max bytes accepted per write call. */
  maxWriteChars?: number;
}

interface ResolvedPath {
  absolute: string;
  relative: string;
}

function buildResolver(workspaceDir: string) {
  const root = resolve(workspaceDir);
  return async (input: string): Promise<ResolvedPath | { error: string }> => {
    await mkdir(root, { recursive: true });
    const cleaned = normalize(input ?? ".").replace(/^[/\\]+/, "");
    const absolute = resolve(root, cleaned);
    const rel = relative(root, absolute);
    if (rel.startsWith("..") || rel.startsWith(`..${sep}`) || resolve(absolute) !== absolute || !absolute.startsWith(root)) {
      return { error: `path ${input} escapes the workspace` };
    }
    return { absolute, relative: rel || "." };
  };
}

export function createFileTools(options: FileToolOptions): ToolDefinition[] {
  const resolveSafe = buildResolver(options.workspaceDir);
  const maxRead = options.maxReadChars ?? 8000;
  const maxWrite = options.maxWriteChars ?? 200_000;

  const list: ToolDefinition = {
    name: "file.list",
    description: "List files and directories inside the workspace, relative to a given path (defaults to root).",
    requiredScope: "file:read",
    sensitive: false,
    parameters: {
      type: "object",
      properties: { path: { type: "string", default: "." } },
      additionalProperties: false
    },
    async execute(args) {
      const resolved = await resolveSafe(String(args.path ?? "."));
      if ("error" in resolved) return fail(resolved.error);
      try {
        const info = await stat(resolved.absolute).catch(() => null);
        if (!info) return ok(`(empty) ${resolved.relative}`, { entries: [] });
        if (info.isFile()) {
          return ok(`file ${resolved.relative} (${info.size} bytes)`, { entries: [resolved.relative] });
        }
        const entries = await readdir(resolved.absolute, { withFileTypes: true });
        const rows = entries.map((entry) => ({
          name: entry.name,
          kind: entry.isDirectory() ? "dir" : "file"
        }));
        const summary = rows.map((row) => `${row.kind === "dir" ? "📁" : "📄"} ${row.name}`).join("\n") || "(empty directory)";
        return ok(`Contents of ${resolved.relative}:\n${summary}`, { entries: rows });
      } catch (error) {
        return fail((error as Error).message);
      }
    }
  };

  const read: ToolDefinition = {
    name: "file.read",
    description: "Read the contents of a UTF-8 file inside the workspace. Use file.list first to discover paths.",
    requiredScope: "file:read",
    sensitive: false,
    parameters: {
      type: "object",
      properties: { path: { type: "string" } },
      required: ["path"],
      additionalProperties: false
    },
    async execute(args) {
      const resolved = await resolveSafe(String(args.path ?? ""));
      if ("error" in resolved) return fail(resolved.error);
      try {
        const content = await readFile(resolved.absolute, "utf8");
        return ok(`# ${resolved.relative}\n${truncate(content, maxRead)}`, { bytes: content.length });
      } catch (error) {
        return fail((error as Error).message);
      }
    }
  };

  const write: ToolDefinition = {
    name: "file.write",
    description:
      "Create or overwrite a UTF-8 file inside the workspace. Parent directories are created automatically.",
    requiredScope: "file:write",
    sensitive: false,
    parameters: {
      type: "object",
      properties: {
        path: { type: "string" },
        content: { type: "string" }
      },
      required: ["path", "content"],
      additionalProperties: false
    },
    async execute(args) {
      const resolved = await resolveSafe(String(args.path ?? ""));
      if ("error" in resolved) return fail(resolved.error);
      const content = String(args.content ?? "");
      if (content.length > maxWrite) {
        return fail(`content exceeds max write size of ${maxWrite} chars`);
      }
      try {
        const parent = resolved.absolute.split(sep).slice(0, -1).join(sep);
        if (parent) await mkdir(parent, { recursive: true });
        await writeFile(resolved.absolute, content, "utf8");
        return ok(`wrote ${content.length} bytes to ${resolved.relative}`, { path: resolved.relative });
      } catch (error) {
        return fail((error as Error).message);
      }
    }
  };

  return [list, read, write];
}

export function defaultWorkspaceDir(): string {
  return resolve(process.cwd(), "workspace");
}
// Re-export so callers can build subpaths in the same convention.
export { join as joinPath };
