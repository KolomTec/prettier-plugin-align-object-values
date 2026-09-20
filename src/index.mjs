/**
 * Prettier plugin: align the values of an object literal.
 *
 *   await table.update(id, {
 *     status: "paid",
 *     total:  increment(5),
 *   });
 *
 * Prettier itself collapses the run of spaces after a `:` to exactly one. This
 * plugin wraps prettier's own printer and pads after the colon instead, so the
 * values of one object start in the same column.
 *
 * `alignObjectValues`:
 *   "preserve" (default) — align an object whose source is ALREADY aligned,
 *                          the same bargain prettier strikes over whether an
 *                          object stays expanded: the author decides, per
 *                          object, and the formatter keeps the decision.
 *   "always"             — align every object that prints over several lines.
 *   "never"              — off.
 *
 * `alignObjectValuesIn` narrows that to the calls whose names it lists, so a
 * document, a filter and a set of options line up while an object anywhere
 * else in the file keeps prettier's single space. A name matches the last
 * segment of the callee — "update" covers `orders.update` and `tx.update`
 * both — and an object counts as inside the call when it sits in one of the
 * arguments, however deeply nested, without crossing into a callback. An
 * empty list, the default, reaches every object.
 *
 * A blank line between two properties starts a new run. Object literals only:
 * an interface and a type literal print through another path and keep
 * prettier's single space.
 *
 * `preserveTrailingCommentGap`, on by default, keeps the spacing written
 * before an end-of-line comment anywhere in the file, which is the other
 * column prettier would otherwise close up.
 *
 * Needs prettier 3.7.0 or newer, and refuses to run below it — see the note
 * on MINIMUM_PRETTIER.
 */

import { version as prettierVersion } from "prettier";
import * as estreeModule from "prettier/plugins/estree.js";
import * as docModule from "prettier/doc.js";

/**
 * Before 3.7.0 this plugin loads and then does nothing at all, which is the
 * worst way for a formatter plugin to fail — the code comes back formatted,
 * just not aligned, and nothing says why.
 *
 * The cause is prettier's own printer lookup. It reads
 *
 *     parserPlugin.printers?.[astFormat] ? parserPlugin : byAstFormat(plugins, astFormat)
 *
 * and only the second branch consults the plugins the user listed. Up to 3.6
 * one built-in plugin carried every parser AND every printer, so the plugin
 * that owns `typescript` also owned `estree`, the first branch always won, and
 * no plugin's estree printer was ever reached. 3.7.0 split the estree printer
 * into a built-in plugin of its own, which left the parser plugin without an
 * `estree` printer, so the lookup falls through to the plugin list — where the
 * last match, this plugin, wins. Verified by probe on 3.0.3, 3.6.2 and 3.7.0.
 *
 * So the floor is a fact about prettier, not a policy: refuse, and say which
 * version was found.
 */
const MINIMUM_PRETTIER = "3.7.0";

if (!printersReachPlugins(prettierVersion)) {
  throw new Error(
    `prettier-plugin-align-object-values requires prettier ${MINIMUM_PRETTIER} or newer, but found ${prettierVersion}. ` +
      `Before ${MINIMUM_PRETTIER} prettier's built-in estree printer takes precedence over a plugin's, so this plugin ` +
      `would load and then silently leave every object unaligned. Upgrade prettier, or remove this plugin from your config.`,
  );
}

/** Whether prettier's printer lookup reaches plugin printers at all. */
function printersReachPlugins(version) {
  const [major, minor] = String(version)
    .split(".", 2)
    .map((part) => Number.parseInt(part, 10));

  // An unrecognisable version is not grounds to break every format; the
  // matrix in `npm run test:compat` is what keeps the floor honest.
  if (!Number.isInteger(major) || !Number.isInteger(minor)) return true;

  return major > 3 || (major === 3 && minor >= 7);
}

const basePrinter = (estreeModule.printers ?? estreeModule.default.printers).estree;
const { ifBreak } = docModule.builders ?? docModule.default.builders;

/**
 * Padding is written into the doc as this placeholder and resolved once the
 * whole object has been printed. Nothing else understands it, so every one of
 * them is replaced before the doc leaves the object it belongs to.
 */
const PAD = "align-object-values/pad";

export const options = {
  alignObjectValues: {
    type: "choice",
    category: "Global",
    default: "preserve",
    description: "Align the values of an object literal in one column.",
    choices: [
      { value: "preserve", description: "Align objects whose source is already aligned." },
      { value: "always", description: "Align every object that prints over several lines." },
      { value: "never", description: "Never align." },
    ],
  },
  alignObjectValuesIn: {
    type: "string",
    category: "Global",
    array: true,
    default: [{ value: [] }],
    description: "Align only the objects inside calls to these names. Empty reaches every object.",
  },
  preserveTrailingCommentGap: {
    type: "boolean",
    category: "Global",
    default: true,
    description: "Keep the spacing written before an end-of-line comment instead of one space.",
  },
};

export const printers = {
  estree: {
    ...basePrinter,
    print(path, options, print, args) {
      const doc = basePrinter.print(path, options, print, args);
      const { node } = path;

      if (node.type === "ObjectExpression") return resolvePads(doc);

      if (isAlignableProperty(node) && path.parent?.type === "ObjectExpression") {
        const pad = padFor(path, options, doc);
        if (pad > 0) return markPad(doc, pad);
      }

      return doc;
    },

    printComment(path, options) {
      const comment = basePrinter.printComment(path, options);
      const gap = trailingGap(path.node, options);
      return gap ? [gap, comment] : comment;
    },
  },
};

/**
 * The spacing an end-of-line comment was written with, less the single space
 * prettier prints before it. A comment two spaces out from a short line is
 * lined up with the comment on the line below it, and that column is no more
 * prettier's to take than the column of the values above.
 */
function trailingGap(comment, options) {
  if (options.preserveTrailingCommentGap === false) return undefined;

  const text = options.originalText;
  const start = locStart(comment);

  let at = start;
  while (at > 0 && (text[at - 1] === " " || text[at - 1] === "\t")) at -= 1;

  // Only a comment sharing a line with the code ahead of it has a gap to keep.
  const gap = start - at;
  if (gap < 2 || at === 0 || text[at - 1] === "\n") return undefined;

  // And only one that ENDS its line. A comment wedged mid-expression —
  // `const a =  /* hi */ 1` — is not lined up with anything, whatever spacing
  // it was written with, and the option is documented as end-of-line.
  if (!/^[^\S\n]*(\n|$)/.test(text.slice(locEnd(comment)))) return undefined;

  // Spaces only. The gap is emitted after the single space prettier prints, so
  // a run of n spaces is reproduced exactly by n-1 of them — but there is no
  // string that turns that leading space back into a tab, and guessing would
  // move the comment rather than leave it. Prettier's single space stands.
  if (text.slice(at, start).includes("\t")) return undefined;

  return " ".repeat(gap - 1);
}

// ---------------------------------------------------------------------------
// How wide to pad this one property
// ---------------------------------------------------------------------------

/** Per object literal: the key width every property in its block pads up to. */
const blocks = new WeakMap();

function padFor(path, options, doc) {
  const mode = options.alignObjectValues ?? "preserve";
  if (mode === "never" || !isInScope(path, options)) return 0;

  const target = blockTargets(path.parent, options, mode).get(path.node);
  if (!target) return 0;

  // Pad off the key as PRINTED, not as predicted. A prediction that missed
  // leaves this one property unpadded rather than pushing it out of line.
  const width = keyDocWidth(doc);
  return Number.isFinite(width) ? Math.max(0, target - width) : 0;
}

/**
 * Whether this property sits inside a call `alignObjectValuesIn` names. The
 * walk climbs out of the nested objects and arrays it passes through and stops
 * at a function, so an object built inside a callback is judged on that
 * callback rather than on the call the callback was handed to.
 */
function isInScope(path, options) {
  const names = options.alignObjectValuesIn;
  if (!Array.isArray(names) || names.length === 0) return true;

  let child = path.node;
  for (const node of path.ancestors) {
    if (isCall(node) && node.arguments?.includes(child)) {
      if (names.includes(calleeName(node.callee))) return true;
    } else if (isFunction(node)) {
      return false;
    }
    child = node;
  }
  return false;
}

function blockTargets(object, options, mode) {
  const cached = blocks.get(object);
  if (cached?.options === options) return cached.targets;

  const targets = computeBlockTargets(object, options, mode);
  blocks.set(object, { options, targets });
  return targets;
}

/**
 * Splits the object's properties into blocks and maps each property to the key
 * width its block aligns to. A property missing from the map is not aligned.
 */
function computeBlockTargets(object, options, mode) {
  const targets = new Map();
  const text = options.originalText;

  let block = [];
  const flush = () => {
    // A property whose printed key width cannot be predicted still belongs to
    // the block: it carries the author's mark like any other, and dropping it
    // outright would take the whole object's alignment with it. It just sits
    // out of the measuring and gets no target of its own.
    const measurable = block.filter((entry) => Number.isFinite(entry.width));

    if (measurable.length > 1 && (mode === "always" || block.some((entry) => entry.padded))) {
      const target = Math.max(...measurable.map((entry) => entry.width));
      for (const entry of measurable) targets.set(entry.node, target);
    }
    block = [];
  };

  let previous;
  for (const node of object.properties) {
    // A blank line between two properties separates them into their own blocks,
    // the way a blank line separates paragraphs. A comment line does not.
    if (previous && hasBlankLine(text.slice(locEnd(previous), locStart(node)))) flush();
    previous = node;

    const entry = entryFor(node, options);
    if (entry) block.push(entry);
  }
  flush();

  return targets;
}

function entryFor(node, options) {
  if (!isAlignableProperty(node)) return undefined;

  // A width of NaN is not a rejection: `computeBlockTargets` keeps the
  // property in its block for the author's mark and leaves it unpadded.
  const width = keyWidth(node, options);

  // Everything between the key and the value. Before the colon that is a
  // bracket for a computed key and nothing else; after it, only the spacing is
  // ours to read.
  //
  // What follows the spacing is deliberately not checked. `locStart(value)`
  // points at the expression, so a paren or a leading comment in front of it
  // lands in this slice — and parens are exactly what prettier adds and
  // removes at will. Requiring the whole span to be a bare colon dropped
  // `bbbb: (y = 2)` out of its block on the second format, throwing away the
  // alignment the first had just written. Whatever sits there prints inside
  // the value's own doc, which comes after the padding either way.
  const span = options.originalText.slice(locEnd(node.key), locStart(node.value));
  const colon = span.indexOf(":");
  if (colon < 0 || !/^\s*\]?\s*$/.test(span.slice(0, colon))) return undefined;

  return { node, width, padded: /^[^\S\n]{2,}/.test(span.slice(colon + 1)) };
}

function isAlignableProperty(node) {
  return (
    (node.type === "Property" || node.type === "ObjectProperty") &&
    !node.shorthand &&
    !node.method &&
    (node.kind === undefined || node.kind === "init")
  );
}

// ---------------------------------------------------------------------------
// Widths
// ---------------------------------------------------------------------------

/**
 * What the key will be PRINTED as, which is not always what was written: with
 * the default `quoteProps: "as-needed"` prettier drops the quotes around a key
 * that reads as an identifier.
 */
function keyWidth(node, options) {
  const { key } = node;
  const raw = options.originalText.slice(locStart(key), locEnd(key));

  // `[or]` and the rest of the sentinel keys. Only a bare identifier, though:
  // prettier cannot respell one, so the source width is the printed width.
  // Any other expression it may reflow, and measuring the source is the same
  // mistake `entryFor` used to make one level down — `[p  +  q]` predicted 9
  // and printed 7, and a key broken over two lines predicted NaN on the first
  // format and its full joined width on the second, which pulled every value
  // in the object out to a gutter the width of the whole expression.
  if (node.computed) return key.type === "Identifier" ? raw.length + 2 : NaN;

  if (key.type === "Identifier" || key.type === "PrivateIdentifier") return raw.length;
  if (isStringKey(key)) {
    if (/[\\"']/.test(key.value)) return NaN; // escapes: let prettier's own width win
    switch (options.quoteProps) {
      case "preserve":
        return raw.length;
      case "consistent":
        return NaN; // depends on every other key in the object
      default:
        return isIdentifierName(key.value) ? key.value.length : key.value.length + 2;
    }
  }
  // Digits only. Prettier normalises a numeric literal — `1.50` prints as
  // `1.5`, `1.` as `1`, `0XFF` as `0xff` — and a plain run of digits is the
  // only form already identical to what it prints.
  if (key.type === "NumericLiteral" || typeof key.value === "number") {
    return /^\d+$/.test(raw) ? raw.length : NaN;
  }

  return NaN;
}

/** The flat width of the key doc inside a printed property. */
function keyDocWidth(doc) {
  return doc?.type === "group" && Array.isArray(doc.contents) ? docWidth(doc.contents[0]) : NaN;
}

function docWidth(doc) {
  if (typeof doc === "string") return doc.length;
  if (Array.isArray(doc)) return doc.reduce((total, part) => total + docWidth(part), 0);
  if (!doc) return 0;

  switch (doc.type) {
    case "group":
      return doc.break ? NaN : docWidth(doc.contents);
    case "indent":
    case "align":
    case "indent-if-break":
    case "label":
      return docWidth(doc.contents);
    case "fill":
      return docWidth(doc.parts);
    case "if-break":
      return docWidth(doc.flatContents);
    case "line":
      return doc.hard ? NaN : doc.soft ? 0 : 1;
    case "line-suffix":
    case "line-suffix-boundary":
    case "break-parent":
    case "cursor":
    case "trim":
      return 0;
    default:
      return NaN;
  }
}

// ---------------------------------------------------------------------------
// Padding a printed property
// ---------------------------------------------------------------------------

/**
 * A property prints as `group([key, ":", value])`, whatever layout prettier
 * chose for the value. The placeholder goes in right after the colon, so
 * everything prettier decided about the value still holds.
 */
function markPad(doc, width) {
  if (doc?.type !== "group" || !Array.isArray(doc.contents) || doc.expandedStates) return doc;

  const colon = doc.contents.indexOf(":");
  if (colon < 1) return doc;

  const contents = doc.contents.slice();
  contents.splice(colon + 1, 0, { type: PAD, width });
  return { ...doc, contents };
}

/**
 * Turns the placeholders inside one object into padding that applies only when
 * that object prints over several lines — the column means nothing on a single
 * line, and an object prettier folds back onto one line would otherwise carry
 * the gaps of the shape it used to have.
 */
function resolvePads(doc) {
  const group = findObjectGroup(doc);
  const groupId = group?.id ?? Symbol("align-object-values");
  return replacePads(doc, { group, groupId, assignId: group !== undefined && group.id === undefined });
}

/** The group holding the object's own braces, whose break state the padding follows. */
function findObjectGroup(doc) {
  if (!doc || typeof doc === "string") return undefined;

  if (Array.isArray(doc)) {
    for (const part of doc) {
      const found = findObjectGroup(part);
      if (found) return found;
    }
    return undefined;
  }

  if (doc.type === "group" && Array.isArray(doc.contents) && doc.contents[0] === "{") return doc;

  for (const key of DOC_CHILDREN) {
    if (doc[key] === undefined) continue;
    const found = findObjectGroup(doc[key]);
    if (found) return found;
  }
  return undefined;
}

function replacePads(doc, context) {
  if (!doc || typeof doc === "string") return doc;

  if (Array.isArray(doc)) {
    let changed = false;
    const parts = doc.map((part) => {
      const next = replacePads(part, context);
      changed ||= next !== part;
      return next;
    });
    return changed ? parts : doc;
  }

  if (doc.type === PAD) {
    return context.group ? ifBreak(" ".repeat(doc.width), "", { groupId: context.groupId }) : "";
  }

  let copy;
  for (const key of DOC_CHILDREN) {
    if (doc[key] === undefined) continue;
    const next = replacePads(doc[key], context);
    if (next !== doc[key]) (copy ??= { ...doc })[key] = next;
  }
  if (doc === context.group && context.assignId) (copy ??= { ...doc }).id = context.groupId;

  return copy ?? doc;
}

const DOC_CHILDREN = ["contents", "parts", "expandedStates", "breakContents", "flatContents"];

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

const locStart = (node) => node.range?.[0] ?? node.start;
const locEnd = (node) => node.range?.[1] ?? node.end;

const hasBlankLine = (text) => /\n[^\S\n]*\n/.test(text);

const isStringKey = (key) => key.type === "StringLiteral" || (key.type === "Literal" && typeof key.value === "string");

const isIdentifierName = (name) => /^[$A-Z_a-z][\w$]*$/.test(name);

const isCall = (node) =>
  node.type === "CallExpression" || node.type === "OptionalCallExpression" || node.type === "NewExpression"; // `new KolomDB({ … })` takes options like any other

const isFunction = (node) =>
  node.type === "FunctionDeclaration" ||
  node.type === "FunctionExpression" ||
  node.type === "ArrowFunctionExpression" ||
  node.type === "ObjectMethod" ||
  node.type === "ClassMethod";

/** The last segment of a callee: `orders.update` and `tx.update` are both "update". */
function calleeName(callee) {
  if (!callee) return undefined;
  switch (callee.type) {
    case "Identifier":
      return callee.name;
    case "MemberExpression":
    case "OptionalMemberExpression":
      return callee.computed ? undefined : calleeName(callee.property);
    case "TSNonNullExpression":
      return calleeName(callee.expression);
    default:
      return undefined;
  }
}

export default { options, printers };
