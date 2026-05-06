#!/usr/bin/env node
/**
 * One-off capture script. Spawns OMC, asks for `getModelInstance` /
 * `getModelInstanceAnnotation` against a small leaf block and a full diagram
 * model, and writes the raw JSON trees to `test/fixtures/`. Those fixtures
 * drive the offline schema unit tests and serve as a regression marker if
 * OMC ever changes the shape.
 *
 * Run from the package root:
 *
 *     node scripts/capture-modelinstance-fixtures.mjs
 */

import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { tmpdir, userInfo } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { Request } from "zeromq";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = resolve(__dirname, "..");
const FIXTURES_DIR = join(PKG_ROOT, "test", "fixtures");

const PORT_FILE_TIMEOUT_MS = 30_000;
const CALL_TIMEOUT_MS = 120_000;

function portFilePath(suffix) {
  const name = `openmodelica.${userInfo().username}.port.${suffix}`;
  return join(tmpdir(), name);
}

async function waitForPortFile(path, signal) {
  const start = Date.now();
  while (Date.now() - start < PORT_FILE_TIMEOUT_MS) {
    if (signal?.aborted) throw new Error("aborted");
    try {
      const buf = await readFile(path, "utf8");
      const trimmed = buf.trim();
      if (trimmed.length > 0) return trimmed;
    } catch {
      /* not ready */
    }
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error(`OMC port file did not appear at ${path}`);
}

async function spawnOmc() {
  const suffix = `mwcap_${randomBytes(8).toString("hex")}`;
  const file = portFilePath(suffix);
  try {
    await unlink(file);
  } catch {
    /* not present */
  }
  const child = spawn("omc", ["--interactive=zmq", `-z=${suffix}`], {
    stdio: ["ignore", "ignore", "inherit"],
  });
  const endpoint = await waitForPortFile(file);
  return {
    endpoint,
    async stop() {
      try {
        child.kill("SIGTERM");
      } catch {
        /* already dead */
      }
      try {
        await unlink(file);
      } catch {
        /* gone */
      }
    },
  };
}

async function call(sock, cmd) {
  await sock.send(cmd);
  const op = sock.receive().then(([reply]) => reply.toString("utf8"));
  let timer;
  const timeoutErr = new Promise((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`omc call timed out: ${cmd.slice(0, 80)}`)),
      CALL_TIMEOUT_MS,
    );
  });
  try {
    return await Promise.race([op, timeoutErr]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Strip a Modelica string literal: `"...escaped..."` → the JS string it
 * represents. OMC's getModelInstance returns its JSON wrapped in such a
 * literal. Handles the standard escape sequences.
 */
function unwrapModelicaString(raw) {
  const text = raw.trim();
  if (!text.startsWith("\"")) {
    throw new Error(
      `expected a Modelica string literal, got: ${text.slice(0, 80)}…`,
    );
  }
  let out = "";
  for (let i = 1; i < text.length; i++) {
    const c = text[i];
    if (c === "\"") return out;
    if (c === "\\" && i + 1 < text.length) {
      const n = text[i + 1];
      switch (n) {
        case "\"":
        case "\\":
        case "'":
          out += n;
          break;
        case "n":
          out += "\n";
          break;
        case "t":
          out += "\t";
          break;
        case "r":
          out += "\r";
          break;
        case "a":
          out += "\x07";
          break;
        case "b":
          out += "\b";
          break;
        case "f":
          out += "\f";
          break;
        case "v":
          out += "\v";
          break;
        case "0":
          out += "\0";
          break;
        default:
          out += "\\" + n;
      }
      i++;
      continue;
    }
    out += c;
  }
  throw new Error("unterminated string literal in OMC reply");
}

async function captureOne(sock, cmd, fixtureName) {
  const raw = await call(sock, cmd);
  const json = unwrapModelicaString(raw);
  const obj = JSON.parse(json);
  const dest = join(FIXTURES_DIR, fixtureName);
  await writeFile(dest, JSON.stringify(obj, null, 2) + "\n", "utf8");
  console.log(
    `wrote ${fixtureName}: ${(JSON.stringify(obj).length / 1024).toFixed(1)} KB compact, ${Object.keys(obj).join(", ")}`,
  );
}

async function main() {
  await mkdir(FIXTURES_DIR, { recursive: true });
  const proc = await spawnOmc();
  const sock = new Request();
  sock.linger = 200;
  sock.connect(proc.endpoint);
  try {
    const ver = await call(sock, "getVersion()");
    console.log(`OMC version reply: ${ver.trim()}`);

    const loaded = await call(sock, "loadModel(Modelica)");
    if (loaded.trim() !== "true") {
      const err = await call(sock, "getErrorString()");
      throw new Error(`loadModel(Modelica) failed: ${err}`);
    }

    await captureOne(
      sock,
      "getModelInstance(Modelica.Blocks.Math.Sin)",
      "sin.modelInstance.json",
    );
    await captureOne(
      sock,
      "getModelInstance(Modelica.Blocks.Examples.PID_Controller)",
      "pidController.modelInstance.json",
    );
    await captureOne(
      sock,
      "getModelInstanceAnnotation(Modelica.Blocks.Math.Sin)",
      "sin.modelInstanceAnnotation.json",
    );

    try {
      await call(sock, "quit()");
    } catch {
      /* OMC closes the socket before replying */
    }
  } finally {
    sock.close();
    await proc.stop();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
