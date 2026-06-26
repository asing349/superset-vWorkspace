import { z } from "zod";
import { protectedProcedure, router } from "../../index";

// Wave-7 M1 — host-local Linear connection (`linear.auth.*`). Mirrors the
// host-side Anthropic/OpenAI OAuth routers: every procedure proxies to the
// long-lived `LinearAuthService` on the runtime, which owns the PKCE flow,
// the cloud-precedence gate, and the encrypted host-local token store. No
// procedure here ever returns token material.

const completeConnectInput = z.object({
	code: z.string().min(1),
});

const authRouter = router({
	getConnection: protectedProcedure.query(({ ctx }) => {
		return ctx.runtime.linearAuth.getConnection();
	}),
	startConnect: protectedProcedure.mutation(({ ctx }) => {
		return ctx.runtime.linearAuth.startConnect();
	}),
	consumeCallback: protectedProcedure.query(({ ctx }) => {
		return ctx.runtime.linearAuth.consumeCallback();
	}),
	completeConnect: protectedProcedure
		.input(completeConnectInput)
		.mutation(({ ctx, input }) => {
			return ctx.runtime.linearAuth.completeConnect({ code: input.code });
		}),
	cancelConnect: protectedProcedure.mutation(({ ctx }) => {
		return ctx.runtime.linearAuth.cancelConnect();
	}),
	disconnect: protectedProcedure.mutation(({ ctx }) => {
		return ctx.runtime.linearAuth.disconnect();
	}),
	refresh: protectedProcedure.mutation(({ ctx }) => {
		return ctx.runtime.linearAuth.refresh();
	}),
});

export const linearRouter = router({
	auth: authRouter,
});
