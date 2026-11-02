import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";
import { redactText } from "@superset/memory";
import { and, eq } from "drizzle-orm";
import type { HostDb } from "../../db";
import { approvedTicketContext, projects } from "../../db/schema";
import { MemoryRetrieveService } from "../memory/retrieve-service";
import type { TicketPlanScope, TicketPlanSnapshot } from "./types";

const exec = promisify(execFile);
export function digest(value: string): string {
	return createHash("sha256").update(value).digest("hex");
}

export async function readTicketPlanSnapshot(
	db: HostDb,
	scope: TicketPlanScope,
	readGit?: (path: string, args: string[]) => Promise<string>,
): Promise<TicketPlanSnapshot> {
	const context = db
		.select()
		.from(approvedTicketContext)
		.where(
			and(
				eq(approvedTicketContext.taskId, scope.taskId),
				eq(approvedTicketContext.projectId, scope.approvedContextProjectId),
			),
		)
		.get()?.content;
	if (context === undefined)
		throw new Error("Approve the ticket context before preparing a plan.");
	if (
		scope.repos[0]?.projectId !== scope.approvedContextProjectId ||
		new Set(scope.repos.map((repo) => repo.projectId)).size !==
			scope.repos.length
	)
		throw new Error(
			"Plan scope must contain unique repos with the approved-context project first.",
		);
	const memory = new MemoryRetrieveService({ db });
	const practices = [
		memory.readPracticeVersion({ scope: "global", projectId: null }),
		...scope.repos.map((repo) =>
			memory.readPracticeVersion({
				scope: "project",
				projectId: repo.projectId,
			}),
		),
	];
	const repositories: TicketPlanSnapshot["repositories"] = [];
	const fingerprints: string[] = [];
	for (const repo of scope.repos) {
		const path = db
			.select()
			.from(projects)
			.where(eq(projects.id, repo.projectId))
			.get()?.repoPath;
		if (!path)
			throw new Error(
				`Repository is not set up on this host: ${repo.projectId}`,
			);
		const git = async (...args: string[]) =>
			readGit
				? readGit(path, args)
				: (
						await exec("git", ["--no-optional-locks", "-C", path, ...args], {
							maxBuffer: 8 * 1024 * 1024,
						})
					).stdout;
		const head = (await git("rev-parse", "HEAD")).trim();
		const refs = await git("show-ref");
		const diff = await git(
			"diff",
			"--no-ext-diff",
			"--no-textconv",
			"HEAD",
			"--",
		);
		const status = await git(
			"status",
			"--porcelain=v1",
			"--untracked-files=all",
		);
		const untracked = (
			await git("ls-files", "--others", "--exclude-standard", "-z")
		)
			.split("\0")
			.filter(Boolean);
		// Untracked source can affect the plan too. Hash bytes, never send them to the model here.
		let bytes = 0;
		const untrackedHashes = untracked.map((file) => {
			const target = join(path, file);
			bytes += statSync(target).size;
			if (bytes > 8 * 1024 * 1024)
				throw new Error(
					"Untracked files exceed the plan snapshot limit. Narrow or clean the repo before planning.",
				);
			return [
				file,
				createHash("sha256").update(readFileSync(target)).digest("hex"),
			];
		});
		repositories.push({ projectId: repo.projectId, path, head });
		fingerprints.push(
			digest(JSON.stringify({ head, refs, diff, status, untrackedHashes })),
		);
	}
	const primary = repositories[0];
	if (!primary)
		throw new Error("Select at least one repository before planning.");
	return {
		hash: digest(JSON.stringify({ scope, context, practices, fingerprints })),
		context: redactText(
			`${context}\n\nCoding practices (ticket context takes precedence):\n${JSON.stringify(practices)}`,
		).text,
		cwd: primary.path,
		repositories,
	};
}
