#!/usr/bin/env node
// The prettier version matrix.
//
// Installs one prettier per directory under `.compat/`, copies the plugin and
// the fixtures in beside it, and runs the whole suite against each. This is
// not ceremony: prettier only began consulting a plugin's estree printer in
// 3.7.0, and below that this plugin used to load and then do nothing at all.
// The matrix is what holds that floor — every version below it must refuse,
// every version above it must pass all the fixtures.
//
// Installs are reused when the version already sitting in a directory matches.
//
//   node scripts/compat.mjs                 every version listed below
//   node scripts/compat.mjs 3.6.2 3.7.0     just these
//   node scripts/compat.mjs --clean         throw `.compat/` away first
import { execFile } from "node:child_process";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const run = promisify(execFile);

// The latest patch of every prettier 3.x minor, plus 3.7.0 itself — the exact
// release where a plugin's estree printer began to be selected.
const VERSIONS = ["3.0.3", "3.1.1", "3.2.5", "3.3.3", "3.4.2", "3.5.3", "3.6.2", "3.7.0", "3.7.4", "3.8.5", "3.9.8"];

const root = new URL("../", import.meta.url);
const work = new URL(".compat/", root);

const args = process.argv.slice(2);
const clean = args.includes("--clean");
const versions = args.filter((arg) => !arg.startsWith("--"));

const selected = versions.length > 0 ? versions : VERSIONS;

if (clean) await rm(work, { recursive: true, force: true });

let failed = 0;

for (const version of selected) {
  const dir = new URL(`v${version}/`, work);

  await prepare(dir, version);

  let report;
  try {
    const { stdout } = await run(process.execPath, ["run.mjs"], { cwd: fileURLToPath(dir) });
    report = JSON.parse(stdout.trim().split("\n").at(-1));
  } catch (error) {
    failed += 1;
    console.log(`${pad(version)}  ERROR  ${String(error.stderr || error.message).split("\n")[0]}`);
    continue;
  }

  const shape = report.supported ? "supported" : "below the floor, must refuse";
  if (report.failures.length === 0) {
    console.log(`${pad(version)}  ok     ${report.total} ${plural(report.total)} (${shape})`);
    continue;
  }

  failed += 1;
  console.log(`${pad(version)}  FAIL   ${report.failures.length}/${report.total} (${shape})`);
  for (const failure of report.failures) {
    console.log(`           ${failure.why}: ${failure.name}`);
    if (failure.want !== undefined) console.log(`             want ${JSON.stringify(failure.want)}`);
    if (failure.got !== undefined) console.log(`             got  ${JSON.stringify(failure.got)}`);
  }
}

console.log(failed === 0 ? `\nall ${selected.length} versions behave as declared` : `\n${failed} version(s) failed`);
process.exit(failed === 0 ? 0 : 1);

/**
 * One directory per version, each holding its own prettier AND its own copy of
 * the plugin — the plugin's imports resolve from its own location, so a shared
 * copy would bind every run to the same prettier.
 */
async function prepare(dir, version) {
  await mkdir(dir, { recursive: true });
  await writeFile(new URL("package.json", dir), `{"name":"compat-${version}","private":true,"type":"module"}\n`);
  await cp(new URL("src/index.mjs", root), new URL("plugin.mjs", dir));
  await cp(new URL("test/fixtures.mjs", root), new URL("fixtures.mjs", dir));
  await cp(new URL("scripts/compat-run.mjs", root), new URL("run.mjs", dir));

  if ((await installedVersion(dir)) === version) return;

  await run("npm", ["install", "--silent", "--no-audit", "--no-fund", "--no-save", `prettier@${version}`], {
    cwd: fileURLToPath(dir),
    shell: process.platform === "win32",
  });
}

async function installedVersion(dir) {
  try {
    const manifest = await readFile(new URL("node_modules/prettier/package.json", dir), "utf8");
    return JSON.parse(manifest).version;
  } catch {
    return undefined;
  }
}

// Declarations, not `const`: the loop above runs during module evaluation.
function pad(version) {
  return version.padEnd(8);
}

function plural(count) {
  return count === 1 ? "case" : "cases";
}
