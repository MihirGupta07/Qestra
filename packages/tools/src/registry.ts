/**
 * Build the default tool set from configuration. The API server constructs one
 * router per process and reuses it across heartbeats.
 */
import { createFileTools } from "./file-tool";
import { createHttpFetchTool, type HttpToolOptions } from "./http-tool";
import { createNotesTools, type NotesStore } from "./notes-tool";
import { createShellTool } from "./shell-tool";
import { ToolRouter } from "./tool-router";
import type { ToolDefinition } from "./types";

export interface ToolRegistryOptions {
  workspaceDir: string;
  notesStore: NotesStore;
  shell: { allowedCommands: string[]; cwd?: string; timeoutMs?: number };
  http?: HttpToolOptions;
}

export function buildToolRegistry(options: ToolRegistryOptions): ToolRouter {
  const tools: ToolDefinition[] = [
    createHttpFetchTool(options.http ?? {}),
    ...createFileTools({ workspaceDir: options.workspaceDir }),
    ...createNotesTools(options.notesStore),
    createShellTool({
      cwd: options.shell.cwd ?? options.workspaceDir,
      allowedCommands: options.shell.allowedCommands,
      timeoutMs: options.shell.timeoutMs
    })
  ];

  return new ToolRouter(tools);
}

export { ToolRouter } from "./tool-router";
export * from "./types";
