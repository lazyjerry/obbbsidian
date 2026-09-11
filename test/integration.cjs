const { runTests } = require("@vscode/test-electron");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
(async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "obb-host-"));
  delete process.env.ELECTRON_RUN_AS_NODE;
  try {
    await runTests({
      vscodeExecutablePath:
        "/Applications/Visual Studio Code.app/Contents/MacOS/Code",
      extensionDevelopmentPath: path.resolve("."),
      extensionTestsPath: path.resolve("test/host.cjs"),
      launchArgs: [
        "--user-data-dir",
        path.join(dir, "user"),
        "--extensions-dir",
        path.join(dir, "extensions"),
        "--disable-extensions",
        "--skip-welcome",
        "--skip-release-notes",
        "--disable-workspace-trust",
        "--disable-gpu",
      ],
    });
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
