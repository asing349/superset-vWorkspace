import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { auth } from "@superset/auth/server";
import { createMcpServer } from "@superset/mcp";
import { limitJsonRequest } from "@superset/shared/request-limits";
import { verifyBearerToken as verifyAccessToken } from "better-auth/oauth2";
import { env } from "@/env";
import { handleMcpRequest, type McpRequestDeps } from "./auth-flow";

const deps: McpRequestDeps = {
	apiUrl: env.NEXT_PUBLIC_API_URL,
	authApi: auth.api,
	createServer: createMcpServer,
	createTransport: () => new WebStandardStreamableHTTPServerTransport(),
	verifyAccessToken,
};

async function handleRequest(req: Request): Promise<Response> {
	const bounded = await limitJsonRequest(req);
	if (bounded instanceof Response) return bounded;
	req = bounded;
	return handleMcpRequest(req, deps);
}

export const maxDuration = 800;

export { handleRequest as GET, handleRequest as POST, handleRequest as DELETE };
