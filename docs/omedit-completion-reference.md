# OMEdit autocomplete — reference (how the upstream editor does it)

[← back to README](../README.md) · related:
[language-features-design.md](language-features-design.md) ·
[omc-client.md](omc-client.md)

A source-level reference for how **OMEdit** (the OpenModelica Connection Editor,
C++/Qt) implements Modelica source autocomplete, captured so future agents
fixing our [completion provider](../packages/extension/src/language/completion-provider.ts)
have the authoritative comparison without re-deriving it. Pinned to the
OpenModelica `master` branch (2026); older OMEdit shipped a simpler
keyword/snippet-only completer, so release-tagged code may not match.

> **The one-line takeaway.** OMEdit's completion is **text-driven at the routing
> layer** (caret heuristics, no AST) and **library-tree-driven at the candidate
> layer** — it resolves names/members against a *pre-built, inheritance-aware
> in-memory model* (`LibraryTreeItem`), **not** live per-keystroke OMC queries.
> Our provider does the opposite (live `getComponents`/`getParameterNames`/
> `searchClassNames` per context). That divergence is the root of most of our
> bugs — see [How ours differs](#how-ours-differs--likely-fixes).

## Cast of characters (OMEdit)

| Role | Symbol | File |
| --- | --- | --- |
| Generic completer widget | `QCompleter` over `QStandardItemModel` + case-insensitive proxy | [BaseEditor.cpp](https://github.com/OpenModelica/OpenModelica/blob/master/OMEdit/OMEditLIB/Editors/BaseEditor.cpp) / [BaseEditor.h](https://github.com/OpenModelica/OpenModelica/blob/master/OMEdit/OMEditLIB/Editors/BaseEditor.h) |
| Trigger + prefix machinery | `PlainTextEdit::keyPressEvent`, `mCompletionCharacters`, `setCompletionPrefix` | [BaseEditor.cpp](https://github.com/OpenModelica/OpenModelica/blob/master/OMEdit/OMEditLIB/Editors/BaseEditor.cpp) |
| Routing decision (per language) | pure-virtual `popUpCompleter()` | [BaseEditor.h](https://github.com/OpenModelica/OpenModelica/blob/master/OMEdit/OMEditLIB/Editors/BaseEditor.h) |
| Modelica routing + resolution | `ModelicaEditor::popUpCompleter / wordUnderCursor / getCompletionSymbols / getCandidateContexts / deepResolve` | [ModelicaEditor.cpp](https://github.com/OpenModelica/OpenModelica/blob/master/OMEdit/OMEditLIB/Editors/ModelicaEditor.cpp) / [ModelicaEditor.h](https://github.com/OpenModelica/OpenModelica/blob/master/OMEdit/OMEditLIB/Editors/ModelicaEditor.h) |
| In-memory model + component cache | `LibraryTreeItem::getComponentsList / getInheritedClassesDeepList / getComponentsClass / tryToComplete` | [LibraryTreeWidget.cpp](https://github.com/OpenModelica/OpenModelica/blob/master/OMEdit/OMEditLIB/Modeling/LibraryTreeWidget.cpp) |
| OMC scripting wrapper | `OMCProxy::getElements / qualifyPath / searchClassNames / parseString` | [OMCProxy.cpp](https://github.com/OpenModelica/OpenModelica/blob/master/OMEdit/OMEditLIB/OMC/OMCProxy.cpp) |

## 1. Trigger + context detection — purely textual, no AST

`BaseEditor` owns a generic `QCompleter` bound to a `QStandardItemModel`
(wrapped in a case-insensitive `QSortFilterProxyModel`). Candidates are pushed
into the model **once per pop-up** and then filtered by prefix — they are *not*
recomputed on every keystroke. `BaseEditor` itself makes **zero** OMC calls; it
delegates the "what to show" decision to the pure-virtual `popUpCompleter()`.

Completion fires on:
- **`Ctrl+Space`** (manual), or
- a char in the configurable `mCompletionCharacters` set — `ModelicaEditor`
  sets it to exactly `"."` (`setCompletionCharacters(".")`), or
- automatically when the auto-complete preference is on.

End-of-word punctuation (a static `eow` string) suppresses the pop-up.

Context detection works on **raw document text around the caret**, not a parse
tree:
- `ModelicaEditor::wordUnderCursor()` scans backward while
  `ch.isLetterOrNumber() || ch == '.' || ch == '_'`, so a chained access
  `a.b.c` is captured as **one token**.
- In `keyPressEvent`, the completion prefix is the segment after the **last
  dot**: `completionPrefix = word.right(len - lastDotIndex - 1)`.
- `stringAfterWord("annotation")` / `stringAfterWord(<keyword>)` grab text after
  a keyword via plain `toPlainText().lastIndexOf(...)`.

### Routing heuristics inside `popUpCompleter()`

1. **Annotation vs symbol.** `inAnnotation = getCompletionAnnotations(stringAfterWord("annotation"), ...)`.
   The `QString` overload walks a **nested-parenthesis stack** from the
   `annotation` keyword and returns `false` at a `;`. Symbol completion
   (`getCompletionSymbols`) only runs when `!inAnnotation`.
2. **Keyword vs type.** Only in the `!word.contains('.') && !inAnnotation`
   branch: `startsWithUpperCase = word[0].isUpper()`. If the first char is
   **uppercase**, it's "definitely not a keyword" → keyword + code-snippet
   candidates are suppressed (types/classes added regardless). This is a coarse
   gate, *not* the whole router.

## 2. Candidate sourcing — library tree, not live OMC

Candidates flow into the shared model through four typed channels on the base
editor, each with its own icon:
`insertCompleterKeywords` · `insertCompleterTypes` · `insertCompleterCodeSnippets` ·
`insertCompleterSymbols`. Keywords/types/snippets are **static** (from
`ModelicaHighlighter::getKeywords()/getTypes()` and a hardcoded
`getCodeSnippets()` list of `function`/`model`/`for`/`if`/… templates). Class
and component candidates are **dynamic, from the in-memory tree**.

A `CompleterItem` separates `mKey` (display label) from `mSelect`/`mValue`
(inserted text, `mValue` split on `\n` for multi-line snippets) and
`mDescription` (tooltip).

**The only OMC scripting call in the completion/resolution path is
`parseString()`** (re-parsing the edited buffer in `getClassNames()`). There are
**no** live `getComponents`/`getParameterNames`/`searchClassNames`/`getElements`
calls in the resolution flow. Component data is sourced **out-of-band**:
`LibraryTreeItem::getComponentsList()` fills its cached `mComponentsList` from
`OMCProxy::getElements(className, useQuotes = true)` → `ElementInfo`, and
completion reads that cache.

> **Refuted (do not assume):** that OMEdit drives type/package candidates via
> `getClassNames` with `recursive/qualified/sort/builtin/...` flags. The
> adversarial pass killed this 0–3 — it does not.

## 3. The "after a dot" member-access flow (the part worth copying)

```
getCompletionSymbols(word)
  split word on '.'  →  nameComponents,  lastPart = trailing segment (the prefix)
  getCandidateContexts(item, nameComponents):
    walk item->parent() up the enclosing scopes, AND at each level
    append item->getInheritedClassesDeepList()   ← inherited (extends) classes
    deepResolve(root, nameComponents):
      for each component i:  current = current->getComponentsClass(name[i])
                             ← resolves each segment to its declared type's item
  for each resolved context:
    tryToCompleteInSingleContext / LibraryTreeItem::tryToComplete(
        completionClasses, completionComponents, lastPart)
      enumerate the context's child classes + cached components into
      TWO separate candidate lists, filtered by lastPart
```

Key consequences:
- **Chained `a.b.c.` is walked segment-by-segment**, each segment resolved to
  its type before descending (iterative `for`-loop over `getComponentsClass`,
  not recursion).
- **Package paths and component instances are the same machinery** — both are
  `LibraryTreeItem`s; a package's "children" are nested classes, a component's
  are its type's members + inherited.
- **Inheritance is first-class**: `getInheritedClassesDeepList()` folds
  `extends` bases into the candidate contexts *before* enumeration, so inherited
  members appear after `r.`.

## 4. Class-scope, inheritance, imports

- **Enclosing scope** is handled by walking `parent()` up the tree in
  `getCandidateContexts` — names visible from the current class's ancestors
  flow in.
- **Inheritance** via `getInheritedClassesDeepList()` (deep, transitive).
- **`qualifyPath(classPath, path)`** ([OMCProxy.cpp](https://github.com/OpenModelica/OpenModelica/blob/master/OMEdit/OMEditLIB/OMC/OMCProxy.cpp))
  is exposed and resolves a relative/partial name to its FQN via OMC's
  `Lookup.lookupClassName` (which honours enclosing scope, imports, and
  extends — see [NFApi.mo](https://github.com/OpenModelica/OpenModelica/blob/master/OMCompiler/Compiler/Script/NFApi.mo)).
  **Caveat:** the shipped regression test (`QualifyPath1.mos`) only exercises
  sibling/enclosing-scope resolution; explicit `import`/`extends` qualification
  is *inferred* from the underlying lookup routine, not directly tested.

## 5. How ours differs — likely fixes

Our provider ([completion-provider.ts](../packages/extension/src/language/completion-provider.ts) /
[resolve.ts](../packages/extension/src/language/resolve.ts) /
[cursor.ts](../packages/extension/src/language/cursor.ts)) is a **live-OMC,
tree-sitter-routed** design. We have no in-memory `LibraryTreeItem` graph, so we
query OMC per context. That's a legitimate but structurally different choice;
the gaps that bite:

1. **No inheritance in member resolution.** OMEdit folds `extends` bases in via
   `getInheritedClassesDeepList()` before enumerating. Our
   [`memberCandidates`](../packages/extension/src/language/completion-provider.ts)
   does a bare `getComponents(type)`, which returns only a class's **own**
   declared components — so after `r.`, inherited members (the majority in MSL)
   are missing. **This is the most likely "members empty/wrong" cause.**
2. **`getComponents` vs `getElements`.** OMEdit's component source is
   `getElements(className, useQuotes = true)` → `ElementInfo`, which is richer
   and is the call the upstream editor trusts. Worth checking whether our
   `getComponents` is simply the narrower/wrong wrapper — see
   [omc-client](../packages/omc-client) and our snapshot path
   [omc-snapshot.ts](../packages/extension/src/diagram/omc-snapshot.ts).
3. **AST-node routing is brittle on half-typed buffers.** Completion fires while
   code is syntactically broken; OMEdit's "token-before-caret + last-dot split +
   paren-stack" is dumber but robust. If our tree-sitter
   [`cursor.ts`](../packages/extension/src/language/cursor.ts) context
   classification misfires on incomplete code, that's a candidate for the
   "nothing shows up" symptom.
4. **Annotation position** needs its own branch (paren-stack), not the symbol
   path.
5. **`import`-brought-in short names** likely need `qualifyPath` *inside* the
   member walk, not only at the type-reference root.

## Open questions (unresolved by the research)

- When a component's declared type is itself a relative/imported name, does
  OMEdit lean on `qualifyPath` or purely on pre-resolved tree links to find the
  `LibraryTreeItem` to descend into? (Most relevant to our `import` handling.)
- Does OMEdit surface `import`-brought-in short names in the candidate list at
  all, or leave it to `qualifyPath`/OMC?
- How/when is the `LibraryTreeItem.mComponentsList` cache invalidated relative
  to edits — how stale can dot-completion be before a re-parse?

## Sources

All primary unless noted. OpenModelica `master`:

- [OMEdit/OMEditLIB/Editors/BaseEditor.cpp](https://github.com/OpenModelica/OpenModelica/blob/master/OMEdit/OMEditLIB/Editors/BaseEditor.cpp) · [BaseEditor.h](https://github.com/OpenModelica/OpenModelica/blob/master/OMEdit/OMEditLIB/Editors/BaseEditor.h)
- [OMEdit/OMEditLIB/Editors/ModelicaEditor.cpp](https://github.com/OpenModelica/OpenModelica/blob/master/OMEdit/OMEditLIB/Editors/ModelicaEditor.cpp) · [ModelicaEditor.h](https://github.com/OpenModelica/OpenModelica/blob/master/OMEdit/OMEditLIB/Editors/ModelicaEditor.h)
- [OMEdit/OMEditLIB/Modeling/LibraryTreeWidget.cpp](https://github.com/OpenModelica/OpenModelica/blob/master/OMEdit/OMEditLIB/Modeling/LibraryTreeWidget.cpp)
- [OMEdit/OMEditLIB/OMC/OMCProxy.cpp](https://github.com/OpenModelica/OpenModelica/blob/master/OMEdit/OMEditLIB/OMC/OMCProxy.cpp)
- [OMCompiler/Compiler/Script/NFApi.mo](https://github.com/OpenModelica/OpenModelica/blob/master/OMCompiler/Compiler/NFFrontEnd/NFModelicaBuiltin.mo) · [NFModelicaBuiltin.mo](https://github.com/OpenModelica/OpenModelica/blob/master/OMCompiler/Compiler/NFFrontEnd/NFModelicaBuiltin.mo)
- [OMEdit architecture (DeepWiki, secondary)](https://deepwiki.com/OpenModelica/OpenModelica/3.1-omedit-architecture) · [Users Guide — OMEdit](https://openmodelica.org/doc/OpenModelicaUsersGuide/latest/omedit.html) · [trac #4404](https://trac.openmodelica.org/OpenModelica/ticket/4404)
