import { createHash } from "node:crypto";
import { chmod, mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { unzipSync } from "fflate";

const upstreamVersion = process.env.GPROXY_RELEASE_VERSION || "v4.1.0";
const upstreamBase = `https://github.com/LeenHawk/gproxy/releases/download/${upstreamVersion}`;
const patchedBase = "https://github.com/axzhang1216/gproxy-v4-20261006-dfa2e/releases/download/gproxy-v4.1.0-cachefix";
const root = new URL(".", import.meta.url);

async function download(base, name) {
  const response = await fetch(`${base}/${name}`);
  if (!response.ok) throw new Error(`${name}: HTTP ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}

const checksumCache = new Map();
async function checksums(base) {
  if (!checksumCache.has(base)) {
    checksumCache.set(base,
      (await download(base, "SHA256SUMS")).toString().split(/\r?\n/)
        .map(line => line.trim().split(/\s+/)));
  }
  return checksumCache.get(base);
}

// Netlify currently runs this deployment on x64, so use the locally patched
// v4.1.0 serverless binary there. Keep the official arm64 artifact available
// as a fallback because build and runtime CPUs need not match.
for (const [arch, target, base] of [
  ["x64", "x86_64", patchedBase],
  ["arm64", "aarch64", upstreamBase],
]) {
  const name = `gproxy-serverless-linux-${target}-musl.zip`;
  const archive = await download(base, name);
  const expected = (await checksums(base))
    .find(([, file]) => file?.replace(/^\*/, "") === name)?.[0];
  if (!expected || createHash("sha256").update(archive).digest("hex") !== expected) {
    throw new Error(`${name}: release SHA-256 mismatch`);
  }
  const binary = unzipSync(archive)["gproxy-serverless"];
  if (!binary) throw new Error(`${name}: missing serverless executable`);
  const directory = new URL(`.gproxy/${arch}/`, root);
  await mkdir(directory, { recursive: true });
  const output = new URL("gproxy-serverless", directory);
  await writeFile(output, binary);
  await chmod(output, 0o755);
}

await mkdir(new URL("public/", root), { recursive: true });
await writeFile(new URL("public/index.html", root),
  '<!doctype html><meta charset="utf-8"><meta http-equiv="refresh" content="0;url=/console/"><a href="/console/">Open GPROXY</a>\n');
console.log(`Prepared patched GPROXY x64 plus official ${upstreamVersion} arm64 binaries in ${fileURLToPath(root)} (SHA-256 verified).`);
