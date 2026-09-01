import * as http from "node:http";
import * as net from "node:net";
import type { AddressInfo } from "node:net";

import { afterEach, describe, expect, it } from "vitest";

import { downloadFile } from "./omc-install-host.js";

const servers: Array<http.Server | net.Server> = [];

async function serve(
  handle: http.RequestListener,
): Promise<{ origin: string; address: string }> {
  const server = http.createServer(handle);
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as AddressInfo;
  return {
    origin: `http://127.0.0.1:${address.port}`,
    address: `127.0.0.1:${address.port}`,
  };
}

/** A proxy that answers CONNECT, recording what it was asked to tunnel to. */
async function serveConnectProxy(tunnelled: string[]): Promise<string> {
  const server = http.createServer();
  server.on("connect", (request, socket) => {
    tunnelled.push(request.url ?? "");
    // Answered and then dropped: the handshake the caller runs inside the
    // tunnel fails immediately rather than after a connect timeout.
    socket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
    socket.destroy();
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

/** A target that records any connection reaching it without going through a proxy. */
async function serveDirectTarget(reached: string[]): Promise<number> {
  const server = net.createServer((socket) => {
    reached.push("connected");
    socket.destroy();
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return (server.address() as AddressInfo).port;
}

afterEach(async () => {
  await Promise.all(
    servers
      .splice(0)
      .map(
        (server) =>
          new Promise<void>((resolve) => server.close(() => resolve())),
      ),
  );
});

describe("downloadFile", () => {
  it("follows the redirect a release asset is served behind", async () => {
    const { origin } = await serve((request, response) => {
      if (request.url === "/asset") {
        response.writeHead(302, { location: "/elsewhere/asset" });
        response.end();
        return;
      }
      response.writeHead(200).end("micromamba");
    });

    const bytes = await downloadFile({ url: `${origin}/asset` });

    expect(Buffer.from(bytes).toString()).toBe("micromamba");
  });

  it("stops rather than chasing a redirect loop", async () => {
    const { origin } = await serve((_request, response) => {
      response.writeHead(302, { location: "/again" }).end();
    });

    await expect(downloadFile({ url: `${origin}/again` })).rejects.toThrow(
      /redirected more than/,
    );
  });

  it("fails a response that is not the file, rather than saving the error page", async () => {
    const { origin } = await serve((_request, response) => {
      response.writeHead(404).end("no such release");
    });

    await expect(downloadFile({ url: `${origin}/missing` })).rejects.toThrow(
      /404/,
    );
  });

  it("reports progress against the length the server declared", async () => {
    const body = "0123456789";
    const { origin } = await serve((_request, response) => {
      response.writeHead(200, { "content-length": String(body.length) });
      response.end(body);
    });
    const seen: Array<number | undefined> = [];

    await downloadFile({
      url: `${origin}/asset`,
      onProgress: (_received, total) => seen.push(total),
    });

    expect(seen.length).toBeGreaterThan(0);
    expect(seen.every((total) => total === body.length)).toBe(true);
  });

  it("claims no total when the server streamed without one", async () => {
    const { origin } = await serve((_request, response) => {
      response.writeHead(200, { "transfer-encoding": "chunked" });
      response.end("bytes");
    });
    const seen: Array<number | undefined> = [];

    await downloadFile({
      url: `${origin}/asset`,
      onProgress: (_received, total) => seen.push(total),
    });

    expect(seen).not.toHaveLength(0);
    expect(seen.every((total) => total === undefined)).toBe(true);
  });

  it("asks the proxy for the whole URL when one is configured", async () => {
    const asked: string[] = [];
    const { origin: proxy } = await serve((request, response) => {
      asked.push(request.url ?? "");
      response.writeHead(200).end("through the proxy");
    });

    const bytes = await downloadFile({
      url: "http://example.invalid/asset",
      proxy,
    });

    expect(asked).toEqual(["http://example.invalid/asset"]);
    expect(Buffer.from(bytes).toString()).toBe("through the proxy");
  });

  it("carries the credentials a proxy URL was given", async () => {
    const seen: Array<string | undefined> = [];
    const { address } = await serve((request, response) => {
      seen.push(request.headers["proxy-authorization"]);
      response.writeHead(200).end("authorised");
    });

    await downloadFile({
      url: "http://example.invalid/asset",
      proxy: `http://user:pa%3Ass@${address}`,
    });

    expect(seen).toEqual([
      `Basic ${Buffer.from("user:pa:ss").toString("base64")}`,
    ]);
  });

  it("tunnels an https URL through the proxy instead of reaching the host itself", async () => {
    const tunnelled: string[] = [];
    const reached: string[] = [];
    const proxy = await serveConnectProxy(tunnelled);
    const port = await serveDirectTarget(reached);

    await expect(
      downloadFile({ url: `https://127.0.0.1:${port}/asset`, proxy }),
    ).rejects.toThrow();

    expect(tunnelled).toEqual([`127.0.0.1:${port}`]);
    expect(reached).toEqual([]);
  });

  it("raises an unusable proxy rather than silently going direct", async () => {
    await expect(
      downloadFile({
        url: "http://example.invalid/asset",
        proxy: "::: not a url",
      }),
    ).rejects.toThrow(/http\.proxy/);
  });
});
