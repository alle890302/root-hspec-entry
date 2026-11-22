# mend — one patch tool for every AI edit format

`mend` applies an edit that an AI model wrote to a tree of text files. Models write
edits in four formats, and `mend` reads all four to one specification (`SPEC.md` in
the kit): unified diffs (often with wrong line numbers), SEARCH/REPLACE blocks, the
V4A patch format, and text-editor tool calls as JSON. Every file is changed or
nothing is: a failed edit changes nothing, and the edits after it still run, so
every failure is reported.

## Usage

```
node main.ts [--format=NAME] [--check] [--strict] [PATCH]
```

- The working directory is the root of the tree. Every path in a patch is relative
  to it. `PATCH` is the patch file; when it is absent or `-`, the patch is read
  from standard input.
- `--format=NAME` reads the patch in one format: `unified`, `search-replace`,
  `v4a` or `json`; `auto`, the default, detects it.
- `--check` does everything but write: the same output and exit code, and no file
  is created, changed or deleted.
- `--strict` matches lines exactly (tier 0 only).

Exit codes: `0` applied (prints `A`/`D`/`M`/`R` lines and `ok: <n> files`),
`1` some edit failed (prints one `error: <code> <path>` line per failed edit,
then `failed: <k> of <n> edits`, and writes nothing), `2` usage / no-patch /
format / parse error (prints exactly one `error: ...` line).

## Matching

Old lines are found at the first of three tiers at which they occur: tier 0
(exact), tier 1 (trailing spaces/tabs ignored), tier 2 (leading and trailing
spaces/tabs ignored). Context lines are written as the file's own matched line,
and at tier 2 new lines are re-indented to the file's indentation. Unified
hunks take the occurrence nearest their (possibly wrong) line number; V4A
chunks follow anchors and a cursor; SEARCH/REPLACE blocks must match exactly
once.

## Files

- `main.ts` — the CLI (Node 22, standard library only).
- `runner.ts` — the kit's trial runner, kept as shipped.
- `check.ts` — runs `main.ts` on the kit's public practice set.
- `tests/` — targeted cases plus a fuzz/invariant harness written for this entry.

## Practice

```
node check.ts <kit>/program/generator/practice.json
```
