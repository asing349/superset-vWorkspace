import {
	assertInputWithinLimits,
	assertJsonTextWithinLimits,
	INPUT_LIMITS,
	InputLimitError,
} from "./input-limits";

function rejection(
	request: Request,
	status: number,
	message: string,
): Response {
	const url = new URL(request.url);
	if (url.pathname.includes("/trpc/")) {
		const error = {
			error: {
				json: {
					message,
					code: status === 413 ? -32013 : -32700,
					data: {
						code: status === 413 ? "PAYLOAD_TOO_LARGE" : "PARSE_ERROR",
						httpStatus: status,
					},
				},
			},
		};
		return Response.json(error, { status });
	}
	return Response.json(
		{ jsonrpc: "2.0", id: null, error: { code: -32600, message } },
		{ status },
	);
}

/** Read at most one bounded JSON request before a Fetch adapter/schema sees it.
 * Count actual chunks rather than trusting Content-Length (including chunked bodies).
 */
export async function limitJsonRequest(
	request: Request,
): Promise<Request | Response> {
	const reject = (status: number, message: string) =>
		rejection(request, status, message);
	const encoder = new TextEncoder();
	if (
		request.url.length > INPUT_LIMITS.urlBytes ||
		encoder.encode(request.url).byteLength > INPUT_LIMITS.urlBytes
	)
		return reject(413, "Request URL exceeds the supported size limit.");
	const url = new URL(request.url);
	let paths: string[];
	try {
		paths = decodeURIComponent(url.pathname).split(",");
	} catch {
		return reject(400, "Invalid request path.");
	}
	if (paths.length > INPUT_LIMITS.batchCalls)
		return reject(413, "RPC batch exceeds 32 calls.");
	const large = paths.some((path) =>
		/(?:^|[/.])(?:attachments\.upload|sendMessage|restartFromMessage)$/.test(
			path,
		),
	);
	const maxBytes = large
		? INPUT_LIMITS.attachmentRequestBytes
		: INPUT_LIMITS.requestBytes;
	const declared = request.headers.get("content-length");
	if (declared && Number(declared) > maxBytes)
		return reject(413, "Request body exceeds the supported size limit.");
	if (!request.body) return request;
	const reader = request.body.getReader();
	const chunks: Uint8Array[] = [];
	let bytes = 0;
	try {
		while (true) {
			const chunk = await reader.read();
			if (chunk.done) break;
			bytes += chunk.value.byteLength;
			if (bytes > maxBytes) {
				void reader.cancel().catch(() => {});
				return reject(413, "Request body exceeds the supported size limit.");
			}
			chunks.push(chunk.value);
		}
	} finally {
		reader.releaseLock();
	}
	if (bytes === 0) return new Request(request, { body: null });
	const body = new Uint8Array(bytes);
	let offset = 0;
	for (const chunk of chunks) {
		body.set(chunk, offset);
		offset += chunk.byteLength;
	}
	try {
		const text = new TextDecoder().decode(body);
		assertJsonTextWithinLimits(text);
		const input: unknown = JSON.parse(text);
		if (Array.isArray(input) && input.length > INPUT_LIMITS.batchCalls)
			throw new InputLimitError("RPC batch calls");
		assertInputWithinLimits(input);
	} catch (error) {
		return error instanceof InputLimitError
			? reject(413, error.message)
			: reject(400, "Invalid JSON request body.");
	}
	return new Request(request, { body });
}
