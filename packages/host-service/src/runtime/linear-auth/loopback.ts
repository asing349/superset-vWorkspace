import { createServer, type Server } from "node:http";

// Wave-7 M1 (OQ1) — transient loopback HTTP listener that captures the Linear
// OAuth redirect host-side. Mirrors the desktop's existing OpenAI OAuth
// loopback (packages/chat .../openai-oauth-loopback.ts): a one-shot
// `http://127.0.0.1:<port>/callback` server that hands the captured
// `{ code, state }` back to the service, then renders a "you can close this
// tab" page. Lower surface than a registered `superset://` custom scheme.

interface LoopbackStartOptions {
	host: string;
	port: number;
	path: string;
	onCallback: (result: { code: string; state: string | null }) => void;
	onError?: (error: Error) => void;
}

export interface LinearOAuthLoopbackHandle {
	stop: () => void;
}

export interface LinearOAuthLoopback {
	start: (options: LoopbackStartOptions) => Promise<void>;
	stop: () => void;
}

export class HttpLinearOAuthLoopback implements LinearOAuthLoopback {
	private server: Server | null = null;

	async start(options: LoopbackStartOptions): Promise<void> {
		return new Promise<void>((resolve, reject) => {
			const urlHost = options.host.includes(":")
				? `[${options.host}]`
				: options.host;
			const server = createServer((req, res) => {
				try {
					const requestUrl = new URL(
						req.url ?? "/",
						`http://${urlHost}:${options.port}`,
					);
					if (requestUrl.pathname !== options.path) {
						res.writeHead(404, { "content-type": "text/plain" });
						res.end("Not found");
						return;
					}

					const error = requestUrl.searchParams.get("error");
					const code = requestUrl.searchParams.get("code");
					if (error || !code) {
						const message = error ?? "Missing authorization code";
						res.writeHead(400, { "content-type": "text/html; charset=utf-8" });
						res.end(renderPage("Connection failed", escapeHtml(message)));
						options.onError?.(new Error(message));
						return;
					}

					res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
					res.end(
						renderPage(
							"Connected to Linear",
							"You can close this tab and return to Superset.",
						),
					);
					options.onCallback({
						code,
						state: requestUrl.searchParams.get("state"),
					});
				} catch (err) {
					const message = err instanceof Error ? err.message : String(err);
					try {
						res.writeHead(500, { "content-type": "text/plain" });
						res.end(message);
					} catch {
						// Response may already be sent — nothing more to do.
						options.onError?.(err instanceof Error ? err : new Error(message));
					}
				}
			});

			const onListenError = (err: Error) => reject(err);
			server.once("error", onListenError);
			server.listen(options.port, options.host, () => {
				server.off("error", onListenError);
				this.server = server;
				resolve();
			});
		});
	}

	stop(): void {
		if (this.server) {
			this.server.close();
			this.server = null;
		}
	}
}

function escapeHtml(input: string): string {
	return input
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&#39;");
}

const PAGE_STYLES = `
html, body { margin: 0; height: 100%; }
body {
  display: flex; align-items: center; justify-content: center;
  font-family: -apple-system, system-ui, sans-serif;
  background: #151110; color: #eae8e6;
}
.card {
  max-width: 380px; padding: 32px; border-radius: 12px;
  border: 1px solid #2a2827; background: #201e1c; text-align: center;
}
h1 { font-size: 16px; margin: 0 0 8px; font-weight: 600; }
p { font-size: 13px; color: #a8a5a3; margin: 0; }
`;

function renderPage(title: string, body: string): string {
	return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>Superset · ${title}</title>
<style>${PAGE_STYLES}</style>
</head>
<body>
<div class="card">
<h1>${title}</h1>
<p>${body}</p>
</div>
</body>
</html>`;
}
