const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const SRC = path.join(ROOT, "src");
const DIST = path.join(ROOT, "dist");
const VERSION = require(path.join(ROOT, "package.json")).version;

const MANIFEST_MAP = {
  chrome: "manifest.chrome.json",
  firefox: "manifest.firefox.json",
  edge: "manifest.chrome.json",
  opera: "manifest.chrome.json",
  safari: "manifest.chrome.json"
};

const ALL_TARGETS = Object.keys(MANIFEST_MAP);

const FIREFOX_ONLY = ["content"];
const OFFSCREEN_FILES = ["background/offscreen.html", "background/offscreen.js"];
const NO_OFFSCREEN_TARGETS = ["firefox", "safari"];
const IGNORED_FILES = [".DS_Store"];

function canBuildSafari() {
  if (process.platform !== "darwin") return false;
  try {
    execFileSync("xcrun", ["--find", "safari-web-extension-converter"], { stdio: "ignore" });
    return true;
  } catch (e) {
    return false;
  }
}

function resolveTargets() {
  const requested = process.argv[2];
  if (requested) {
    if (!ALL_TARGETS.includes(requested)) {
      console.error(`Unknown target: ${requested}`);
      process.exit(1);
    }
    if (requested === "safari" && !canBuildSafari()) {
      console.error("Safari builds need macOS with Xcode (xcrun safari-web-extension-converter).");
      process.exit(1);
    }
    return [requested];
  }
  if (canBuildSafari()) return ALL_TARGETS;
  console.log("Skipping safari: needs macOS with Xcode (xcrun safari-web-extension-converter).");
  return ALL_TARGETS.filter((target) => target !== "safari");
}

function shouldExclude(target, entryName, relativePath) {
  if (IGNORED_FILES.includes(entryName)) return true;
  if (target !== "firefox" && FIREFOX_ONLY.includes(entryName)) return true;
  if (NO_OFFSCREEN_TARGETS.includes(target) && OFFSCREEN_FILES.includes(relativePath)) return true;
  return false;
}

function writeManifest(target, manifestDest) {
  const manifest = JSON.parse(fs.readFileSync(path.join(SRC, MANIFEST_MAP[target]), "utf8"));
  if (target === "safari") {
    manifest.permissions = manifest.permissions.filter((permission) => permission !== "offscreen");
  }
  fs.writeFileSync(manifestDest, JSON.stringify(manifest, null, 2) + "\n");
}

function copyDir(src, dest, target, relBase) {
  fs.mkdirSync(dest, { recursive: true });
  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    const relPath = relBase ? `${relBase}/${entry.name}` : entry.name;
    if (shouldExclude(target, entry.name, relPath)) continue;
    if (entry.isDirectory()) {
      copyDir(srcPath, destPath, target, relPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

function build(target) {
  const targetDist = path.join(DIST, target);

  if (fs.existsSync(targetDist)) {
    fs.rmSync(targetDist, { recursive: true });
  }

  fs.mkdirSync(targetDist, { recursive: true });

  const entries = fs.readdirSync(SRC, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name.startsWith("manifest.")) continue;
    const srcPath = path.join(SRC, entry.name);
    const destPath = path.join(targetDist, entry.name);
    if (shouldExclude(target, entry.name, entry.name)) continue;
    if (entry.isDirectory()) {
      copyDir(srcPath, destPath, target, entry.name);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }

  writeManifest(target, path.join(targetDist, "manifest.json"));

  console.log(`Built ${target} → dist/${target}/`);
}

const SAFARI_APP_NAME = "Loopy URL Tab Rotator";
const SAFARI_BUNDLE_ID = "com.bhz.url-tab-rotator";

function patchSafariProject(xcodeOut) {
  const pbxproj = path.join(
    xcodeOut,
    SAFARI_APP_NAME,
    `${SAFARI_APP_NAME}.xcodeproj`,
    "project.pbxproj"
  );

  const original = fs.readFileSync(pbxproj, "utf8");
  const patched = original
    .replace(
      /PRODUCT_BUNDLE_IDENTIFIER = "([^"]*)";/g,
      (match, id) =>
        id.endsWith(".Extension")
          ? match
          : `PRODUCT_BUNDLE_IDENTIFIER = "${SAFARI_BUNDLE_ID}";`
    )
    .replace(/MARKETING_VERSION = [^;]*;/g, `MARKETING_VERSION = ${VERSION};`)
    .replace(
      /CURRENT_PROJECT_VERSION = [^;]*;/g,
      `CURRENT_PROJECT_VERSION = ${VERSION};`
    );

  if (patched !== original) {
    fs.writeFileSync(pbxproj, patched);
    console.log(
      `Patched Xcode project → bundle id ${SAFARI_BUNDLE_ID}, version ${VERSION}`
    );
  }
}

function buildSafariXcode() {
  const safariDist = path.join(DIST, "safari");
  const xcodeOut = path.join(DIST, "safari-xcode");

  if (fs.existsSync(xcodeOut)) {
    fs.rmSync(xcodeOut, { recursive: true });
  }

  execFileSync(
    "xcrun",
    [
      "safari-web-extension-converter",
      safariDist,
      "--project-location", xcodeOut,
      "--app-name", SAFARI_APP_NAME,
      "--bundle-identifier", SAFARI_BUNDLE_ID,
      "--swift",
      "--macos-only",
      "--copy-resources",
      "--no-open",
      "--no-prompt",
      "--force"
    ],
    { stdio: "inherit" }
  );

  patchSafariProject(xcodeOut);

  console.log("Built safari-xcode → dist/safari-xcode/");
}

const targets = resolveTargets();

for (const target of targets) {
  build(target);
}

if (targets.includes("safari")) {
  buildSafariXcode();
}

console.log("Done.");
