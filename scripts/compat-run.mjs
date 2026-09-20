// Runs the whole fixture suite against ONE installed prettier.
//
// `scripts/compat.mjs` copies this file, `fixtures.mjs` and the plugin into a
// directory that has its own `node_modules/prettier`, then runs it there. The
// copying is the point: the plugin's own `import "prettier/plugins/estree.js"`
// resolves from the plugin file's location, not from the prettier that is
// running it, so a plugin left in the repo would always bind to the repo's
// prettier no matter which one is under test.
//
// Prints one JSON line on stdout so the driver can read it.
import { fileURLToPath } from "node:url";
import { format, version } from "prettier";

import { FIXTURES } from "./fixtures.mjs";

const PLUGIN = fileURLToPath(new URL("./plugin.mjs", import.meta.url));
const MINIMUM = [3, 7];

const [major, minor] = version.split(".", 2).map(Number);
const supported = major > MINIMUM[0] || (major === MINIMUM[0] && minor >= MINIMUM[1]);

const failures = supported ? await runFixtures() : await expectRefusal();

console.log(JSON.stringify({ version, supported, total: supported ? FIXTURES.length : 1, failures }));

async function runFixtures() {
  const failures = [];

  for (const fixture of FIXTURES) {
    const options = { parser: "typescript", plugins: [PLUGIN], printWidth: 100, ...fixture.options };
    try {
      const once = await format(fixture.input, options);
      if (once !== fixture.output) {
        failures.push({ name: fixture.name, why: "wrong output", got: once, want: fixture.output });
        continue;
      }

      const twice = await format(once, options);
      if (twice !== once) failures.push({ name: fixture.name, why: "not idempotent", got: twice, want: once });
    } catch (error) {
      failures.push({ name: fixture.name, why: "threw", got: firstLine(error) });
    }
  }

  return failures;
}

/**
 * Below the floor the plugin must refuse, loudly, naming the version it found.
 * Silence here is the failure this matrix exists to catch: before 3.7 the
 * plugin loads, its printer is never selected, and every object comes back
 * unaligned with nothing to say why.
 */
async function expectRefusal() {
  const name = "refuses to run, naming the version";

  try {
    await format("const x = {\n  a:  1,\n  bbbb: 2,\n};\n", { parser: "typescript", plugins: [PLUGIN] });
  } catch (error) {
    const message = error?.message ?? "";
    if (!message.includes(version)) {
      return [{ name, why: "threw without naming the version", got: firstLine(error) }];
    }
    return [];
  }

  return [{ name, why: "formatted silently instead of refusing", got: "" }];
}

// A declaration, not a `const`: the work above runs during module evaluation.
function firstLine(error) {
  return String(error?.message ?? error).split("\n")[0];
}
