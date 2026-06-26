import { alert } from "@superset/ui/atoms/Alert";
import { Button } from "@superset/ui/button";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useState } from "react";
import { getHostServiceClientByUrl } from "renderer/lib/host-service-client";
import { electronTrpcClient } from "renderer/lib/trpc-client";
import { useLocalHostService } from "renderer/routes/_authenticated/providers/LocalHostServiceProvider";
import {
	deriveLinearLocalStatus,
	deriveLocalConnectAffordance,
	formatLinearLocalStatusLabel,
	isLocalActiveSource,
} from "./linearLocalConnectionState";

// Wave-7 M1 + M5 — one-button "Connect Linear (this Mac)" + local status, shown
// beside the cloud Linear connection. Cloud-precedence: while a cloud Linear
// connection is active, the local connect button is disabled with an explainer
// ("disconnect cloud Linear to connect this Mac") and a stored local token is
// shown as dormant. M5 adds: an active/dormant indicator (so the active source
// is obvious), an expired→one-button-reconnect prompt (the host's lazy PKCE
// refresh runs first; if it can't renew, the card prompts a re-connect), and a
// confirm before disconnect (which purges ONLY the local token host-side). The
// PKCE flow itself runs host-side; here we only start it, open the system
// browser, and poll for the captured redirect code. No token reaches the renderer.

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

	// Expired-token recovery: ask the host to run its lazy PKCE refresh. If the
	// refresh token is gone/rejected the host purges the local token and reports
	// `connected:false`, so the card falls back to the one-button connect prompt.
	const refreshMutation = useMutation({
		mutationFn: () => {
			if (!activeHostUrl) throw new Error("Host service unavailable");
			return getHostServiceClientByUrl(
				activeHostUrl,
			).linear.auth.refresh.mutate();
		},
		onSuccess: () => {
			setError(null);
			refetchConnection();
		},
		onError: (err) =>
			setError(getErrorMessage(err, "Failed to refresh Linear session")),
	});

	const confirmDisconnect = useCallback(() => {
		alert({
			title: "Disconnect Linear (this Mac)?",
			description:
				"This purges the local Linear token from this Mac. Your cloud Linear connection (if any) is unaffected. You can reconnect anytime with one button.",
			actions: [
				{
					label: "Disconnect",
					variant: "destructive",
					onClick: () => disconnectMutation.mutate(),
				},
				{ label: "Cancel", variant: "ghost" },
			],
		});
	}, [disconnectMutation]);

	const connection = connectionQuery.data;
	const localStatus = deriveLinearLocalStatus({
		connection,
		now: Date.now(),
	});
	const isLocalConnected = localStatus !== "disconnected";
	const isActiveSource = isLocalActiveSource({ cloudConnected, localStatus });
	const isDormant = isLocalConnected && cloudConnected;
	// Expiry only matters when the local connection would be the ACTIVE source:
	// while cloud is connected the local token is dormant regardless of expiry, so
	// we don't nag a re-connect — the dormant state takes over.
	const isExpired = localStatus === "expired" && !cloudConnected;

	const busy =
		isConnecting ||
		completeMutation.isPending ||
		disconnectMutation.isPending ||
		refreshMutation.isPending;

	const connectAffordance = deriveLocalConnectAffordance({
		cloudConnected,
		busy,
		hostAvailable: !!activeHostUrl,
	});

	const statusLabel = isExpired
		? "Session expired — reconnect to continue"
		: isLocalConnected
			? formatLinearLocalStatusLabel({ connection })
			: isConnecting
				? "Waiting for browser authorization…"
				: "Not connected";

	const dotClass = isActiveSource
		? "size-2 rounded-full bg-green-500"
		: isExpired
			? "size-2 rounded-full bg-amber-500"
			: isDormant
				? "size-2 rounded-full bg-muted-foreground/60"
				: isLocalConnected
					? "size-2 rounded-full bg-green-500"
					: "size-2 rounded-full bg-muted-foreground/30";

	return (
		<div>
			<div className="flex items-center justify-between gap-8 py-2 pl-11 pr-0">
				<div className="min-w-0">
					<div className="flex items-center gap-2">
						<span className="text-sm font-medium">This Mac (local)</span>
						{isActiveSource && (
							<span className="rounded border border-green-500/40 px-1.5 py-0.5 text-[10px] font-normal text-green-600 dark:text-green-400">
								Active
							</span>
						)}
						{isDormant && (
							<span className="rounded border border-border px-1.5 py-0.5 text-[10px] font-normal text-muted-foreground">
								Dormant
							</span>
						)}
					</div>
					<div className="flex items-center gap-1.5 mt-0.5">
						<span className={dotClass} />
						<span className="text-xs text-muted-foreground">{statusLabel}</span>
					</div>
					{isDormant && (
						<div className="text-xs text-muted-foreground mt-1">
							Cloud Linear is active and takes precedence; this local connection
							is dormant until you disconnect cloud Linear.
						</div>
					)}
					{cloudConnected && !isLocalConnected && (
						<div className="text-xs text-muted-foreground mt-1">
							Disconnect cloud Linear to connect this Mac.
						</div>
					)}
					{isExpired && (
						<div className="text-xs text-muted-foreground mt-1">
							Your local Linear session expired. Reconnect to keep syncing
							tickets from this Mac.
						</div>
					)}
					{error && (
						<div className="text-xs text-destructive mt-1 select-text cursor-text">
							{error}
						</div>
					)}
				</div>
				<div className="flex items-center gap-2 shrink-0">
					{isExpired ? (
						<>
							<Button
								variant="outline"
								size="sm"
								disabled={busy}
								onClick={() => refreshMutation.mutate()}
							>
								{refreshMutation.isPending ? "Refreshing…" : "Reconnect"}
							</Button>
							<Button
								variant="ghost"
								size="sm"
								disabled={busy}
								onClick={confirmDisconnect}
							>
								Disconnect
							</Button>
						</>
					) : isLocalConnected ? (
						<Button
							variant="outline"
							size="sm"
							disabled={busy}
							onClick={confirmDisconnect}
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
							disabled={connectAffordance.disabled}
							title={connectAffordance.reason ?? undefined}
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
