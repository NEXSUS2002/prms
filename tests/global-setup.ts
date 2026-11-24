// Starts a private Hardhat chain on port 8546 for the test run and stops it afterwards.
import { spawn, type ChildProcess } from "node:child_process";

let node: ChildProcess | undefined;

async function rpcUp(url: string) {
  try {
    const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [] }) });
    return r.ok;
  } catch {
    return false;
  }
}

export async function setup() {
  const url = "http://127.0.0.1:8546";
  const windows = process.platform === "win32";
  node = spawn("npx", ["hardhat", "node", "--port", "8546"], { stdio: "ignore", detached: !windows, shell: windows });
  for (let i = 0; i < 120; i++) {
    if (await rpcUp(url)) return;
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error("The test blockchain did not start.");
}

export async function teardown() {
  if (node?.pid) {
    try {
      if (process.platform === "win32") spawn("taskkill", ["/pid", String(node.pid), "/T", "/F"], { stdio: "ignore" });
      else process.kill(-node.pid);
    } catch {
      /* already stopped */
    }
  }
}
