import { build } from "esbuild";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const folder = await mkdtemp(join(tmpdir(), "skillswap-checks-"));
try {
  const outfile = join(folder, "community.mjs");
  await build({ entryPoints: ["scripts/test-community.ts"], bundle: true, platform: "node", format: "esm", outfile, alias: { "@": resolve("src") } });
  const result = spawnSync(process.execPath, ["--test", outfile], { stdio: "inherit", timeout: 120000 });
  process.exitCode = result.status ?? 1;
} finally {
  await rm(folder, { recursive: true, force: true });
}