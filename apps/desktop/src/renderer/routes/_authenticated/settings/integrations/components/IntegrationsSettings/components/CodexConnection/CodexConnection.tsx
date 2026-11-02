import { alert } from "@superset/ui/atoms/Alert";
import { Button } from "@superset/ui/button";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { getHostServiceClientByUrl } from "renderer/lib/host-service-client";
import { electronTrpcClient } from "renderer/lib/trpc-client";
import { useLocalHostService } from "renderer/routes/_authenticated/providers/LocalHostServiceProvider";

export function CodexConnection() {
	const { activeHostUrl } = useLocalHostService();
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const status = useQuery({
		queryKey: ["codex-cli-account", activeHostUrl],
		enabled: !!activeHostUrl,
		refetchInterval: (query) => (query.state.data?.pending ? 1500 : false),
		retry: false,
		queryFn: () => {
			if (!activeHostUrl) throw new Error("Host service is unavailable");
			return getHostServiceClientByUrl(activeHostUrl).codex.status.query();
		},
	});
	async function act(action: "connect" | "cancel" | "disconnect") {
		if (!activeHostUrl) return;
		setBusy(true);
		setError(null);
		const client = getHostServiceClientByUrl(activeHostUrl).codex;
		try {
			if (action === "connect") {
				const { authUrl } = await client.startConnect.mutate();
				try {
					await electronTrpcClient.external.openUrl.mutate(authUrl);
				} catch (failure) {
					await client.cancelConnect.mutate();
					throw failure;
				}
			} else if (action === "cancel") await client.cancelConnect.mutate();
			else await client.disconnect.mutate();
		} catch (failure) {
			setError(
				failure instanceof Error ? failure.message : "Codex connection failed",
			);
		} finally {
			setBusy(false);
			await status.refetch();
		}
	}
	const account = status.data;
	return (
		<section
			aria-label="Codex account"
			className="rounded-lg border p-4 my-3 space-y-2"
		>
			<h3 className="font-medium">Codex · ChatGPT account</h3>
			<p className="text-sm text-muted-foreground">
				Connect your ChatGPT account to run Codex coding agents and independent
				plan reviews on this Mac. Sign-in uses the installed Codex CLI and
				shares its account. Superset does not receive your password or tokens.
			</p>
			<p className="text-sm" aria-live="polite">
				{account?.pending
					? "Waiting for browser sign-in…"
					: account?.authMethod === "chatgpt"
						? `Connected with ChatGPT${account.email ? ` · ${account.email}` : ""}${account.planType ? ` · ${account.planType}` : ""}`
						: account?.authMethod === "apiKey"
							? "Codex currently uses an API key (usage-based billing). Connect ChatGPT to use subscription access instead."
							: account?.connected
								? "Codex uses another provider. Connect ChatGPT for subscription access."
								: "ChatGPT account is not connected to Codex."}
			</p>
			<div className="flex gap-2">
				{account?.pending ? (
					<Button
						size="sm"
						variant="outline"
						disabled={busy}
						onClick={() => {
							void act("cancel");
						}}
					>
						Cancel sign-in
					</Button>
				) : (
					<Button
						size="sm"
						disabled={
							!activeHostUrl || busy || account?.authMethod === "chatgpt"
						}
						onClick={() => {
							void act("connect");
						}}
					>
						{busy ? "Opening sign-in…" : "Connect ChatGPT to Codex"}
					</Button>
				)}
				<Button
					size="sm"
					variant="ghost"
					disabled={!activeHostUrl || busy}
					onClick={() => {
						void status.refetch();
					}}
				>
					Refresh status
				</Button>
				{account?.connected && (
					<Button
						size="sm"
						variant="ghost"
						disabled={busy}
						onClick={() =>
							alert({
								title: "Disconnect Codex on this Mac?",
								description:
									"This signs out the shared Codex CLI account too. It does not disconnect Superset's separate OpenAI model login.",
								actions: [
									{
										label: "Disconnect",
										variant: "destructive",
										onClick: () => {
											void act("disconnect");
										},
									},
									{ label: "Cancel", variant: "ghost" },
								],
							})
						}
					>
						Disconnect
					</Button>
				)}
			</div>
			{(error || account?.error || status.error) && (
				<p
					role="alert"
					className="text-sm text-destructive select-text cursor-text"
				>
					{error ?? account?.error ?? status.error?.message}
				</p>
			)}
			{!activeHostUrl && (
				<p className="text-sm text-muted-foreground">
					Start the local Superset host to connect.
				</p>
			)}
		</section>
	);
}
