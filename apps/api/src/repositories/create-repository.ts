import type { ApiConfig } from "../config";
import { InMemoryOrchestratorRepository } from "./in-memory-orchestrator-repository";
import { MongoOrchestratorRepository } from "./mongo-orchestrator-repository";
import type { OrchestratorRepository } from "./orchestrator-repository";

export async function createRepository(config: ApiConfig): Promise<OrchestratorRepository> {
  if (!config.mongoUri) {
    console.log("MONGODB_URI not set; using in-memory repository.");
    return new InMemoryOrchestratorRepository();
  }

  return MongoOrchestratorRepository.connect(config.mongoUri, config.mongoDbName);
}
