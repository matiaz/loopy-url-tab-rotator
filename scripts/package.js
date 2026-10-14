const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const DIST = path.join(ROOT, "dist");
const PACKAGES = path.join(ROOT, "packages");
const version = require(path.join(ROOT, "package.json")).version;

const BROWSERS = ["chrome", "firefox", "edge", "opera"];

function ensureZip() {
  try {
    execFileSync("zip", ["-v"], { stdio: "ignore" });
  } catch (e) {
    console.error("The zip command is required to package the extension.");
    process.exit(1);
  }
}

function packageTarget(target) {
  const distDir = path.join(DIST, target);
  if (!fs.existsSync(path.join(distDir, "manifest.json"))) {
    console.error(`dist/${target}/manifest.json not found. Run "npm run build:${target}" first.`);
    process.exit(1);
  }

  const filename = `loopy-${target}-${version}.zip`;
  const outputPath = path.join(PACKAGES, filename);
  fs.rmSync(outputPath, { force: true });

  execFileSync(
    "zip",
    ["-r", "-X", "-q", outputPath, ".", "-x", "*.DS_Store", "__MACOSX/*", "*/__MACOSX/*"],
    { cwd: distDir, stdio: "inherit" }
  );

  console.log(`Packaged ${target} → packages/${filename}`);
}

const requested = process.argv[2];
if (requested && !BROWSERS.includes(requested)) {
  console.error(`Unknown target: ${requested}`);
  process.exit(1);
}

ensureZip();
fs.mkdirSync(PACKAGES, { recursive: true });

for (const target of requested ? [requested] : BROWSERS) {
  packageTarget(target);
}

console.log("Done.");
