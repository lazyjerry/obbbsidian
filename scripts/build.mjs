import { build } from "esbuild";
import { readFile, writeFile, readdir } from "node:fs/promises";
import path from "node:path";
const host = await build({
  entryPoints: ["src/extension.ts"],
  bundle: true,
  platform: "node",
  format: "cjs",
  external: ["vscode"],
  outfile: "out/extension.js",
  metafile: true,
});
const ui = await build({
  entryPoints: ["src/webview.ts"],
  bundle: true,
  platform: "browser",
  format: "iife",
  target: "es2022",
  minify: true,
  outfile: "media/main.js",
  metafile: true,
  loader: { ".woff": "file", ".woff2": "file", ".ttf": "file" },
  assetNames: "fonts/[name]-[hash]",
});
const roots = new Set();
for (const input of [
  ...Object.keys(host.metafile.inputs),
  ...Object.keys(ui.metafile.inputs),
]) {
  if (!input.includes("node_modules/")) continue;
  const parts = input.split("/");
  const i = parts.lastIndexOf("node_modules");
  roots.add(
    parts.slice(0, i + (parts[i + 1].startsWith("@") ? 3 : 2)).join("/"),
  );
}
let notices =
  "# Third-party notices\n\nBundled dependencies and their license files.\n";
for (const root of [...roots].sort()) {
  const pkg = JSON.parse(
    await readFile(path.join(root, "package.json"), "utf8"),
  );
  notices += `\n## ${pkg.name} ${pkg.version}\n\nLicense: ${pkg.license || "See license below"}\n`;
  const files = (await readdir(root)).filter((n) =>
    /^(licen[cs]e|copying|notice)(\.|$)/i.test(n),
  );
  for (const file of files) {
    try {
      notices +=
        "\n```text\n" +
        (await readFile(path.join(root, file), "utf8")) +
        "\n```\n";
    } catch {}
  }
}
await writeFile("THIRD_PARTY_NOTICES.md", notices);
