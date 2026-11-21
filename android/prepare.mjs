// Run from the repository root after npm ci && npm run build.
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
if (!fs.existsSync("dist/index.html"))
  throw Error("Build the game with npm run build before preparing Android.");
execFileSync(
  "node_modules/.bin/esbuild",
  [
    "android/host.cjs.entry.js",
    "--bundle",
    "--platform=node",
    "--target=node18",
    "--format=cjs",
    "--external:bufferutil",
    "--external:utf-8-validate",
    "--outfile=android/host.cjs",
  ],
  { stdio: "inherit" },
);
// Browser and transport checks use the real bundle without requiring the NDK.
if (process.argv.includes("--server-only")) process.exit(0);

const sdk = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT;
if (!sdk)
  throw Error(
    "Set ANDROID_HOME to your Android SDK (NDK 27.2.12479018 required).",
  );
const vendor = path.resolve("android/vendor");
fs.mkdirSync(vendor, { recursive: true });
const archive = path.join(vendor, "nodejs-mobile-v18.20.4-android.zip");
const expected =
  "bd7321eaa1a7602fbe0bb87302df2d79d87835cf4363fbdd17c350dbb485c2af";
if (!fs.existsSync(archive)) {
  execFileSync(
    "curl",
    [
      "--fail",
      "--location",
      "--retry",
      "2",
      "https://github.com/nodejs-mobile/nodejs-mobile/releases/download/v18.20.4/nodejs-mobile-v18.20.4-android.zip",
      "-o",
      archive + ".tmp",
    ],
    { stdio: "inherit" },
  );
  if (
    createHash("sha256")
      .update(fs.readFileSync(archive + ".tmp"))
      .digest("hex") !== expected
  )
    throw Error("Downloaded runtime archive checksum mismatch");
  fs.renameSync(archive + ".tmp", archive);
}
if (
  createHash("sha256").update(fs.readFileSync(archive)).digest("hex") !==
  expected
)
  throw Error("Embedded runtime archive checksum mismatch");
const runtime = path.join(vendor, "node-mobile");
if (!fs.existsSync(runtime))
  execFileSync("unzip", ["-q", archive, "-d", runtime]);
const platform =
  process.platform === "darwin" ? "darwin-x86_64" : "linux-x86_64";
const ndk = path.join(
  sdk,
  "ndk",
  "27.2.12479018",
  "toolchains",
  "llvm",
  "prebuilt",
  platform,
);
for (const [abi, triple, libdir] of [
  ["arm64-v8a", "aarch64-linux-android", "aarch64-linux-android"],
  ["armeabi-v7a", "armv7a-linux-androideabi", "arm-linux-androideabi"],
  ["x86_64", "x86_64-linux-android", "x86_64-linux-android"],
]) {
  const dest = path.resolve("android/app/src/main/jniLibs", abi);
  fs.mkdirSync(dest, { recursive: true });
  fs.copyFileSync(
    path.join(runtime, "bin", abi, "libnode.so"),
    path.join(dest, "libnode.so"),
  );
  fs.copyFileSync(
    path.join(ndk, "sysroot", "usr", "lib", libdir, "libc++_shared.so"),
    path.join(dest, "libc++_shared.so"),
  );
  execFileSync(
    path.join(ndk, "bin", triple + "26-clang++"),
    [
      "-shared",
      "-fPIC",
      "-Wl,-z,max-page-size=16384",
      "-Wl,-soname,libcrapstv-host.so",
      "android/app/src/main/cpp/host.cpp",
      "-L" + dest,
      "-lnode",
      "-o",
      path.join(dest, "libcrapstv-host.so"),
    ],
    { stdio: "inherit" },
  );
}
fs.writeFileSync(
  "android/build-info.json",
  JSON.stringify({
    revision: execFileSync("git", ["rev-parse", "HEAD"], {
      encoding: "utf8",
    }).trim(),
    runtime: "nodejs-mobile 18.20.4",
  }),
);
let notices = fs.readFileSync("LICENSE", "utf8") + "\n";
function collectNotices(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const name = path.join(dir, entry.name);
    if (entry.isDirectory()) collectNotices(name);
    else if (entry.isFile() && /^(license|copying)(\.|$)/i.test(entry.name))
      notices +=
        "\n--- " + name + " ---\n" + fs.readFileSync(name, "utf8") + "\n";
  }
}
collectNotices("node_modules");
fs.writeFileSync("android/THIRD-PARTY-NOTICES.txt", notices);
fs.mkdirSync("android/app/src/main/assets", { recursive: true });
execFileSync(
  "python3",
  [
    "-c",
    `import pathlib,zipfile
with zipfile.ZipFile('android/app/src/main/assets/payload.zip','w',zipfile.ZIP_DEFLATED) as z:
 z.write('android/host.cjs','host.cjs');z.write('android/host.html','host.html');z.write('android/build-info.json','build-info.json');z.write('android/NODE-LICENSE.txt','NODE-LICENSE.txt');z.write('android/THIRD-PARTY-NOTICES.txt','THIRD-PARTY-NOTICES.txt')
 z.write('dist/index.html','dist/index.html')
 for folder in ('assets','audio','licenses'):
  for p in pathlib.Path('dist',folder).rglob('*'):
   if p.is_file(): z.write(p,str(p))
`,
  ],
  { stdio: "inherit" },
);
console.log("Android payload and native libraries are ready.");
