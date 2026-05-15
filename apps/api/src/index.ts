import { readConfig } from "./config";
import { buildServer } from "./server";

async function main() {
  const config = readConfig();
  const app = await buildServer();
  await app.listen({ host: config.host, port: config.port });

  const shutdown = async (signal: string) => {
    app.log.info({ signal }, "Shutting down API server");
    await app.close();
    process.exit(0);
  };

  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
