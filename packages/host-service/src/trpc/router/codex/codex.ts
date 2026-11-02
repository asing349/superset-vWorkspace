import { protectedProcedure, router } from "../../index";

export const codexRouter = router({
	status: protectedProcedure.query(({ ctx }) => ctx.runtime.codex.status()),
	startConnect: protectedProcedure.mutation(({ ctx }) =>
		ctx.runtime.codex.start(),
	),
	cancelConnect: protectedProcedure.mutation(({ ctx }) =>
		ctx.runtime.codex.cancel(),
	),
	disconnect: protectedProcedure.mutation(({ ctx }) =>
		ctx.runtime.codex.disconnect(),
	),
});
