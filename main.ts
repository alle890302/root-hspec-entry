// main.ts is mend, the CLI SPEC.md specifies. It implements all of SPEC.md: the command line, the output and
// exit codes, safe paths, format detection, the three-tier line matching (section 5), unified diffs (section 6),
// SEARCH/REPLACE blocks (section 7), V4A patches (section 8), JSON edits (section 9) and the all-or-nothing
// write (section 10). Node 22, the standard library alone; run it as `node main.ts [options] [PATCH]`.
//
// In a trial the grader runs `node /bot/main.ts` with MAKEFUN_ENV_URL set, and then this file hands over to runner.ts
// (the last lines below): keep that hand-over and runner.ts as they are, and write the CLI.

import { mkdirSync, readFileSync, rmSync, statSync, writeFileSync, writeSync } from 'node:fs';
import { dirname } from 'node:path';

const FORMATS = ['auto', 'unified', 'search-replace', 'v4a', 'json'];

class Exit2 {
  readonly line: string;
  constructor(line: string) {
    this.line = line;
  }
}
class Fail {
  readonly code: string;
  readonly path: string;
  constructor(code: string, path: string) {
    this.code = code;
    this.path = path;
  }
}

const blank = (s: string): boolean => s.trim() === '';

function patchLines(text: string): string[] {
  if (text === '') return [];
  const lines = text.split('\n');
  if (text.endsWith('\n')) lines.pop();
  return lines.map((l) => (l.endsWith('\r') ? l.slice(0, -1) : l));
}

function safe(p: string): boolean {
  return p !== '' && !p.startsWith('/') && !p.includes('\\') && p.split('/').every((s) => s !== '' && s !== '.' && s !== '..');
}

/** A file as lines: its line break, its lines, whether it ends with a line break (SPEC section 3). */
interface FileState {
  br: string;
  lines: string[];
  finalBr: boolean;
}

function splitFile(text: string): FileState {
  if (text === '') return { br: '\n', lines: [], finalBr: false };
  const nl = text.indexOf('\n');
  const br = nl > 0 && text[nl - 1] === '\r' ? '\r\n' : '\n';
  const parts = text.split(br);
  const finalBr = text.endsWith(br);
  if (finalBr) parts.pop();
  return { br, lines: parts, finalBr };
}

function joinFile(f: FileState): string {
  if (f.lines.length === 0) return '';
  return f.lines.join(f.br) + (f.finalBr ? f.br : '');
}

const stripTrail = (s: string): string => s.replace(/[ \t]+$/, '');
const stripBoth = (s: string): string => s.replace(/^[ \t]+/, '').replace(/[ \t]+$/, '');
const leadWS = (s: string): string => {
  const m = /^[ \t]*/.exec(s);
  return m === null ? '' : m[0];
};

function normLine(s: string, tier: number): string {
  if (tier === 0) return s;
  if (tier === 1) return stripTrail(s);
  return stripBoth(s);
}

/** Occurrences of O in the file's lines at or after `from`, at the first tier where one exists (section 5). */
function findTierOccurrences(
  fileLines: string[],
  oldLines: string[],
  strict: boolean,
  from: number,
): { tier: number; occ: number[] } | null {
  const tiers = strict ? [0] : [0, 1, 2];
  for (const t of tiers) {
    const occ: number[] = [];
    for (let i = from; i + oldLines.length <= fileLines.length; i += 1) {
      let ok = true;
      for (let j = 0; j < oldLines.length; j += 1) {
        if (normLine(fileLines[i + j]!, t) !== normLine(oldLines[j]!, t)) {
          ok = false;
          break;
        }
      }
      if (ok) occ.push(i);
    }
    if (occ.length > 0) return { tier: t, occ };
  }
  return null;
}

/** One line of N: `ctx` is its index in O when it is a context line, else -1. */
interface NewPart {
  text: string;
  ctx: number;
}

/** Build the lines N writes: context lines as the file's own matched lines, tier-2 re-indentation (section 5). */
function buildNew(
  fileLines: string[],
  pos: number,
  oLines: string[],
  nParts: NewPart[],
  tier: number,
): string[] {
  const out: string[] = [];
  let f = '';
  let p = '';
  if (tier === 2 && oLines.length > 0) {
    f = leadWS(fileLines[pos]!);
    p = leadWS(oLines[0]!);
  }
  for (const part of nParts) {
    if (part.ctx >= 0) {
      out.push(fileLines[pos + part.ctx]!);
      continue;
    }
    let s = part.text;
    if (tier === 2 && s !== '' && s.replace(/[ \t]/g, '') !== '' && s.startsWith(p)) s = f + s.slice(p.length);
    out.push(s);
  }
  return out;
}

/** First line at or after `from` equal to the anchor at the first tier where one is (section 8). */
function findAnchor(lines: string[], anchor: string, strict: boolean, from: number): number | null {
  const tiers = strict ? [0] : [0, 1, 2];
  for (const t of tiers) {
    for (let i = from; i < lines.length; i += 1) {
      if (normLine(lines[i]!, t) === normLine(anchor, t)) return i;
    }
  }
  return null;
}

/** The tree as the edits leave it: changed paths in `now` (null: deleted), the rest read from disk. */
class Tree {
  private readonly orig = new Map<string, string | null>();
  readonly now = new Map<string, string | null>();
  original(p: string): string | null {
    if (!this.orig.has(p)) {
      let v: string | null = null;
      try {
        if (statSync(p).isFile()) v = readFileSync(p, 'utf8');
      } catch {
        v = null;
      }
      this.orig.set(p, v);
    }
    return this.orig.get(p)!;
  }
  get(p: string): string | null {
    return this.now.has(p) ? this.now.get(p)! : this.original(p);
  }
}

type Edit = (tree: Tree) => void;
type OnMove = (oldPath: string, newPath: string) => void;

function detect(lines: string[]): string | null {
  const first = lines.findIndex((l) => !blank(l));
  if (first < 0) return null;
  if (lines[first]!.trim() === '*** Begin Patch') return 'v4a';
  const c = lines[first]!.trimStart()[0];
  if (c === '[' || c === '{') return 'json';
  if (lines.some((l) => l.trimEnd() === '<<<<<<< SEARCH')) return 'search-replace';
  if (lines.some((l, i) => l.startsWith('diff --git ') || (l.startsWith('--- ') && (lines[i + 1] ?? '').startsWith('+++ ')))) return 'unified';
  return null;
}

/** One JSON edit object (SPEC.md section 9), or null when it is not one. */
function jsonEdit(v: unknown): Edit | null {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  const p = o.path;
  if (typeof p !== 'string') return null;
  const exists = (tree: Tree): string => {
    if (!safe(p)) throw new Fail('unsafe', p);
    const t = tree.get(p);
    if (t === null) throw new Fail('missing', p);
    return t;
  };
  if (o.command === 'create' && typeof o.file_text === 'string') {
    const text = o.file_text;
    return (tree) => {
      if (!safe(p)) throw new Fail('unsafe', p);
      if (tree.get(p) !== null) throw new Fail('exists', p);
      tree.now.set(p, text);
    };
  }
  if (o.command === 'str_replace' && typeof o.old_str === 'string' && o.old_str !== '' && (o.new_str === undefined || typeof o.new_str === 'string')) {
    const oldStr = o.old_str;
    const newStr = (o.new_str as string | undefined) ?? '';
    return (tree) => {
      const before = exists(tree);
      const nl = before.indexOf('\n');
      const crlf = nl > 0 && before[nl - 1] === '\r';
      const lf = (s: string): string => (crlf ? s.replaceAll('\r\n', '\n') : s);
      const t = lf(before);
      const old = lf(oldStr);
      let count = 0;
      for (let k = t.indexOf(old); k >= 0; k = t.indexOf(old, k + 1)) count += 1;
      if (count === 0) throw new Fail('no-match', p);
      if (count > 1) throw new Fail('ambiguous', p);
      const at = t.indexOf(old);
      const out = t.slice(0, at) + lf(newStr) + t.slice(at + old.length);
      tree.now.set(p, crlf ? out.replaceAll('\n', '\r\n') : out);
    };
  }
  if (o.command === 'insert' && typeof o.insert_line === 'number' && Number.isInteger(o.insert_line) && typeof o.new_str === 'string') {
    const line = o.insert_line;
    const add = patchLines(o.new_str);
    return (tree) => {
      const before = exists(tree);
      const nl = before.indexOf('\n');
      const br = nl > 0 && before[nl - 1] === '\r' ? '\r\n' : '\n';
      const lines = before === '' ? [] : before.split(br);
      const final = before !== '' && before.endsWith(br);
      if (final) lines.pop();
      if (line < 0 || line > lines.length) throw new Fail('no-match', p);
      lines.splice(line, 0, ...add);
      tree.now.set(p, lines.length === 0 ? '' : lines.join(br) + (final ? br : ''));
    };
  }
  return null;
}

function jsonEdits(text: string, lines: string[]): Edit[] {
  const first = lines.findIndex((l) => !blank(l));
  if (first < 0) throw new Exit2('error: parse 1');
  const edits: Edit[] = [];
  if (lines[first]!.trimStart().startsWith('[')) {
    let v: unknown;
    try {
      v = JSON.parse(text);
    } catch {
      throw new Exit2(`error: parse ${first + 1}`);
    }
    if (!Array.isArray(v)) throw new Exit2(`error: parse ${first + 1}`);
    for (const x of v) {
      const e = jsonEdit(x);
      if (e === null) throw new Exit2(`error: parse ${first + 1}`);
      edits.push(e);
    }
    return edits;
  }
  lines.forEach((l, i) => {
    if (blank(l)) return;
    let e: Edit | null = null;
    try {
      e = jsonEdit(JSON.parse(l));
    } catch {
      e = null;
    }
    if (e === null) throw new Exit2(`error: parse ${i + 1}`);
    edits.push(e);
  });
  return edits;
}

// ---- Shared hunk/chunk machinery (sections 5, 6, 8) ----

type BodyKind = 'ctx' | 'old' | 'new' | 'mark';
interface BodyEntry {
  kind: BodyKind;
  text: string;
}
interface Hunk {
  a: number;
  body: BodyEntry[];
}

/** Split a hunk/chunk body into its old lines O and its new lines N (section 5). */
function hunkParts(body: BodyEntry[]): { oLines: string[]; nParts: NewPart[]; noEol: boolean } {
  const oLines: string[] = [];
  const nParts: NewPart[] = [];
  for (const e of body) {
    if (e.kind === 'ctx') {
      nParts.push({ text: e.text, ctx: oLines.length });
      oLines.push(e.text);
    } else if (e.kind === 'old') {
      oLines.push(e.text);
    } else if (e.kind === 'new') {
      nParts.push({ text: e.text, ctx: -1 });
    }
  }
  let lastCN = -1;
  for (let i = 0; i < body.length; i += 1) {
    if (body[i]!.kind === 'ctx' || body[i]!.kind === 'new') lastCN = i;
  }
  const noEol = lastCN >= 0 && body[lastCN + 1] !== undefined && body[lastCN + 1]!.kind === 'mark';
  return { oLines, nParts, noEol };
}

/** Apply unified hunks in order to a file's lines (section 6). Throws Fail('no-match', path). */
function applyHunks(f: FileState, hunks: Hunk[], strict: boolean, path: string): void {
  let d = 0;
  for (const h of hunks) {
    const { oLines, nParts, noEol } = hunkParts(h.body);
    if (oLines.length > 0) {
      const found = findTierOccurrences(f.lines, oLines, strict, 0);
      if (found === null) throw new Fail('no-match', path);
      const target = h.a - 1 + d;
      let best = found.occ[0]!;
      let bestDist = Math.abs(best - target);
      for (const p of found.occ) {
        const dist = Math.abs(p - target);
        if (dist < bestDist) {
          best = p;
          bestDist = dist;
        }
      }
      const rep = buildNew(f.lines, best, oLines, nParts, found.tier);
      const runsToEnd = best + oLines.length === f.lines.length;
      f.lines.splice(best, oLines.length, ...rep);
      if (runsToEnd) f.finalBr = !noEol;
      d += nParts.length - oLines.length;
    } else if (nParts.length > 0) {
      const pos = Math.min(h.a + d, f.lines.length);
      const rep = nParts.map((p) => p.text);
      const atEnd = pos === f.lines.length;
      f.lines.splice(pos, 0, ...rep);
      if (atEnd) f.finalBr = !noEol;
      d += nParts.length;
    }
  }
}

// ---- Unified diffs (section 6) ----

interface Section {
  diffOld: string | null;
  diffNew: string | null;
  renameOld: string | null;
  renameNew: string | null;
  headerOld: string | null;
  headerNew: string | null;
  oldPath: string | null;
  newPath: string | null;
  isNew: boolean;
  isDel: boolean;
  hunks: Hunk[];
}

/** The path after `--- `/`+++ `: text after the four characters, up to the first tab, trimmed, a/ or b/ removed. */
function diffPath(line: string): string {
  let s = line.slice(4);
  const tab = s.indexOf('\t');
  if (tab >= 0) s = s.slice(0, tab);
  s = s.trim();
  if (s.startsWith('a/') || s.startsWith('b/')) s = s.slice(2);
  return s;
}

function creationText(hunks: Hunk[]): string {
  const plus: string[] = [];
  let noEol = false;
  for (const h of hunks) {
    for (let i = 0; i < h.body.length; i += 1) {
      const e = h.body[i]!;
      if (e.kind === 'new') {
        plus.push(e.text);
        noEol = h.body[i + 1] !== undefined && h.body[i + 1]!.kind === 'mark';
      }
    }
  }
  if (plus.length === 0) return '';
  return plus.join('\n') + (noEol ? '' : '\n');
}

function unifiedSectionEdit(sec: Section, strict: boolean, onMove: OnMove): Edit {
  return (tree) => {
    const oldP = sec.oldPath;
    const newP = sec.newPath;
    const isCreate = oldP === null || sec.isNew;
    if (isCreate) {
      const np = newP ?? '';
      if (!safe(np)) throw new Fail('unsafe', np);
      if (tree.get(np) !== null) throw new Fail('exists', np);
      tree.now.set(np, creationText(sec.hunks));
      return;
    }
    const isDelete = newP === null || sec.isDel;
    if (isDelete) {
      const op = oldP ?? '';
      if (!safe(op)) throw new Fail('unsafe', op);
      if (tree.get(op) === null) throw new Fail('missing', op);
      tree.now.set(op, null);
      return;
    }
    const op = oldP!;
    const np = newP!;
    if (op !== np) {
      if (!safe(op)) throw new Fail('unsafe', op);
      if (!safe(np)) throw new Fail('unsafe', np);
      const before = tree.get(op);
      if (before === null) throw new Fail('missing', op);
      if (tree.get(np) !== null) throw new Fail('exists', np);
      const f = splitFile(before);
      applyHunks(f, sec.hunks, strict, op);
      tree.now.set(np, joinFile(f));
      tree.now.set(op, null);
      onMove(op, np);
      return;
    }
    if (!safe(op)) throw new Fail('unsafe', op);
    const before = tree.get(op);
    if (before === null) throw new Fail('missing', op);
    const f = splitFile(before);
    applyHunks(f, sec.hunks, strict, op);
    tree.now.set(op, joinFile(f));
  };
}

function unifiedEdits(lines: string[], strict: boolean, onMove: OnMove): Edit[] {
  const sections: Section[] = [];
  let cur: Section | null = null;
  let hasPair = false;
  let sawHunk = false;
  const finalize = (sec: Section): void => {
    const toPath = (s: string | null): string | null => (s === null || s === '/dev/null' ? null : s);
    sec.oldPath = toPath(sec.headerOld ?? sec.renameOld ?? sec.diffOld);
    sec.newPath = toPath(sec.headerNew ?? sec.renameNew ?? sec.diffNew);
  };
  const startSection = (diffOld: string | null, diffNew: string | null): void => {
    if (cur !== null) finalize(cur);
    cur = {
      diffOld,
      diffNew,
      renameOld: null,
      renameNew: null,
      headerOld: null,
      headerNew: null,
      oldPath: null,
      newPath: null,
      isNew: false,
      isDel: false,
      hunks: [],
    };
    sections.push(cur);
    hasPair = false;
    sawHunk = false;
  };
  const isDiffGit = (l: string): boolean => l === 'diff --git' || l.startsWith('diff --git ');
  let idx = 0;
  while (idx < lines.length) {
    const line = lines[idx]!;
    if (isDiffGit(line)) {
      const m = /^diff --git a\/(.+) b\/(.+)$/.exec(line);
      if (m === null) throw new Exit2(`error: parse ${idx + 1}`);
      startSection(m[1]!, m[2]!);
      idx += 1;
      continue;
    }
    if (line.startsWith('@@')) {
      if (cur === null) throw new Exit2(`error: parse ${idx + 1}`);
      const m = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(line);
      if (m === null) throw new Exit2(`error: parse ${idx + 1}`);
      const a = Number(m[1]);
      idx += 1;
      const rawBody: string[] = [];
      while (idx < lines.length) {
        const b = lines[idx]!;
        if (isDiffGit(b)) break;
        if (b.startsWith('--- ') && (lines[idx + 1] ?? '').startsWith('+++ ')) break;
        if (b === '' || b.startsWith(' ') || b.startsWith('-') || b.startsWith('+') || b.startsWith('\\')) {
          rawBody.push(b);
          idx += 1;
          continue;
        }
        break;
      }
      while (rawBody.length > 0 && rawBody[rawBody.length - 1] === '') rawBody.pop();
      const body: BodyEntry[] = rawBody.map((b) => {
        if (b === '') return { kind: 'ctx' as BodyKind, text: '' };
        if (b.startsWith(' ')) return { kind: 'ctx' as BodyKind, text: b.slice(1) };
        if (b.startsWith('-')) return { kind: 'old' as BodyKind, text: b.slice(1) };
        if (b.startsWith('+')) return { kind: 'new' as BodyKind, text: b.slice(1) };
        return { kind: 'mark' as BodyKind, text: b.slice(1) };
      });
      cur.hunks.push({ a, body });
      sawHunk = true;
      continue;
    }
    if (line.startsWith('--- ') && (lines[idx + 1] ?? '').startsWith('+++ ')) {
      if (cur !== null && !sawHunk && !hasPair) {
        cur.headerOld = diffPath(line);
        cur.headerNew = diffPath(lines[idx + 1]!);
        hasPair = true;
        idx += 2;
        continue;
      }
      startSection(null, null);
      cur!.headerOld = diffPath(line);
      cur!.headerNew = diffPath(lines[idx + 1]!);
      hasPair = true;
      idx += 2;
      continue;
    }
    if (line.startsWith('--- ')) {
      if (cur !== null && !sawHunk) throw new Exit2(`error: parse ${idx + 2}`);
      idx += 1;
      continue;
    }
    if (cur !== null && !sawHunk) {
      if (line.startsWith('rename from ')) cur.renameOld = line.slice('rename from '.length).trim();
      else if (line.startsWith('rename to ')) cur.renameNew = line.slice('rename to '.length).trim();
      else if (line.startsWith('new file mode')) cur.isNew = true;
      else if (line.startsWith('deleted file mode')) cur.isDel = true;
      idx += 1;
      continue;
    }
    idx += 1;
  }
  if (cur !== null) finalize(cur);
  return sections.map((sec) => unifiedSectionEdit(sec, strict, onMove));
}

// ---- SEARCH/REPLACE blocks (section 7) ----

function srEdit(path: string, oldLines: string[], newLines: string[], strict: boolean): Edit {
  return (tree) => {
    if (!safe(path)) throw new Fail('unsafe', path);
    if (oldLines.length === 0) {
      if (tree.get(path) !== null) throw new Fail('exists', path);
      tree.now.set(path, newLines.length === 0 ? '' : `${newLines.join('\n')}\n`);
      return;
    }
    const before = tree.get(path);
    if (before === null) throw new Fail('missing', path);
    const f = splitFile(before);
    const found = findTierOccurrences(f.lines, oldLines, strict, 0);
    if (found === null) throw new Fail('no-match', path);
    if (found.occ.length > 1) throw new Fail('ambiguous', path);
    const pos = found.occ[0]!;
    const nParts: NewPart[] = newLines.map((t) => ({ text: t, ctx: -1 }));
    const rep = buildNew(f.lines, pos, oldLines, nParts, found.tier);
    f.lines.splice(pos, oldLines.length, ...rep);
    tree.now.set(path, joinFile(f));
  };
}

function srEdits(lines: string[], strict: boolean): Edit[] {
  const edits: Edit[] = [];
  let prevReplaceEnd = -1;
  let prevPath: string | null = null;
  let i = 0;
  while (i < lines.length) {
    if (lines[i]!.trimEnd() !== '<<<<<<< SEARCH') {
      i += 1;
      continue;
    }
    const searchIdx = i;
    let eq = -1;
    for (let j = searchIdx + 1; j < lines.length; j += 1) {
      if (lines[j]!.trimEnd() === '=======') {
        eq = j;
        break;
      }
    }
    if (eq < 0) throw new Exit2(`error: parse ${searchIdx + 1}`);
    let rep = -1;
    for (let j = eq + 1; j < lines.length; j += 1) {
      if (lines[j]!.trimEnd() === '>>>>>>> REPLACE') {
        rep = j;
        break;
      }
    }
    if (rep < 0) throw new Exit2(`error: parse ${searchIdx + 1}`);
    let path: string | null = null;
    for (let j = searchIdx - 1; j > prevReplaceEnd; j -= 1) {
      const l = lines[j]!;
      if (blank(l)) continue;
      if (l.trim().startsWith('```')) continue;
      path = l.trim();
      break;
    }
    if (path === null) path = prevPath;
    if (path === null) throw new Exit2(`error: parse ${searchIdx + 1}`);
    const oldLines = lines.slice(searchIdx + 1, eq);
    const newLines = lines.slice(eq + 1, rep);
    edits.push(srEdit(path, oldLines, newLines, strict));
    prevPath = path;
    prevReplaceEnd = rep;
    i = rep + 1;
  }
  return edits;
}

// ---- V4A patches (section 8) ----

interface V4aChunk {
  anchor: string | null;
  eof: boolean;
  body: BodyEntry[];
}

function isV4aSectionStart(line: string): boolean {
  return line.startsWith('*** Add File: ') || line.startsWith('*** Delete File: ') || line.startsWith('*** Update File: ');
}

function v4aEdits(lines: string[], strict: boolean, onMove: OnMove): Edit[] {
  const first = lines.findIndex((l) => !blank(l));
  if (first < 0) throw new Exit2('error: parse 1');
  if (lines[first]!.trim() !== '*** Begin Patch') throw new Exit2(`error: parse ${first + 1}`);
  let last = lines.length - 1;
  while (last >= 0 && blank(lines[last]!)) last -= 1;
  if (last < 0 || lines[last]!.trim() !== '*** End Patch') throw new Exit2(`error: parse ${lines.length + 1}`);
  const collect = (start: number): { items: { text: string; idx: number }[]; next: number } => {
    const items: { text: string; idx: number }[] = [];
    let i = start;
    while (i < last && !isV4aSectionStart(lines[i]!)) {
      items.push({ text: lines[i]!, idx: i });
      i += 1;
    }
    while (items.length > 0 && blank(items[items.length - 1]!.text)) items.pop();
    return { items, next: i };
  };
  const edits: Edit[] = [];
  let i = first + 1;
  while (i < last) {
    const line = lines[i]!;
    if (blank(line)) {
      i += 1;
      continue;
    }
    if (line.startsWith('*** Add File: ')) {
      const path = line.slice('*** Add File: '.length).trim();
      const { items, next } = collect(i + 1);
      const fileLines: string[] = [];
      for (const it of items) {
        if (it.text === '') fileLines.push('');
        else if (it.text.startsWith('+')) fileLines.push(it.text.slice(1));
        else throw new Exit2(`error: parse ${it.idx + 1}`);
      }
      edits.push((tree) => {
        if (!safe(path)) throw new Fail('unsafe', path);
        if (tree.get(path) !== null) throw new Fail('exists', path);
        tree.now.set(path, fileLines.length === 0 ? '' : `${fileLines.join('\n')}\n`);
      });
      i = next;
      continue;
    }
    if (line.startsWith('*** Delete File: ')) {
      const path = line.slice('*** Delete File: '.length).trim();
      const { items, next } = collect(i + 1);
      if (items.length > 0) throw new Exit2(`error: parse ${items[0]!.idx + 1}`);
      edits.push((tree) => {
        if (!safe(path)) throw new Fail('unsafe', path);
        if (tree.get(path) === null) throw new Fail('missing', path);
        tree.now.set(path, null);
      });
      i = next;
      continue;
    }
    if (line.startsWith('*** Update File: ')) {
      const path = line.slice('*** Update File: '.length).trim();
      const updateLine = i + 1;
      const { items, next } = collect(i + 1);
      let moveTo: string | null = null;
      let j = 0;
      if (items.length > 0 && items[0]!.text.startsWith('*** Move to: ')) {
        moveTo = items[0]!.text.slice('*** Move to: '.length).trim();
        j = 1;
      }
      const chunks: V4aChunk[] = [];
      let curChunk: V4aChunk | null = null;
      for (let k = j; k < items.length; k += 1) {
        const it = items[k]!;
        const text = it.text;
        if (text.startsWith('@@')) {
          const anchor = text.slice(2).trim();
          curChunk = { anchor: anchor === '' ? null : anchor, eof: false, body: [] };
          chunks.push(curChunk);
          continue;
        }
        if (text === '*** End of File') {
          if (curChunk === null) throw new Exit2(`error: parse ${it.idx + 1}`);
          curChunk.eof = true;
          curChunk = null;
          continue;
        }
        if (text === '' || text.startsWith(' ') || text.startsWith('-') || text.startsWith('+')) {
          if (curChunk === null) {
            if (chunks.length === 0) {
              curChunk = { anchor: null, eof: false, body: [] };
              chunks.push(curChunk);
            } else {
              throw new Exit2(`error: parse ${it.idx + 1}`);
            }
          }
          if (text === '') curChunk.body.push({ kind: 'ctx', text: '' });
          else if (text.startsWith(' ')) curChunk.body.push({ kind: 'ctx', text: text.slice(1) });
          else if (text.startsWith('-')) curChunk.body.push({ kind: 'old', text: text.slice(1) });
          else curChunk.body.push({ kind: 'new', text: text.slice(1) });
          continue;
        }
        throw new Exit2(`error: parse ${it.idx + 1}`);
      }
      if (chunks.length === 0 && moveTo === null) throw new Exit2(`error: parse ${updateLine}`);
      edits.push((tree) => {
        if (!safe(path)) throw new Fail('unsafe', path);
        if (moveTo !== null && !safe(moveTo)) throw new Fail('unsafe', moveTo);
        const before = tree.get(path);
        if (before === null) throw new Fail('missing', path);
        if (moveTo !== null && tree.get(moveTo) !== null) throw new Fail('exists', moveTo);
        const f = splitFile(before);
        let cursor = 0;
        for (const ch of chunks) {
          if (ch.anchor !== null) {
            const at = findAnchor(f.lines, ch.anchor, strict, cursor);
            if (at === null) throw new Fail('no-match', path);
            cursor = at + 1;
          }
          const { oLines, nParts } = hunkParts(ch.body);
          if (oLines.length === 0) {
            const pos = ch.eof ? f.lines.length : cursor;
            const rep = nParts.map((p) => p.text);
            f.lines.splice(pos, 0, ...rep);
            cursor = pos + rep.length;
          } else {
            const found = findTierOccurrences(f.lines, oLines, strict, cursor);
            if (found === null) throw new Fail('no-match', path);
            let pos: number | null = null;
            for (const p of found.occ) {
              if (ch.eof && p + oLines.length !== f.lines.length) continue;
              pos = p;
              break;
            }
            if (pos === null) throw new Fail('no-match', path);
            const rep = buildNew(f.lines, pos, oLines, nParts, found.tier);
            f.lines.splice(pos, oLines.length, ...rep);
            cursor = pos + rep.length;
          }
        }
        const text = joinFile(f);
        if (moveTo !== null) {
          tree.now.set(moveTo, text);
          tree.now.set(path, null);
          onMove(path, moveTo);
        } else {
          tree.now.set(path, text);
        }
      });
      i = next;
      continue;
    }
    throw new Exit2(`error: parse ${i + 1}`);
  }
  return edits;
}

function run(args: string[]): { code: number; out: string[] } {
  let format: string | null = null;
  let check = false;
  let strict = false;
  const pos: string[] = [];
  let ended = false;
  for (const a of args) {
    if (!ended && a === '--') ended = true;
    else if (!ended && a.startsWith('-') && a !== '-') {
      if (a.startsWith('--format=') && format === null && FORMATS.includes(a.slice(9))) format = a.slice(9);
      else if (a === '--check' && !check) check = true;
      else if (a === '--strict' && !strict) strict = true;
      else return { code: 2, out: ['error: usage'] };
    } else pos.push(a);
  }
  if (pos.length > 1) return { code: 2, out: ['error: usage'] };
  const file = pos.length === 0 || pos[0] === '-' ? null : pos[0]!;
  let text = '';
  try {
    text = readFileSync(file ?? 0, 'utf8');
  } catch {
    if (file !== null) return { code: 2, out: ['error: no-patch'] };
  }
  const lines = patchLines(text);
  const kind = format === null || format === 'auto' ? detect(lines) : format;
  if (kind === null) return { code: 2, out: ['error: format'] };
  const moves: { old: string; new: string }[] = [];
  const onMove: OnMove = (o, n) => {
    moves.push({ old: o, new: n });
  };
  let edits: Edit[];
  try {
    if (kind === 'json') edits = jsonEdits(text, lines);
    else if (kind === 'unified') edits = unifiedEdits(lines, strict, onMove);
    else if (kind === 'search-replace') edits = srEdits(lines, strict);
    else edits = v4aEdits(lines, strict, onMove);
    if (edits.length === 0) throw new Exit2('error: parse 1');
  } catch (e) {
    if (e instanceof Exit2) return { code: 2, out: [e.line] };
    throw e;
  }
  const tree = new Tree();
  const fails: Fail[] = [];
  for (const edit of edits) {
    const before = new Map(tree.now);
    try {
      edit(tree);
    } catch (e) {
      if (!(e instanceof Fail)) throw e;
      tree.now.clear();
      for (const [k, v] of before) tree.now.set(k, v);
      fails.push(e);
    }
  }
  if (fails.length > 0) return { code: 1, out: [...fails.map((f) => `error: ${f.code} ${f.path}`), `failed: ${fails.length} of ${edits.length} edits`] };
  const rows: { key: string; line: string }[] = [];
  const movedNew = new Set<string>();
  const movedOld = new Set<string>();
  for (const m of moves) {
    if (tree.original(m.old) !== null && tree.get(m.old) === null && tree.original(m.new) === null && tree.get(m.new) !== null) {
      rows.push({ key: m.new, line: `R ${m.old} -> ${m.new}` });
      movedNew.add(m.new);
      movedOld.add(m.old);
    }
  }
  for (const p of [...tree.now.keys()]) {
    if (movedNew.has(p) || movedOld.has(p)) continue;
    const was = tree.original(p);
    const now = tree.now.get(p)!;
    if (was === now) continue;
    rows.push({ key: p, line: `${was === null ? 'A' : now === null ? 'D' : 'M'} ${p}` });
  }
  rows.sort((a, b) => Buffer.compare(Buffer.from(a.key), Buffer.from(b.key)));
  if (!check) {
    for (const p of [...tree.now.keys()].sort((a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b)))) {
      const now = tree.now.get(p)!;
      if (now === null) rmSync(p, { force: true });
      else {
        mkdirSync(dirname(p), { recursive: true });
        writeFileSync(p, now);
      }
    }
  }
  return { code: 0, out: [...rows.map((r) => r.line), `ok: ${rows.length} ${rows.length === 1 ? 'file' : 'files'}`] };
}

const trialEnv = process.env.MAKEFUN_ENV_URL;
if (trialEnv !== undefined && trialEnv !== '') {
  // A trial: the kit's runner reads the checks from the env and runs this file on each one, without this variable.
  const { runTrial } = await import('./runner.ts');
  await runTrial(trialEnv);
} else {
  const r = run(process.argv.slice(2));
  writeSync(1, r.out.map((l) => `${l}\n`).join(''));
  process.exitCode = r.code;
}
