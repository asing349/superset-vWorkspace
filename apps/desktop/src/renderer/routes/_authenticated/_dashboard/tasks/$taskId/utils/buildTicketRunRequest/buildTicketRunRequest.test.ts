import { describe, expect, test } from "bun:test";
import {
	buildTicketRunRequest,
	multiRepoConfirmMessage,
} from "./buildTicketRunRequest";

describe("buildTicketRunRequest", () => {
	test("single repo: primary only, approvedContextProjectId = primary", () => {
		const req = buildTicketRunRequest({
			taskId: "task-1",
			ticketKey: "SUPER-172",
			primaryProjectId: "proj-a",
			additionalProjectIds: [],
		});
		expect(req).toEqual({
			taskId: "task-1",
			ticketKey: "SUPER-172",
			repos: [{ projectId: "proj-a" }],
			approvedContextProjectId: "proj-a",
		});
	});

	test("multi repo: primary first, then additional in order", () => {
		const req = buildTicketRunRequest({
			taskId: "task-1",
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
