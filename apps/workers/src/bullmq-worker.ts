import "dotenv/config";
import { Worker } from "bullmq";
import IORedis from "ioredis";
import { buildToolRegistry } from "../../../packages/tools/src/registry";
import { readConfig } from "../../api/src/config";
import { runHeartbeat } from "../../api/src/orchestrator/heartbeat";
import { HEARTBEAT_JOB_NAME, HEARTBEAT_QUEUE_NAME } from "../../api/src/queue/heartbeat-queue";
import { createRepository } from "../../api/src/repositories/create-repository";

const config = readConfig();

if (!config.redisUrl) {
  console.log("REDIS_URL not set; BullMQ worker is disabled.");
  process.exit(0);
}

async function main() {
  const redisUrl = config.redisUrl;
  if (!redisUrl) throw new Error("REDIS_URL is required to start the BullMQ worker.");

  const repository = await createRepository(config);
  const toolRouter = buildToolRegistry({
    workspaceDir: config.workspaceDir,
    notesStore: repository.notesStore(),
    shell: { allowedCommands: config.shellAllowlist, cwd: config.workspaceDir },
    http: { allowHosts: config.httpAllowHosts, denyHosts: config.httpDenyHosts }
  });

  const connection = new IORedis(redisUrl, { maxRetriesPerRequest: null });

  const worker = new Worker(
    HEARTBEAT_QUEUE_NAME,
    async (job) => {
      if (job.name !== HEARTBEAT_JOB_NAME) {
        throw new Error(`Unknown job: ${job.name}`);
      }
      await runHeartbeat({ repository, toolRouter, config });
      const snapshot = await repository.getSnapshot();
      return {
        companyId: snapshot.company._id,
        openTasks: snapshot.tasks.filter((task) => task.status !== "done").length,
        pendingApprovals: snapshot.approvals.filter((approval) => approval.status === "pending").length
      };
    },
    { connection }
  );

  worker.on("completed", (job) => console.log(`Heartbeat job ${job.id} completed.`));
  worker.on("failed", (job, error) => console.error(`Heartbeat job ${job?.id ?? "unknown"} failed:`, error));
  console.log(`BullMQ worker listening on ${HEARTBEAT_QUEUE_NAME}.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
