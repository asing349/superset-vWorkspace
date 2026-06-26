import { LinearClient } from "@linear/sdk";
import type { LinearIssue, LinearTeam, TicketFilter } from "./types";

// Wave-7 M2 — the Linear data client used by the poller. Built on `@linear/sdk`
// (`new LinearClient({ accessToken })`) with the host-local M1 token. The
// interface is injectable so the poller/tests run against a fake (no live API in
// CI). The access token NEVER leaves this layer and is NEVER logged.

/** Abstracts the Linear reads the poller needs. */
export interface LinearTicketClient {
	/** The viewer's issues (assigned-to-me OR created-by-me), optional team. */
	fetchIssues(filter: TicketFilter): Promise<LinearIssue[]>;
	/** Teams for the team picker. */
	fetchTeams(): Promise<LinearTeam[]>;
}

/** Build a client from a (decrypted, host-internal) access token. */
export type LinearTicketClientFactory = (input: {
	accessToken: string;
}) => LinearTicketClient;

// Only consider issues touched in the last 90 days — mirrors the cloud
// initial-sync window and keeps the local cache bounded.
const RECENT_WINDOW_MS = 1000 * 60 * 60 * 24 * 90;
const PAGE_SIZE = 100;

const ISSUES_QUERY = `
  query LocalAssignedIssues($first: Int!, $after: String, $filter: IssueFilter) {
    issues(first: $first, after: $after, filter: $filter) {
      pageInfo {
        hasNextPage
        endCursor
      }
      nodes {
        id
        identifier
        title
        description
        priority
        createdAt
        updatedAt
        url
        assignee {
          id
          name
          email
        }
        state {
          id
          name
          type
        }
        team {
          id
          key
          name
        }
      }
    }
  }
`;

interface IssuesQueryResponse {
	issues: {
		pageInfo: { hasNextPage: boolean; endCursor: string | null };
		nodes: LinearIssue[];
	};
}

function buildIssueFilter({ teamId }: TicketFilter): Record<string, unknown> {
	const since = new Date(Date.now() - RECENT_WINDOW_MS).toISOString();
	const filter: Record<string, unknown> = {
		updatedAt: { gte: since },
		// The viewer's issues: assigned to me OR created by me.
		or: [
			{ assignee: { isMe: { eq: true } } },
			{ creator: { isMe: { eq: true } } },
		],
	};
	if (teamId) filter.team = { id: { eq: teamId } };
	return filter;
}

/** Real implementation backed by `@linear/sdk`. */
export class SdkLinearTicketClient implements LinearTicketClient {
	private readonly client: LinearClient;

	constructor({ accessToken }: { accessToken: string }) {
		this.client = new LinearClient({ accessToken });
	}

	async fetchIssues(filter: TicketFilter): Promise<LinearIssue[]> {
		const issueFilter = buildIssueFilter(filter);
		const issues: LinearIssue[] = [];
		let after: string | undefined;
		do {
			const response = await this.client.client.request<
				IssuesQueryResponse,
				{ first: number; after?: string; filter: Record<string, unknown> }
			>(ISSUES_QUERY, { first: PAGE_SIZE, after, filter: issueFilter });
			issues.push(...response.issues.nodes);
			after =
				response.issues.pageInfo.hasNextPage &&
				response.issues.pageInfo.endCursor
					? response.issues.pageInfo.endCursor
					: undefined;
		} while (after);
		return issues;
	}

	async fetchTeams(): Promise<LinearTeam[]> {
		const teams = await this.client.teams();
		return teams.nodes.map((team) => ({
			id: team.id,
			key: team.key,
			name: team.name,
		}));
	}
}

/** Factory used by the runtime (overridable in tests). */
export const createSdkLinearTicketClient: LinearTicketClientFactory = ({
	accessToken,
}) => new SdkLinearTicketClient({ accessToken });
