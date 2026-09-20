# prettier-plugin-align-object-values — handoff

You are building the first version of this plugin as its own package. It already
exists and works: it shipped inside `kolomdb-client-typescript` as a local
plugin, formats that whole repo, and is gated in its CI. Your job is to turn a
working single file into a package, not to invent the behaviour.

**Keep it private for now.** Nothing goes to npm. No `npm publish`, not even a
`--dry-run` that would need credentials. The repo stays private until Martijn
says otherwise.

## What is in this bundle

| File | What it is |
| --- | --- |
| `plugin.mjs` | The working plugin, 421 lines, as it runs today. Start from this file. |
| `fixtures.mjs` | 29 cases, input → expected output. This is the specification. |
| `make-fixtures.mjs` | How `fixtures.mjs` was generated, if you need to regenerate. |
| `reference/setup.sh`, `reference/all.sh`, `reference/run.mjs` | The prettier version matrix harness — installs one prettier per directory and runs the plugin against each. |
| `reference/probe.mjs` | A half-written probe for the 3.7 question below. Unfinished. |

The same plugin file is also in git, if this scratchpad is gone by the time you
read it: branch `worktree-clever-falcon-3070` of `KolomTec/kolomdb-client-typescript`,
PR #35, at `tools/prettier-plugin-align-object-values.mjs`. Copy the bundle
somewhere durable before you start — it lives in another session's scratchpad.

## What the plugin does

Prettier collapses the run of spaces after a `:` to exactly one, and has no
option that does otherwise — all 29 of its options are listed in
`getSupportInfo()` and none aligns anything. This plugin wraps prettier's own
estree printer and pads after the colon instead, so the values of one object
start in the same column:

```ts
await table.update(id, {
  status: "paid",
  total:  increment(5),
});
```

Three options:

- `alignObjectValues`: `"preserve"` (default) aligns an object whose source is
  already aligned — that is, one where some property has two or more spaces
  after its colon. `"always"` aligns every object that prints over several
  lines. `"never"` is off. The preserve default is deliberate: it is the same
  bargain prettier strikes over whether an object stays expanded — the author
  decides, per object, and the formatter keeps the decision.
- `alignObjectValuesIn`: a list of call names. When it is non-empty, only
  objects inside those calls are aligned. A name matches the last segment of the
  callee, so `"update"` covers `orders.update` and `tx.update` both, and
  `NewExpression` counts, so `"KolomDB"` covers `new KolomDB({…})`. An object is
  "inside" a call when it sits in one of the arguments however deeply nested,
  but the walk stops at a function boundary, so an object built inside a
  callback is judged on that callback. Empty (the default) reaches every object.
  The shape is copied from `prettier-plugin-tailwindcss`'s `tailwindFunctions`,
  which declares itself identically — `type: "string", array: true,
  default: [{ value: [] }]`.
- `preserveTrailingCommentGap`: on by default, keeps the spacing written before
  an end-of-line comment anywhere in the file rather than letting prettier close
  it to one space.

## The two things that make it work, which you must not undo

**1. Padding is an `ifBreak` tied to the object's own group.** The plugin marks
each property with a placeholder doc node during `print`, and the
`ObjectExpression` print then finds the group holding that object's braces,
gives it an id, and swaps every placeholder for
`ifBreak(" ".repeat(n), "", { groupId })`. So padding materialises only when the
object actually prints over several lines.

This is what makes the plugin idempotent, and it was not the first design. The
first version decided alignment from the source layout — whether the author had
broken the object over lines, whether a property's value spanned lines. That
looks equivalent and is not: prettier *rewrites* the layout, so an object
written on one line and broken for width gained alignment on the next save, and
a value that broke onto its own line dropped out of the run on the next save.
Both were observed, both are fixed by keying on nothing but the AST. **Any rule
you add that reads `originalText` for layout will reintroduce this.** Reading
`originalText` for what the author *wrote* — the two-space mark, a blank line
between properties — is fine, because prettier preserves those.

**2. The key width is predicted, then checked against the printed doc.**
`keyWidth` works out what prettier will print a key as, which is not always what
was written — with the default `quoteProps: "as-needed"` prettier drops quotes
from a key that reads as an identifier. The block's target width comes from
those predictions, but each property pads off its *printed* key width, measured
from the doc. A prediction that missed leaves that one property unpadded instead
of pushing it out of line. Keep that belt and braces.

## The open question you should answer first

**The plugin silently does nothing on prettier 3.0.3 through 3.6.2.** It works
on 3.7.4, 3.8.5 and 3.9.8. I ran seven cases against the latest patch of every
3.x minor; below 3.7 every one came back as plain prettier output — no throw, no
warning, just no alignment.

I did not diagnose it. My unverified guess is that a plugin's `printers.estree`
only takes precedence over the built-in estree printer from 3.7 onward, which
would mean the override is never selected. `reference/probe.mjs` is where I
stopped: it writes a tiny plugin that records whether its `print` is called at
all and whether `AstPath` exposes `node`, `parent` and `ancestors`, then runs it
under whichever prettier is installed beside it. Finish that against 3.6.2 and
3.7.4 and you will know.

Then either support the older versions or refuse them loudly. A published plugin
that silently does nothing is the worst possible failure, so at minimum the peer
range must exclude them **and** the plugin should throw with a sentence naming
the version it found. Do not leave the silence in.

`reference/setup.sh` then `reference/all.sh` rebuild the matrix; they have
absolute paths to this scratchpad in them, so fix those first. The recipe that
matters: each version needs its own directory with its own copy of the plugin
beside it, because the plugin's `import "prettier/plugins/estree.js"` resolves
from the plugin file's own location, not from the prettier running it.

## Known gaps, in the order a user will hit them

- **Interfaces and type literals are not aligned.** `TSPropertySignature` prints
  through a different path, not `printAssignment`, so the colon-splice does not
  apply. This is the first thing anyone will ask for.
- **JSON is not aligned.** Prettier's json parser uses the `estree-json`
  printer, a different astFormat, so the plugin never sees it.
- **`quoteProps: "consistent"` silently skips alignment**, because a key's
  printed width then depends on every other key in the object. `keyWidth`
  returns `NaN` and the object is left alone. Resolvable — decide per object
  whether any key needs quotes, then measure all of them that way.
- **`preserveTrailingCommentGap` keeps the gap, not the column.** If padding
  changes a line's width, the comment after it moves with the line, so comments
  the author had lined up can end up one or two columns apart — visible in the
  fixture "the gap before an end-of-line comment is kept". It is exact whenever
  the alignment is already in the source, which is why `"preserve"` mode on a
  real repo reproduced every file byte for byte. Aligning trailing comments
  properly means computing each printed property's width at the object level
  and padding before the `line-suffix` — doable, deliberately not done.

## What the package needs

- ESM, `type: "module"`, `peerDependencies: { "prettier": ">=3.7" }` pending the
  question above. Prettier 3 loads plugins by `import`, so ESM-only is fine.
- `fixtures.mjs` turned into the test suite, run across a prettier matrix rather
  than one version. The matrix is not ceremony — the 3.6/3.7 boundary is exactly
  the bug it catches. Every fixture must also assert a second format changes
  nothing; idempotence is the property most likely to break.
- A README: the three options, the preserve/always distinction, and an honest
  "what this does not do" section from the gaps above.
- MIT, matching the repo it came from.
- Keywords including `prettier-plugin` for npm search. Auto-discovery by keyword
  was removed in prettier 3, so the config must name the plugin explicitly; say
  so in the README.

Name is free on npm — I checked, 404. The only prior art is
`prettier-plugin-align@0.0.1-alpha.1` from Feb 2025, which does enums and switch
statements, not object values.

## How it is exercised today

`kolomdb-client-typescript` formats with it at `printWidth: 120`,
`alignObjectValues: "preserve"`, and an `alignObjectValuesIn` naming that API's
operations. It reformatted 35 files, every one settles in a single pass, and
`npm run format:check` is in CI. Prettier there is pinned to exactly `3.9.6`
because that is what Zed bundles, so the editor and CI agree byte for byte —
and, as it turns out, because below 3.7 the plugin would quietly stop working.

That repo is the obvious first consumer once this package exists, but leave it
alone for now: its PR #35 is open and awaiting a human merge.
