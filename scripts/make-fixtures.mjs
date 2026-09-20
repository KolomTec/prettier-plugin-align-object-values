#!/usr/bin/env node
// Regenerates test/fixtures.mjs: every behaviour of the plugin as input →
// output, filled in by running the plugin against the repo's own prettier.
//
// The outputs are generated, but they are not therefore correct — read every
// one before committing it. A generator that records what the plugin does
// turns a bug into a fixture just as happily as it records a fix. The cases
// below are the spec; the outputs are the spec's current answer.
import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { format, resolveConfig } from "prettier";

const plugin = fileURLToPath(new URL("../src/index.mjs", import.meta.url));

const CASES = [
  {
    name: "an object the author aligned keeps its alignment",
    input: `await table.update(id, {\n  status: "paid",\n  total:  increment(5),\n});\n`,
  },
  {
    name: "an object the author did not align is left alone",
    input: `await table.update(id, {\n  status: "paid",\n  total: increment(5),\n});\n`,
  },
  {
    name: "one padded property marks the whole run",
    input: `const x = {\n  a:  1,\n  bbbb: 2,\n  cc: 3,\n};\n`,
  },
  {
    name: "alignObjectValues: always needs no mark",
    options: { alignObjectValues: "always" },
    input: `const x = {\n  a: 1,\n  bbbb: 2,\n};\n`,
  },
  {
    name: "alignObjectValues: never leaves a marked object alone",
    options: { alignObjectValues: "never" },
    input: `const x = {\n  a:  1,\n  bbbb: 2,\n};\n`,
  },
  {
    name: "a quoted key that cannot drop its quotes",
    input: `const x = {\n  status:  "idle",\n  "counters.totalKwh": 0,\n  couponCode: remove(),\n};\n`,
  },
  {
    name: "a quoted key that prettier unquotes is measured unquoted",
    input: `const x = {\n  a:  1,\n  "bbbb": 2,\n};\n`,
  },
  {
    name: "quoteProps consistent is left alone, since every key's width depends on the others",
    options: { quoteProps: "consistent" },
    input: `const x = {\n  a:  1,\n  "not-an-ident": 2,\n};\n`,
  },
  {
    name: "a computed key takes part",
    input: `await table.query(undefined, {\n  postFilter: {\n    _internalNotes:  missing(),\n    [or]: [{ a: 1 }],\n  },\n});\n`,
  },
  {
    // The regression that made this a fixture: `locStart(value)` points at the
    // expression, so parens prettier adds itself land between the colon and
    // it. Rejecting the property on that dropped it out of its block on the
    // SECOND format, undoing the alignment the first had written.
    name: "parens prettier adds itself do not drop a property from its run",
    input: `const x = {\n  a:  1,\n  bbbb: y = 2,\n};\n`,
  },
  {
    name: "a value the author parenthesised still takes part",
    input: `const x = {\n  a:  1,\n  bbbb: (await y),\n};\n`,
  },
  {
    name: "parens that have to stay do not drop a property either",
    input: `const x = {\n  a:  1,\n  bbbb: (p, q),\n};\n`,
  },
  {
    name: "a comment between the colon and the value does not drop the property",
    input: `const x = {\n  a:  1,\n  bbbb: /* why */ 2,\n};\n`,
  },
  {
    name: "a key whose printed width cannot be predicted sits out without taking the run with it",
    input: `const x = {\n  a:  1,\n  "q\\"uote": 2,\n  cccc: 3,\n};\n`,
  },
  {
    // The regression that made this a fixture: measured from the source, this
    // key was NaN while it spanned two lines and 37 wide once prettier had
    // joined it, so the second format pulled every value out to a 37-column
    // gutter. A computed key that is not a bare identifier is not measurable.
    name: "a computed key prettier may reflow sits out of the column",
    input: `const x = {\n  a:  1,\n  bbb:  2,\n  [someVeryLongExpression +\n    anotherOne]: 3,\n};\n`,
  },
  {
    name: "a numeric key prettier normalises sits out, since 1.50 prints as 1.5",
    input: `const x = {\n  a:  1,\n  1.50: 2,\n  cccc: 3,\n};\n`,
  },
  {
    name: "a plain run of digits is already what prettier prints, so it takes part",
    input: `const x = {\n  a:  1,\n  42: 2,\n};\n`,
  },
  {
    name: "a blank line starts a new run",
    input: `const config = {\n  host:  "localhost",\n  portNumber: 5432,\n\n  user:  "kolom",\n  passwordFile: "/run/secrets/db",\n};\n`,
  },
  {
    name: "a comment line does not start a new run",
    input: `const x = {\n  a:  1,\n  // why b is here\n  bbbb: 2,\n};\n`,
  },
  {
    name: "a spread and a shorthand sit out without breaking the run",
    input: `const x = {\n  ...base,\n  id:  1,\n  name,\n  total: 2,\n};\n`,
  },
  {
    name: "a method and an accessor sit out",
    input: `const x = {\n  id:  1,\n  get total() {\n    return 2;\n  },\n  name: "n",\n};\n`,
  },
  {
    name: "an object folded onto one line carries no padding",
    input: `const x = { a:  1, bb: 2 };\n`,
  },
  {
    name: "a value too long to fit still breaks, and the padding does not become trailing space",
    input: `const x = {\n  a:  1,\n  reallyLongKeyHere: someFunction(withArgument, andAnother, andMoreOfThem, andYetMore, andOneMore),\n};\n`,
  },
  {
    name: "a nested object aligns on its own",
    input: `const x = {\n  outer:  1,\n  nested: {\n    a:  1,\n    bb: 2,\n  },\n};\n`,
  },
  {
    name: "an interface is not aligned: it prints through another path",
    input: `interface Order {\n  id:  string;\n  total: number;\n}\n`,
  },
  {
    name: "a type literal is not aligned either",
    input: `type Order = {\n  id:  string;\n  total: number;\n};\n`,
  },
  {
    name: "a destructuring pattern is untouched",
    input: `const { id:  identifier, total: amount } = order;\n`,
  },
  {
    name: "satisfies and as still print",
    input: `const x = {\n  id:  "a",\n  total: 1,\n} satisfies Order;\n`,
  },
  {
    name: "the gap before an end-of-line comment is kept",
    input: `const x = {\n  a:  1,    // one\n  bbbb: 2,  // two\n};\n`,
  },
  {
    name: "preserveTrailingCommentGap false hands the gap back to prettier",
    options: { preserveTrailingCommentGap: false },
    input: `const x = {\n  a:  1,    // one\n  bbbb: 2,  // two\n};\n`,
  },
  {
    name: "a gap written with tabs is handed back to prettier rather than respelled in spaces",
    input: `const a = 1;\t\t// one\nconst bb = 2;\t// two\n`,
  },
  {
    name: "a comment wedged mid-expression is not an end-of-line comment, so its spacing is prettier's",
    input: `const a =  /* hi */ 1;\n`,
  },
  {
    name: "a comment on its own line keeps its indentation",
    input: `const x = {\n  a: 1,\n  // a comment indented as prettier likes\n  b: 2,\n};\n`,
  },
  {
    name: "alignObjectValuesIn reaches a direct argument",
    options: { alignObjectValuesIn: ["wanted"] },
    input: `wanted({\n  a:  1,\n  bbbb: 2,\n});\n`,
  },
  {
    name: "alignObjectValuesIn skips a call it does not name",
    options: { alignObjectValuesIn: ["wanted"] },
    input: `other({\n  a:  1,\n  bbbb: 2,\n});\n`,
  },
  {
    name: "alignObjectValuesIn matches the last segment of the callee",
    options: { alignObjectValuesIn: ["update"] },
    input: `tx.update("acct", {\n  balance:  increment(-100),\n  note: "x",\n});\n`,
  },
  {
    name: "alignObjectValuesIn reaches a nested argument",
    options: { alignObjectValuesIn: ["wanted"] },
    input: `wanted(id, {\n  filter: {\n    a:  1,\n    bbbb: 2,\n  },\n});\n`,
  },
  {
    name: "alignObjectValuesIn does not cross into a callback",
    options: { alignObjectValuesIn: ["wanted"] },
    input: `wanted(undefined, {\n  onPage: (page) => {\n    const summary = {\n      count:  page.length,\n      firstId: page[0],\n    };\n    return summary;\n  },\n});\n`,
  },
  {
    name: "alignObjectValuesIn reaches a new expression",
    options: { alignObjectValuesIn: ["KolomDB"] },
    input: `const db = new KolomDB({\n  apiKey:  key,\n  baseUrl: url,\n});\n`,
  },
];

const parts = [];
for (const testCase of CASES) {
  const options = { parser: "typescript", plugins: [plugin], printWidth: 100, ...testCase.options };
  const output = await format(testCase.input, options);
  const again = await format(output, options);
  if (again !== output) throw new Error(`not idempotent: ${testCase.name}`);

  parts.push(
    `  {\n    name: ${JSON.stringify(testCase.name)},\n` +
      (testCase.options ? `    options: ${JSON.stringify(testCase.options)},\n` : "") +
      `    input: ${JSON.stringify(testCase.input)},\n` +
      `    output: ${JSON.stringify(output)},\n  },`,
  );
}

const { version } = await import("prettier");

const source =
  `// Generated by scripts/make-fixtures.mjs against prettier ${version}, then read\n` +
  `// over by hand — every output here is the intended behaviour, not just the\n` +
  `// current one. printWidth is 100 unless a case says otherwise, parser\n` +
  `// "typescript". Every case must also survive a second format unchanged.\n\n` +
  `export const FIXTURES = [\n${parts.join("\n")}\n];\n`;

// Through the repo's own config, so what lands here is what `format:check`
// wants and a regeneration never shows up as a formatting diff.
const file = fileURLToPath(new URL("../test/fixtures.mjs", import.meta.url));
await writeFile(file, await format(source, { ...(await resolveConfig(file)), filepath: file }));

console.log(`${CASES.length} cases written, all idempotent`);
