import { describe, expect, it } from "bun:test";
import { ticketSourceLabel } from "./ticketSourceLabel";

describe("ticketSourceLabel", () => {
	it("labels the cloud source", () => {
		expect(ticketSourceLabel("cloud")).toBe("Cloud");
	});

	it("labels the local source as 'This Mac'", () => {
		expect(ticketSourceLabel("local")).toBe("This Mac");
	});
});
