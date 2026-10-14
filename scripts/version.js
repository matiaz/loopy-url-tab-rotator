const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const packageJson = require(path.join(ROOT, "package.json"));
const version = packageJson.version;

const MANIFEST_FILES = [
  path.join(ROOT, "src/manifest.chrome.json"),
  path.join(ROOT, "src/manifest.firefox.json")
];

for (const manifestPath of MANIFEST_FILES) {
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  const oldVersion = manifest.version;
  manifest.version = version;
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
  const name = path.basename(manifestPath);
  if (oldVersion !== version) {
    console.log(`${name}: ${oldVersion} → ${version}`);
  } else {
    console.log(`${name}: ${version} (unchanged)`);
  }
}
