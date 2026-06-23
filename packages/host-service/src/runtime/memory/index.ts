export { gatherChangedFiles } from "./capture-gather.ts";
export {
	type ConsolidationProposal,
	MemoryConsolidationService,
	type MemoryConsolidationServiceOptions,
} from "./consolidation-service.ts";
export {
	createOllamaEmbeddingsClient,
	type EmbeddingsClient,
	type EmbeddingsServiceOptions,
	type EmbeddingsSettings,
	type EmbeddingsStatus,
	MemoryEmbeddingsService,
	type SemanticMatch,
} from "./embeddings-service.ts";
export { IndexRefreshWatcher } from "./index-refresh-watcher.ts";
export {
	ProjectIndexService,
	type ProjectIndexServiceOptions,
	type ProjectIndexStatus,
} from "./index-service.ts";
export {
	createHostMemoryMcpServer,
	HostMemoryDataProvider,
} from "./mcp-provider.ts";
export * from "./paths.ts";
export {
	ANTI_PATTERN_PREFIX,
	type PrTerminalState,
	type ReconcileResult,
	reconcilePlaybooksForPr,
} from "./pr-capture-reconciler.ts";
export {
	type GenerateMemorySkillResult,
	generateMemorySkill,
	MEMORY_SKILL_RELATIVE_PATH,
	renderMemorySkill,
} from "./push-generator.ts";
export {
	MemoryRetrieveService,
	type RetrieveInput,
	type RetrieveResult,
} from "./retrieve-service.ts";
export { extractSymbols } from "./symbol-extractor.ts";
export {
	MemoryVaultService,
	type RegenerateVaultResult,
} from "./vault-service.ts";
