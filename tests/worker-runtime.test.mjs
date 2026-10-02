import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:net";
import { readFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const formats = ["pdf", "doc", "docx", "ppt", "pptx", "xls", "xlsx", "odt", "odp", "ods", "odg", "rtf", "csv", "txt", "md", "html", "htm", "epub", "tex", "ltx"];

async function freePort() {
  const server = createServer();
  await new Promise((resolveListen, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolveListen);
  });
  const port = server.address().port;
  await new Promise(resolveClose => server.close(resolveClose));
  return port;
}

async function waitForReady(child, url, readLogs) {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Wrangler exited before Workerd was ready.\n${readLogs()}`);
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(2_000) });
      if (response.ok) return;
    } catch {}
    await sleep(300);
  }
  throw new Error(`Timed out waiting for Workerd.\n${readLogs()}`);
}

function stopChild(child) {
  if (child.exitCode !== null) return Promise.resolve();
  return new Promise(resolveExit => {
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      resolveExit();
    }, 5_000);
    timer.unref();
    child.once("exit", () => {
      clearTimeout(timer);
      resolveExit();
    });
    child.kill("SIGTERM");
  });
}

test("all supported document formats extract under Cloudflare Workerd", async () => {
  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;
  const wrangler = resolve(root, "node_modules/.bin/wrangler");
  const child = spawn(wrangler, [
    "dev", "--local", "--ip", "127.0.0.1", "--port", String(port),
    "--config", "tests/worker-runtime.wrangler.jsonc", "--log-level", "error"
  ], {
    cwd: root,
    env: { ...process.env, WRANGLER_SEND_METRICS: "false" },
    stdio: ["ignore", "pipe", "pipe"]
  });
  let logs = "";
  const appendLog = chunk => { logs = (logs + chunk.toString()).slice(-8_000); };
  child.stdout.on("data", appendLog);
  child.stderr.on("data", appendLog);

  try {
    await waitForReady(child, `${base}/health`, () => logs);
    for (const extension of formats) {
      const fileName = `sample.${extension}`;
      const bytes = readFileSync(new URL(`./fixtures/${fileName}`, import.meta.url));
      const response = await fetch(`${base}/parse?name=${encodeURIComponent(fileName)}`, {
        method: "POST",
        headers: { "Content-Type": "application/octet-stream" },
        body: bytes,
        signal: AbortSignal.timeout(45_000)
      });
      const result = await response.json();
      assert.equal(response.status, 200, `${fileName}: ${result.error || "Workerd extraction failed"}\n${logs}`);
      assert.equal(result.ok, true, `${fileName}: ${result.error || "parser returned not-ok"}`);
      assert.match(result.text, /Academic integrity/i, `${fileName} should yield readable text`);
    }
  } finally {
    await stopChild(child);
  }
});
