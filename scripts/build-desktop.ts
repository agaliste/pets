import { mkdir } from "node:fs/promises";
import { join } from "node:path";

if (process.platform !== "darwin") throw new Error("The desktop overlay can only be built on macOS.");
const root = join(import.meta.dir, "..");
await mkdir(join(root, "dist"), { recursive: true });
const result = Bun.spawnSync([
  "xcrun", "swiftc", "-O", "-swift-version", "5", "-framework", "AppKit",
  join(root, "desktop/main.swift"), join(root, "desktop/Overlay.swift"), join(root, "desktop/TypingInput.swift"),
  "-o", join(root, "dist/agent-desktop-overlay"),
], { stdout: "inherit", stderr: "inherit" });
if (result.exitCode !== 0) {
  console.error("Desktop build failed. Install Apple's Command Line Tools with xcode-select --install if needed.");
  process.exit(result.exitCode || 1);
}
console.log("Built dist/agent-desktop-overlay. Start with bun run desktop.");
