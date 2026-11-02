import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { ticketRunFeedback } from "../../utils/ticketRunFeedback/ticketRunFeedback";
import { TicketRunFeedbackView } from "./TicketRunFeedbackView";

test("mixed dispatch results retain repo status, errors, branch and diagnostic ids in the panel", () => {
	const feedback = ticketRunFeedback({
		projects: [
			{ id: "web", name: "Web" },
			{ id: "api", name: "API" },
		],
		result: {
			runs: [
				{
					runId: "run-web",
					projectId: "web",
					status: "dispatched",
					workspaceId: "ws-web",
					branch: "feat/ticket",
					error: null,
				},
				{
					runId: "run-api",
					projectId: "api",
					status: "failed",
					workspaceId: null,
					branch: null,
					error: "Permission denied <script>\nTry another path",
				},
			],
		},
	});
	const html = renderToStaticMarkup(
		<TicketRunFeedbackView feedback={feedback} />,
	);
	for (const text of [
		"Web",
		"API",
		"Dispatched",
		"Failed",
		"feat/ticket",
		"run-web",
		"run-api",
		"ws-web",
		"Permission denied &lt;script&gt;",
		"Try another path",
	]) {
		expect(html).toContain(text);
	}
	expect(html).not.toContain("<script>");
	expect(html).toContain('aria-live="polite"');
	expect(html).toContain("select-text");
});

test("a failed repo without an error gets an explicit fallback", () => {
	const feedback = ticketRunFeedback({
		projects: [],
		result: {
			runs: [
				{
					runId: "run",
					projectId: "unknown",
					status: "failed",
					workspaceId: null,
					branch: null,
					error: null,
				},
			],
		},
	});
	const html = renderToStaticMarkup(
		<TicketRunFeedbackView feedback={feedback} />,
	);
	expect(html).toContain("unknown");
	expect(html).toContain("No error details returned.");
});
