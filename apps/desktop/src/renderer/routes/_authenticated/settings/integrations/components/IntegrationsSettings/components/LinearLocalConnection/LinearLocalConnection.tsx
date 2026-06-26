import { Button } from "@superset/ui/button";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useState } from "react";
import { getHostServiceClientByUrl } from "renderer/lib/host-service-client";
import { electronTrpcClient } from "renderer/lib/trpc-client";
import { useLocalHostService } from "renderer/routes/_authenticated/providers/LocalHostServiceProvider";

// Wave-7 M1 — one-button "Connect Linear (this Mac)" + local status, shown
// beside the cloud Linear connection. Cloud-precedence: while a cloud Linear
// connection is active, the local connect button is disabled with an explainer
// ("disconnect cloud Linear to connect this Mac"). The PKCE flow itself runs
// host-side; here we only start it, open the system browser, and poll for the
// captured redirect code. No token ever reaches the renderer.

interface LinearLocalConnectionProps {
	/** True when a cloud Linear connection is active (cloud-precedence). */
	cloudConnected: boolean;
}

function getErrorMessage(error: unknown, fallback: string): string {
	if (error instanceof Error && error.message.trim()) return error.message;
	return fallback;
}

export function LinearLocalConnection({
	cloudConnected,
}: LinearLocalConnectionProps) {
	const { activeHostUrl } = useLocalHostService();
	const queryClient = useQueryClient();

	const [isConnecting, setIsConnecting] = useState(false);
	const [pollEnabled, setPollEnabled] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const connectionQueryKey = [
		"linear-local-connection",
		activeHostUrl,
	] as const;

	const connectionQuery = useQuery({
		queryKey: connectionQueryKey,
		enabled: !!activeHostUrl,
		queryFn: () => {
			if (!activeHostUrl) throw new Error("Host service unavailable");
			return getHostServiceClientByUrl(
				activeHostUrl,
			).linear.auth.getConnection.query();
		},
	});

	const refetchConnection = useCallback(() => {
		void queryClient.invalidateQueries({ queryKey: connectionQueryKey });
	}, [queryClient, connectionQueryKey]);

	const completeMutation = useMutation({
		mutationFn: (code: string) => {
			if (!activeHostUrl) throw new Error("Host service unavailable");
			return getHostServiceClientByUrl(
				activeHostUrl,
			).linear.auth.completeConnect.mutate({ code });
		},
		onSuccess: () => {
			setIsConnecting(false);
			setPollEnabled(false);
			setError(null);
			refetchConnection();
		},
		onError: (err) => {
			setIsConnecting(false);
			setPollEnabled(false);
			setError(getErrorMessage(err, "Failed to complete Linear connection"));
		},
	});

	// Poll the host for the loopback-captured authorization code while a connect
	// is in progress, then exchange it. Mirrors the OpenAI OAuth loopback poll.
	const callbackQuery = useQuery({
		queryKey: ["linear-local-callback", activeHostUrl] as const,
		enabled: pollEnabled && !!activeHostUrl,
		refetchInterval: pollEnabled ? 1500 : false,
		refetchOnWindowFocus: false,
		queryFn: () => {
			if (!activeHostUrl) throw new Error("Host service unavailable");
			return getHostServiceClientByUrl(
				activeHostUrl,
			).linear.auth.consumeCallback.query();
		},
	});

	useEffect(() => {
		const code = callbackQuery.data?.code;
		if (!code || !pollEnabled) return;
		if (completeMutation.isPending) return;
		setPollEnabled(false);
		completeMutation.mutate(code);
	}, [callbackQuery.data?.code, pollEnabled, completeMutation]);

	const startConnect = useCallback(async () => {
		if (!activeHostUrl) {
			setError("Host service unavailable");
			return;
		}
		setError(null);
		setIsConnecting(true);
		try {
			const client = getHostServiceClientByUrl(activeHostUrl);
			const { url } = await client.linear.auth.startConnect.mutate();
			await electronTrpcClient.external.openUrl.mutate(url);
			setPollEnabled(true);
		} catch (err) {
			setIsConnecting(false);
			setPollEnabled(false);
			setError(getErrorMessage(err, "Failed to start Linear connection"));
		}
	}, [activeHostUrl]);

	const cancelConnect = useCallback(async () => {
		setIsConnecting(false);
		setPollEnabled(false);
		if (!activeHostUrl) return;
		try {
			await getHostServiceClientByUrl(
				activeHostUrl,
			).linear.auth.cancelConnect.mutate();
		} catch (err) {
			console.error("[integrations] Linear cancelConnect failed:", err);
		}
	}, [activeHostUrl]);

	const disconnectMutation = useMutation({
		mutationFn: () => {
			if (!activeHostUrl) throw new Error("Host service unavailable");
			return getHostServiceClientByUrl(
				activeHostUrl,
			).linear.auth.disconnect.mutate();
		},
		onSuccess: () => {
			setError(null);
			refetchConnection();
		},
		onError: (err) =>
			setError(getErrorMessage(err, "Failed to disconnect Linear")),
	});

	const connection = connectionQuery.data;
	const isLocalConnected = connection?.connected ?? false;
	const busy =
		isConnecting || completeMutation.isPending || disconnectMutation.isPending;

	const statusLabel = isLocalConnected
		? connection?.viewer
			? `Connected as ${connection.viewer}${
					connection.workspace ? ` (${connection.workspace})` : ""
				}`
			: "Connected"
		: isConnecting
			? "Waiting for browser authorization…"
			: "Not connected";

	return (
		<div>
			<div className="flex items-center justify-between gap-8 py-2 pl-11 pr-0">
				<div className="min-w-0">
					<div className="text-sm font-medium">This Mac (local)</div>
					<div className="flex items-center gap-1.5 mt-0.5">
						<span
							className={
								isLocalConnected
									? "size-2 rounded-full bg-green-500"
									: "size-2 rounded-full bg-muted-foreground/30"
							}
						/>
						<span className="text-xs text-muted-foreground">{statusLabel}</span>
					</div>
					{cloudConnected && !isLocalConnected && (
						<div className="text-xs text-muted-foreground mt-1">
							Disconnect cloud Linear to connect this Mac.
						</div>
					)}
					{error && (
						<div className="text-xs text-destructive mt-1 select-text cursor-text">
							{error}
						</div>
					)}
				</div>
				<div className="flex items-center gap-2 shrink-0">
					{isLocalConnected ? (
						<Button
							variant="outline"
							size="sm"
							disabled={busy}
							onClick={() => disconnectMutation.mutate()}
						>
							Disconnect
						</Button>
					) : isConnecting ? (
						<Button
							variant="outline"
							size="sm"
							onClick={() => {
								void cancelConnect();
							}}
						>
							Cancel
						</Button>
					) : (
						<Button
							variant="outline"
							size="sm"
							disabled={cloudConnected || busy || !activeHostUrl}
							title={
								cloudConnected
									? "Disconnect cloud Linear to connect this Mac"
									: undefined
							}
							onClick={() => {
								void startConnect();
							}}
						>
							Connect Linear (this Mac)
						</Button>
					)}
				</div>
			</div>
		</div>
	);
}
