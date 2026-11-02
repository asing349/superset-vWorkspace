import assert from "node:assert/strict";
import { once } from "node:events";
import { createRequire } from "node:module";
import { createServer } from "node:net";
import { text } from "node:stream/consumers";
import test from "node:test";

// Exercise the actual transitive consumer through Bun's shared dependency index.
// The fixture server only listens on loopback; no real FTP account is involved.
test(
	"get-uri works with the patched FTP client",
	{ timeout: 15000 },
	async (t) => {
		const sharedRequire = createRequire(
			new URL(
				"../../../../node_modules/.bun/node_modules/package.json",
				import.meta.url,
			),
		);
		const { getUri } = sharedRequire("get-uri");
		const consumerRequire = createRequire(sharedRequire.resolve("get-uri"));
		assert.match(consumerRequire("basic-ftp/package.json").version, /^6\./);
		const commands = [];
		const sockets = new Set();
		const passiveServers = new Set();
		let forceList = false;
		const payload = "fixture payload";
		const server = createServer((socket) => {
			sockets.add(socket);
			socket.on("close", () => sockets.delete(socket));
			socket.setTimeout(4000, () => socket.destroy());
			socket.write("220 Local fixture ready\r\n");
			let buffer = "";
			let passive;
			async function transfer(data) {
				assert.ok(passive);
				socket.write("150 Opening data connection\r\n");
				const [dataSocket] = await passive.connection;
				dataSocket.end(data, () => {
					socket.write("226 Transfer complete\r\n");
					passive.server.close();
				});
			}
			socket.on("data", async (chunk) => {
				buffer += chunk;
				while (buffer.includes("\r\n")) {
					const index = buffer.indexOf("\r\n");
					const line = buffer.slice(0, index);
					buffer = buffer.slice(index + 2);
					commands.push(line);
					const command = line.split(" ")[0].toUpperCase();
					try {
						if (command === "USER") socket.write("331 Password required\r\n");
						else if (command === "PASS") socket.write("230 Logged in\r\n");
						else if (command === "FEAT")
							socket.write(
								"211-Features\r\n UTF8\r\n EPSV\r\n MDTM\r\n MLST type*;size*;modify*;\r\n211 End\r\n",
							);
						else if (["OPTS", "TYPE", "STRU", "MODE"].includes(command))
							socket.write("200 OK\r\n");
						else if (command === "MDTM")
							socket.write(
								forceList ? "500 Unsupported\r\n" : "213 20260101000000\r\n",
							);
						else if (command === "SIZE")
							socket.write(`213 ${payload.length}\r\n`);
						else if (command === "PWD") socket.write('257 "/"\r\n');
						else if (command === "CWD")
							socket.write("250 Directory changed\r\n");
						else if (command === "EPSV" || command === "PASV") {
							const dataServer = createServer();
							passiveServers.add(dataServer);
							const connection = once(dataServer, "connection");
							dataServer.listen(0, "127.0.0.1");
							await once(dataServer, "listening");
							const port = dataServer.address().port;
							passive = { server: dataServer, connection };
							socket.write(
								command === "EPSV"
									? `229 Entering Extended Passive Mode (|||${port}|)\r\n`
									: `227 Entering Passive Mode (127,0,0,1,${port >> 8},${port & 255})\r\n`,
							);
						} else if (command === "RETR") await transfer(payload);
						else if (command === "MLSD")
							await transfer(
								`type=file;size=${payload.length};modify=20260101000000; test.txt\r\n`,
							);
						else if (command === "LIST")
							await transfer(
								`-rw-r--r-- 1 user group ${payload.length} Jan 01 2026 test.txt\r\n`,
							);
						else if (command === "QUIT") socket.end("221 Bye\r\n");
						else socket.write("502 Unsupported command\r\n");
					} catch (error) {
						socket.destroy(error);
					}
				}
			});
			socket.on("error", () => {});
		});
		server.listen(0, "127.0.0.1");
		await once(server, "listening");
		t.after(async () => {
			for (const socket of sockets) socket.destroy();
			for (const passive of passiveServers)
				if (passive.listening) passive.close();
			await new Promise((resolve) => server.close(resolve));
		});
		const base = `ftp://fixture:password@127.0.0.1:${server.address().port}`;
		await t.test(
			"downloads a file and retains modification-date caching",
			async () => {
				const stream = await getUri(`${base}/test.txt`);
				assert.equal(await text(stream), payload);
				await assert.rejects(
					getUri(`${base}/test.txt`, { cache: stream }),
					(error) => error.code === "ENOTMODIFIED",
				);
			},
		);
		await t.test(
			"preserves directory-listing fallback when MDTM is unavailable",
			async () => {
				forceList = true;
				const stream = await getUri(`${base}/test.txt`);
				assert.equal(await text(stream), payload);
				assert.ok(commands.some((command) => command.startsWith("MLSD")));
				forceList = false;
			},
		);
		await t.test(
			"rejects CRLF credentials before they become FTP commands",
			async () => {
				const url = `ftp://bad%0d%0aDELE%20file:password@127.0.0.1:${server.address().port}/test.txt`;
				await assert.rejects(getUri(url));
				assert.ok(!commands.some((command) => command.startsWith("DELE")));
			},
		);
	},
);
