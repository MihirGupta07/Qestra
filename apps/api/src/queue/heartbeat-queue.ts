import { Queue } from "bullmq";
import IORedis from "ioredis";

export const HEARTBEAT_QUEUE_NAME = "agent-heartbeats";
export const HEARTBEAT_JOB_NAME = "run-heartbeat";

export interface HeartbeatQueue {
  enqueue(agentId?: string): Promise<void>;
  enabled: boolean;
}

export function createHeartbeatQueue(redisUrl?: string): HeartbeatQueue {
  if (!redisUrl) {
    return {
      enabled: false,
      async enqueue() {
        return undefined;
      }
    };
  }

  const connection = new IORedis(redisUrl, { maxRetriesPerRequest: null });
  const queue = new Queue(HEARTBEAT_QUEUE_NAME, { connection });

  return {
    enabled: true,
    async enqueue(agentId?: string) {
      await queue.add(HEARTBEAT_JOB_NAME, { agentId }, { attempts: 3, backoff: { type: "exponential", delay: 1000 } });
    }
  };
}
