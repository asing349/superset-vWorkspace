import { describe, expect, test } from "bun:test";
import {
	buildTicketRunRequest,
	makeTicketRunUnifiedId,
	multiRepoConfirmMessage,
} from "./buildTicketRunRequest";

describe("makeTicketRunUnifiedId", () => {
	test("builds the source-tagged 'source:sourceId' id", () => {
		expect(
			makeTicketRunUnifiedId({ source: "cloud", sourceId: "task-1" }),
		).toBe("cloud:task-1");
		expect(
			makeTicketRunUnifiedId({ source: "local", sourceId: "issue-9" }),
		).toBe("local:issue-9");
	});
});

describe("buildTicketRunRequest", () => {
	test("single repo: primary only, approvedContextProjectId = primary, carries unifiedId", () => {
		const req = buildTicketRunRequest({
			taskId: "task-1",
			unifiedId: "cloud:task-1",
			ticketKey: "SUPER-172",
			primaryProjectId: "proj-a",
			additionalProjectIds: [],
		});
		expect(req).toEqual({
			taskId: "task-1",
			unifiedId: "cloud:task-1",
			ticketKey: "SUPER-172",
			repos: [{ projectId: "proj-a" }],
			approvedContextProjectId: "proj-a",
		});
	});

	test("carries a LOCAL unifiedId unchanged (source-agnostic)", () => {
		const req = buildTicketRunRequest({
			taskId: "local:issue-9",
			unifiedId: "local:issue-9",
			ticketKey: "ENG-42",
			primaryProjectId: "proj-a",
			additionalProjectIds: [],
		});
		expect(req.unifiedId).toBe("local:issue-9");
		expect(req.taskId).toBe("local:issue-9");
	});

	test("multi repo: primary first, then additional in order", () => {
		const req = buildTicketRunRequest({
			taskId: "task-1",
			unifiedId: "cloud:task-1",
			ticketKey: "SUPER-172",
			primaryProjectId: "proj-a",
			additionalProjectIds: ["proj-b", "proj-c"],
		});
		expect(req.repos).toEqual([
			{ projectId: "proj-a" },
			{ projectId: "proj-b" },
			{ projectId: "proj-c" },
		]);
		expect(req.approvedContextProjectId).toBe("proj-a");
	});

	test("de-dupes the primary out of the additional set", () => {
		const req = buildTicketRunRequest({
			taskId: "task-1",
			unifiedId: "cloud:task-1",
			ticketKey: "SUPER-172",
			primaryProjectId: "proj-a",
			additionalProjectIds: ["proj-a", "proj-b", "proj-b"],
		});
		expect(req.repos).toEqual([
			{ projectId: "proj-a" },
			{ projectId: "proj-b" },
		]);
	});
});

describe("multiRepoConfirmMessage", () => {
	test("lists every repo name in the one confirm", () => {
		expect(multiRepoConfirmMessage(["Web", "API", "DB"])).toBe(
			"Changes needed in Web, API, DB — proceed?",
		);
	});
});
