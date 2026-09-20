# prettier-plugin-align-object-values

Lines up the values of an object literal in one column.

```ts
await table.update(id, {
  status: "paid",
  total:  increment(5),
});
```

Prettier collapses the run of spaces after a `:` to exactly one, and has no
option that does otherwise. This plugin wraps prettier's own estree printer and
pads after the colon instead.

By default it only aligns an object **you** have already aligned. That is the
same bargain prettier strikes over whether an object stays expanded: the author
decides, per object, and the formatter keeps the decision.

> **Private for now.** This package is not on npm — `package.json` carries
> `"private": true` so it cannot be published by accident. Install it from git,
> or point `plugins` at a path.

## Install

```sh
npm install --save-dev github:KolomTec/prettier-plugin-align-object-values
```

Requires **prettier 3.7.0 or newer** — see [Prettier versions](#prettier-versions).

Prettier 3 removed plugin auto-discovery by keyword, so the config must name the
plugin explicitly:

```json
{
  "plugins": ["prettier-plugin-align-object-values"],
  "alignObjectValues": "preserve"
}
```

## Options

### `alignObjectValues`

`"preserve"` (default) · `"always"` · `"never"`

- **`"preserve"`** aligns an object whose source is already aligned — one where
  some property has two or more spaces after its colon. Write the extra space
  once and the formatter keeps it; delete it and the object goes back to a
  single space. Nothing in a codebase changes until you ask for it.
- **`"always"`** aligns every object that prints over several lines.
- **`"never"`** turns the plugin off, including the alignment already in your
  source.

One property with two spaces after its colon marks the whole run:

```ts
// what you write                what you get
const x = {                      const x = {
  a:  1,                           a:    1,
  bbbb: 2,                         bbbb: 2,
  cc: 3,                           cc:   3,
};                               };
```

A blank line between two properties starts a new run, the way a blank line
separates paragraphs. A comment line does not.

### `alignObjectValuesIn`

A list of call names. Default `[]`, which reaches every object.

```json
{ "alignObjectValuesIn": ["update", "insert", "query", "KolomDB"] }
```

When the list is non-empty, only objects inside those calls are aligned — a
document, a filter and a set of options line up while an object anywhere else in
the file keeps prettier's single space.

- A name matches the **last segment** of the callee, so `"update"` covers
  `orders.update` and `tx.update` both.
- `new` counts, so `"KolomDB"` covers `new KolomDB({ … })`.
- An object is "inside" a call when it sits in one of the arguments, however
  deeply nested — but the walk stops at a function boundary, so an object built
  inside a callback is judged on that callback, not on the call the callback was
  handed to.

### `preserveTrailingCommentGap`

`true` (default)

Keeps the spacing written before an end-of-line comment, anywhere in the file,
rather than letting prettier close it to one space. That column is no more
prettier's to take than the column of the values above it. Set it to `false` to
hand the gap back.

"End-of-line" is meant literally: a comment wedged mid-expression
(`const a =  /* hi */ 1`) is lined up with nothing, so its spacing stays
prettier's. The gap must also be written with spaces — see below.

## What this does not do

An honest list, in the order you are likely to hit it.

- **Interfaces and type literals are not aligned.** `TSPropertySignature`
  prints through a different path in prettier — not `printAssignment` — so the
  colon-splice this plugin does never applies. This is the first thing people
  ask for. `interface Order { id: string }` keeps prettier's single space.
- **JSON is not aligned.** Prettier's json parser prints through the
  `estree-json` printer, a different astFormat, so the plugin never sees it.
- **A key whose printed width can't be predicted sits out of the column.** The
  rest of the object still lines up; that key keeps prettier's single space and
  stands out of the run. It takes two measurable keys to make a column, so an
  object where only one is left is not aligned at all. A key is unmeasurable
  when it is
  - a string containing a quote or a backslash, or any string key under
    `quoteProps: "consistent"`, where the printed width depends on every other
    key in the object — `"as-needed"` (the default) and `"preserve"` both work;
  - a computed key that is not a bare identifier. `[or]` is measurable;
    `[p + q]` and `[Symbol.iterator]` are not, because prettier is free to
    respell what is inside the brackets;
  - a numeric key that is not a plain run of digits. `42` is measurable; `1.50`
    and `0XFF` are not, because prettier normalises them to `1.5` and `0xff`.

  The rule in each case is the same: predict only where the printed form
  provably equals the source. Guessing wider than that is what produced a
  37-column gutter on the second save.

- **A trailing-comment gap written with tabs is not kept.** Prettier prints one
  space before a trailing comment and the plugin appends to it, so a run of
  _n_ spaces comes back exactly — but no string turns that leading space back
  into a tab. Rather than move the comment, a tab gap is handed back to
  prettier and closes to one space.
- **`preserveTrailingCommentGap` keeps the gap, not the column.** If padding
  changes a line's width, the comment after it moves with the line, so comments
  you had lined up can end up a column or two apart. It is exact whenever the
  alignment is already in the source, which is why `"preserve"` mode reproduces
  an already-formatted repo byte for byte.
- **Destructuring patterns are untouched.** `const { id: identifier } = order`
  is a pattern, not an object literal.
- **There is no ceiling on how wide a column can get.** One long key pulls every
  value in its run out to its column, however far that is. Under `"preserve"`
  you asked for it by marking the object, and under `"always"` by choosing
  `"always"` — but a 30-character key still makes a 30-character gutter, and
  nothing stops it. A `maxAlignWidth`-style option, past which the over-long
  key sits out exactly as an unmeasurable one does, is the obvious next thing
  to add; it is not here yet.

## Prettier versions

**Prettier 3.7.0 is a hard floor, and the plugin refuses to run below it.**

This is a fact about prettier, not a policy. Prettier picks a printer with

```js
parserPlugin.printers?.[astFormat] ? parserPlugin : byAstFormat(plugins, astFormat);
```

and only the second branch ever consults the plugins you listed. Up to 3.6 one
built-in plugin carried every parser _and_ every printer, so the plugin that
owns the `typescript` parser also owned `estree`, the first branch always won,
and no plugin's estree printer was reachable. 3.7.0 split the estree printer
into a built-in plugin of its own; the parser plugin no longer has an `estree`
printer, the lookup falls through to the plugin list, and this plugin is found
there.

On 3.6 and below the plugin therefore _loaded and then did nothing at all_ — no
throw, no warning, code that came back formatted but never aligned. That is the
worst way for a formatter plugin to fail, so instead it now throws at load with
the version it found. `npm run test:compat` asserts both halves: every version
below the floor must refuse, every version above must pass all the fixtures.

## Development

```sh
npm install
npm test               # the fixtures, against the repo's own prettier
npm run test:compat    # the fixtures, against every prettier 3.x minor
npm run format:check   # the repo formats itself with the plugin
```

`test/fixtures.mjs` is the specification: 39 cases of input → expected output.
Every case is asserted twice — the output, and that a second format over that
output changes nothing. Idempotence is the property most likely to break and the
one a formatter is least forgiven for.

`scripts/make-fixtures.mjs` regenerates the outputs, but a generator records
what the plugin _does_, which turns a bug into a fixture just as happily as it
records a fix. Read every changed line before committing it.

`scripts/compat.mjs` builds the matrix under `.compat/`: one directory per
prettier version, each with its own prettier **and its own copy of the plugin**.
The copy is the point — the plugin's `import "prettier/plugins/estree.js"`
resolves from the plugin file's own location, not from the prettier running it,
so a shared copy would bind every run to the same prettier.

### Two things not to undo

**Padding is an `ifBreak` tied to the object's own group.** Each property is
marked with a placeholder doc node during `print`; the `ObjectExpression` print
then finds the group holding that object's braces, gives it an id, and swaps
every placeholder for `ifBreak(" ".repeat(n), "", { groupId })`. Padding
materialises only when the object actually prints over several lines.

This is what makes the plugin idempotent, and it was not the first design. The
first version decided alignment from the source layout — whether the author had
broken the object over lines, whether a value spanned lines. That looks
equivalent and is not: prettier _rewrites_ the layout, so an object written on
one line and broken for width gained alignment on the next save, and a value
that broke onto its own line dropped out of the run on the next save. Both were
observed; both are fixed by keying on nothing but the AST. **Any rule that reads
`originalText` for layout reintroduces this.** Reading `originalText` for what
the author _wrote_ — the two-space mark, a blank line between properties — is
fine, because prettier preserves those.

Parens are the trap inside that rule, because they look like something the
author wrote and are not: prettier adds and removes them at will.
`locStart(value)` points at the expression, so anything in front of it — a
paren, a leading comment — falls inside the key→value span. `entryFor`
therefore reads only up to the colon and the spacing just after it, and never
asks what follows. An earlier version required that whole span to be a bare
colon, which dropped `bbbb: y = 2` out of its block on the _second_ format,
once prettier had added the parens that the first format's alignment was
written under.

**The key width is predicted, then checked against the printed doc.**
`keyWidth` works out what prettier will print a key as, which is not always what
was written — with the default `quoteProps: "as-needed"` prettier drops the
quotes from a key that reads as an identifier. The block's target width comes
from those predictions, but each property pads off its _printed_ key width,
measured from the doc. A prediction that missed leaves that one property
unpadded instead of pushing it out of line. Keep the belt and the braces.

`docs/HANDOFF.md` is the original design note this package was built from.

## Prior art

`prettier-plugin-align@0.0.1-alpha.1` aligns enums and switch statements, not
object values.

## License

MIT
