// The fixtures are the specification. Each one is asserted twice: the output
// prettier produces, and that a second format over that output changes
// nothing — idempotence is the property most likely to break, and the one a
// formatter is least forgiven for.
import assert from "node:assert/strict";
import test, { describe } from "node:test";
import { fileURLToPath } from "node:url";
import { format } from "prettier";

import { FIXTURES } from "./fixtures.mjs";
import plugin, { options as pluginOptions, printers } from "../src/index.mjs";

const PLUGIN = fileURLToPath(new URL("../src/index.mjs", import.meta.url));

const optionsFor = (fixture) => ({
  parser: "typescript",
  plugins: [PLUGIN],
  printWidth: 100,
  ...fixture.options,
});

describe("fixtures", () => {
  for (const fixture of FIXTURES) {
    test(fixture.name, async () => {
      const options = optionsFor(fixture);

      const once = await format(fixture.input, options);
      assert.equal(once, fixture.output);

      const twice = await format(once, options);
      assert.equal(twice, once, "a second format changed the output");
    });
  }
});

describe("the plugin's shape", () => {
  test("declares the three options prettier will read", () => {
    assert.deepEqual(Object.keys(pluginOptions).sort(), [
      "alignObjectValues",
      "alignObjectValuesIn",
      "preserveTrailingCommentGap",
    ]);

    assert.equal(pluginOptions.alignObjectValues.default, "preserve");
    assert.deepEqual(
      pluginOptions.alignObjectValues.choices.map((choice) => choice.value),
      ["preserve", "always", "never"],
    );

    // The array shape prettier's CLI needs, copied from
    // prettier-plugin-tailwindcss's `tailwindFunctions`.
    assert.equal(pluginOptions.alignObjectValuesIn.array, true);
    assert.deepEqual(pluginOptions.alignObjectValuesIn.default, [{ value: [] }]);

    assert.equal(pluginOptions.preserveTrailingCommentGap.default, true);
  });

  test("overrides the estree printer and nothing else", () => {
    assert.deepEqual(Object.keys(printers), ["estree"]);
    assert.equal(typeof printers.estree.print, "function");
    assert.equal(typeof printers.estree.printComment, "function");
  });

  test("the default export carries both, for `plugins: [require(…)]`", () => {
    assert.equal(plugin.options, pluginOptions);
    assert.equal(plugin.printers, printers);
  });
});

describe("prettier sees the options", () => {
  test("getSupportInfo lists them once the plugin is loaded", async () => {
    const { getSupportInfo } = await import("prettier");
    const info = await getSupportInfo({ plugins: [PLUGIN] });
    const names = info.options.map((option) => option.name);

    for (const name of Object.keys(pluginOptions)) {
      assert.ok(names.includes(name), `${name} is missing from getSupportInfo`);
    }
  });
});
