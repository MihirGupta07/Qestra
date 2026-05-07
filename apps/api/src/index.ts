import { readConfig } from "./config";
import { buildServer } from "./server";

async function main() {
  const config = readConfig();
  const app = await buildServer();
  await app.listen({ host: config.host, port: config.port });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
