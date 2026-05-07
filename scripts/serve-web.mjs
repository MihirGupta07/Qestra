import "dotenv/config";
import { createReadStream, existsSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";

const root = normalize(join(process.cwd(), "apps", "web"));
const port = Number(process.env.WEB_PORT ?? 4173);

const mimeTypes = new Map([
  [".html", "text/html; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"]
]);

const server = createServer((request, response) => {
  const url = new URL(request.url ?? "/", `http://localhost:${port}`);
  const requestedPath = normalize(join(root, url.pathname === "/" ? "index.html" : url.pathname));

  if (!requestedPath.startsWith(root) || !existsSync(requestedPath)) {
    response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    response.end("Not found");
    return;
  }

  response.writeHead(200, {
    "content-type": mimeTypes.get(extname(requestedPath)) ?? "application/octet-stream"
  });
  createReadStream(requestedPath).pipe(response);
});

server.listen(port, () => {
  console.log(`Qestra Orchestrator running at http://localhost:${port}`);
});
