// Differential/fuzz harness for mend.
// Generates random files + patches (unified, search-replace, v4a, json) that SHOULD
// apply, computes the expected result with an independent line-level model written
// straight from SPEC.md, and compares exit/stdout/files exactly. Also mutates patches
// and checks atomicity (exit 1 => files unchanged) and determinism (run twice).
// Run: node tests/fuzz.mjs [count]   (default 4000)
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, statSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const MAIN = join(dirname(fileURLToPath(import.meta.url)), '..', 'main.ts');
const COUNT = Number(process.argv[2] ?? 4000);

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const r = mulberry32(20261122);
const ri = (n) => Math.floor(r() * n);
const pick = (arr) => arr[ri(arr.length)];

const WORDS = ['alpha', 'beta', 'gamma', 'delta', 'token', 'value', 'count', 'total', 'index', 'render', 'parse', 'check', 'load', 'save', 'field', 'stage', 'limit', 'queue', 'event', 'price', 'stock', 'draft', 'route', 'label', 'entry', 'frame', 'order', 'graph', 'cache', 'ledger', 'signal'];
function randLine() {
  const indent = pick(['', '', '', '  ', '    ', '\t', ' ']);
  const n = 1 + ri(3);
  const body = Array.from({ length: n }, () => pick(WORDS)).join(' ');
  const trail = pick(['', '', '', ' ', '  ', '\t']);
  return indent + body + trail;
}
function randFile() {
  const n = ri(15);
  const lines = Array.from({ length: n }, () => randLine());
  // de-duplicate-ish: make most lines unique by appending a counter sometimes
  for (let i = 0; i < lines.length; i += 1) if (r() < 0.5) lines[i] = `${lines[i]} #${i}`;
  const br = r() < 0.3 ? '\r\n' : '\n';
  const finalBr = r() < 0.75;
  const text = lines.length === 0 ? '' : lines.join(br) + (finalBr ? br : '');
  // SPEC 3: the break is CRLF only when the first line feed follows a CR; a file
  // with no line feed at all is LF, whatever break was used to generate it.
  const nl = text.indexOf('\n');
  const effBr = nl > 0 && text[nl - 1] === '\r' ? '\r\n' : '\n';
  return { lines, br: effBr, finalBr, text };
}
const stripTrail = (s) => s.replace(/[ \t]+$/, '');
const stripBoth = (s) => s.replace(/^[ \t]+/, '').replace(/[ \t]+$/, '');
const leadWS = (s) => { const m = /^[ \t]*/.exec(s); return m ? m[0] : ''; };
const norm = (s, t) => (t === 0 ? s : t === 1 ? stripTrail(s) : stripBoth(s));
function occurrences(lines, oldLines, from = 0) {
  for (const t of [0, 1, 2]) {
    const occ = [];
    for (let i = from; i + oldLines.length <= lines.length; i += 1) {
      if (oldLines.every((o, j) => norm(lines[i + j], t) === norm(o, t))) occ.push(i);
    }
    if (occ.length > 0) return { tier: t, occ };
  }
  return null;
}
// Independent expected-result model for a replace of O (at pos) by N parts.
function expectedReplace(fileLines, pos, oLines, nParts, tier, finalBr, runsToEnd, noEol) {
  let f = ''; let p = '';
  if (tier === 2 && oLines.length > 0) { f = leadWS(fileLines[pos]); p = leadWS(oLines[0]); }
  const rep = nParts.map((part) => {
    if (part.ctx >= 0) return fileLines[pos + part.ctx];
    let s = part.text;
    if (tier === 2 && s !== '' && s.replace(/[ \t]/g, '') !== '' && s.startsWith(p)) s = f + s.slice(p.length);
    return s;
  });
  const out = [...fileLines.slice(0, pos), ...rep, ...fileLines.slice(pos + oLines.length)];
  return { lines: out, finalBr: runsToEnd ? !noEol : finalBr };
}
function fileText(f) {
  return f.lines.length === 0 ? '' : f.lines.join(f.br) + (f.finalBr ? f.br : '');
}

function runCase(files, argv, stdin) {
  const dir = mkdtempSync(join(tmpdir(), 'mend-fuzz-'));
  try {
    for (const [p, text] of Object.entries(files)) {
      const fp = join(dir, ...p.split('/'));
      mkdirSync(dirname(fp), { recursive: true });
      writeFileSync(fp, text);
    }
    const res = spawnSync(process.execPath, [MAIN, ...argv], { cwd: dir, input: stdin ?? '', encoding: 'utf8', timeout: 10000 });
    const out = {};
    const walk = (d) => {
      for (const name of readdirSync(d)) {
        const p = join(d, name);
        if (statSync(p).isDirectory()) walk(p);
        else out[relative(dir, p).split(sep).join('/')] = readFileSync(p, 'utf8');
      }
    };
    walk(dir);
    return { exit: res.status, stdout: res.stdout ?? '', stderr: res.stderr ?? '', files: out };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

let total = 0;
let mismatches = 0;
let invariantFails = 0;
const mismatchSamples = [];
function recordMismatch(kind, detail, context) {
  mismatches += 1;
  if (mismatchSamples.length < 5) mismatchSamples.push(`${kind}: ${detail}\n${context}`);
}

for (let n = 0; n < COUNT; n += 1) {
  total += 1;
  const kind = n % 4; // 0 unified, 1 sr, 2 v4a, 3 json
  const f = randFile();
  const files = { 'f.txt': f.text };
  let patch = '';
  let argv = ['-'];
  let expectedFiles = null;
  let expectedExit = 0;
  let expectedStdout = null;
  const mutate = r() < 0.2;
  try {
    if (kind === 0) {
      // unified: one hunk replacing a unique span
      if (f.lines.length === 0) { n -= 1; total -= 1; continue; }
      const spanLen = 1 + ri(Math.min(3, f.lines.length));
      const s = ri(f.lines.length - spanLen + 1);
      const oLines = f.lines.slice(s, s + spanLen);
      if (occurrences(f.lines, oLines).occ.length !== 1) { n -= 1; total -= 1; continue; }
      const ctxBefore = r() < 0.6 && s > 0 ? [f.lines[s - 1]] : [];
      const ctxAfter = r() < 0.6 && s + spanLen < f.lines.length ? [f.lines[s + spanLen]] : [];
      const newLines = Array.from({ length: ri(4) }, () => randLine());
      const drift = pick(['none', 'trail', 'indent']);
      const driftLine = (l) => {
        if (drift === 'trail') return stripTrail(l) + pick([' ', '  ', '\t']);
        if (drift === 'indent') return pick(['  ', '    ', '\t']) + stripBoth(l);
        return l;
      };
      const bodyO = [...ctxBefore, ...oLines, ...ctxAfter].map(driftLine);
      const body = [];
      ctxBefore.forEach((l, i) => body.push(` ${bodyO[i]}`));
      oLines.forEach((l, i) => body.push(`-${bodyO[ctxBefore.length + i]}`));
      newLines.forEach((l) => body.push(`+${l}`));
      ctxAfter.forEach((l, i) => body.push(` ${bodyO[ctxBefore.length + oLines.length + i]}`));
      const a = s + 1 + ctxBefore.length + (r() < 0.4 ? pick([-3, -2, 2, 5, 40]) : 0);
      const patchA = Math.max(1, a);
      const runsToEnd = s + spanLen + ctxAfter.length === f.lines.length;
      const noEol = runsToEnd && !f.finalBr && r() < 0.7;
      if (noEol) body.push('\\ No newline at end of file');
      // SPEC 6: the marker only clears the final break when it follows the hunk's
      // last context or + line (not a - line).
      let lastCN = -1;
      for (let i = 0; i < body.length; i += 1) {
        if (body[i].startsWith(' ') || body[i].startsWith('+')) lastCN = i;
      }
      const noEolEff = lastCN >= 0 && body[lastCN + 1] !== undefined && body[lastCN + 1].startsWith('\\');
      patch = `--- a/f.txt\n+++ b/f.txt\n@@ -${patchA},${spanLen + ctxBefore.length + ctxAfter.length} +${patchA},${ctxBefore.length + newLines.length + ctxAfter.length} @@\n${body.join('\n')}\n`;
      const fullO = bodyO;
      const found = occurrences(f.lines, fullO);
      if (found === null) { n -= 1; total -= 1; continue; }
      // nearest occurrence to A-1 (d = 0, single hunk), ties -> earlier: same rule as main.ts
      let pos = found.occ[0];
      let bestDist = Math.abs(pos - (patchA - 1));
      for (const p of found.occ) {
        const dist = Math.abs(p - (patchA - 1));
        if (dist < bestDist) { pos = p; bestDist = dist; }
      }
      const nParts = [];
      ctxBefore.forEach((l, i) => nParts.push({ text: l, ctx: i }));
      newLines.forEach((l) => nParts.push({ text: l, ctx: -1 }));
      ctxAfter.forEach((l, i) => nParts.push({ text: l, ctx: ctxBefore.length + oLines.length + i }));
      const exp = expectedReplace(f.lines, pos, fullO, nParts, found.tier, f.finalBr, runsToEnd, noEolEff);
      expectedFiles = { 'f.txt': fileText({ ...f, lines: exp.lines, finalBr: exp.finalBr }) };
      expectedStdout = expectedFiles['f.txt'] === f.text ? 'ok: 0 files\n' : 'M f.txt\nok: 1 file\n';
    } else if (kind === 1) {
      // search-replace: one block, unique span (or a create)
      if (r() < 0.15 || f.lines.length === 0) {
        const newLines = Array.from({ length: 1 + ri(3) }, () => randLine());
        patch = `new.txt\n<<<<<<< SEARCH\n=======\n${newLines.join('\n')}\n>>>>>>> REPLACE\n`;
        expectedFiles = { 'f.txt': f.text, 'new.txt': `${newLines.join('\n')}\n` };
        expectedStdout = 'A new.txt\nok: 1 file\n';
      } else {
        const spanLen = 1 + ri(Math.min(3, f.lines.length));
        const s = ri(f.lines.length - spanLen + 1);
        const oLines = f.lines.slice(s, s + spanLen);
        if (occurrences(f.lines, oLines).occ.length !== 1) { n -= 1; total -= 1; continue; }
        const newLines = Array.from({ length: ri(4) }, () => randLine());
        const drifted = oLines.map((l) => (r() < 0.5 ? `${stripTrail(l)} ` : l));
        const newPart = newLines.length > 0 ? `${newLines.join('\n')}\n` : '';
        patch = `f.txt\n<<<<<<< SEARCH\n${drifted.join('\n')}\n=======\n${newPart}>>>>>>> REPLACE\n`;
        const found = occurrences(f.lines, drifted);
        if (found === null || found.occ.length !== 1) { n -= 1; total -= 1; continue; }
        const nParts = newLines.map((l) => ({ text: l, ctx: -1 }));
        const exp = expectedReplace(f.lines, found.occ[0], drifted, nParts, found.tier, f.finalBr, false, false);
        expectedFiles = { 'f.txt': fileText({ ...f, lines: exp.lines, finalBr: exp.finalBr }) };
        expectedStdout = expectedFiles['f.txt'] === f.text ? 'ok: 0 files\n' : 'M f.txt\nok: 1 file\n';
      }
    } else if (kind === 2) {
      // v4a: one update chunk, optional anchor
      if (f.lines.length === 0) { n -= 1; total -= 1; continue; }
      const spanLen = 1 + ri(Math.min(3, f.lines.length));
      const s = ri(f.lines.length - spanLen + 1);
      const oLines = f.lines.slice(s, s + spanLen);
      if (occurrences(f.lines, oLines, 0).occ.length !== 1) { n -= 1; total -= 1; continue; }
      const ctxBefore = r() < 0.5 && s > 0 ? [f.lines[s - 1]] : [];
      const newLines = Array.from({ length: ri(4) }, () => randLine());
      const anchor = s > 0 && r() < 0.6 ? f.lines[s - 1] : null;
      const drifted = [...ctxBefore, ...oLines].map((l) => (r() < 0.4 ? `  ${stripBoth(l)}` : l));
      const body = [];
      ctxBefore.forEach((l, i) => body.push(` ${drifted[i]}`));
      oLines.forEach((l, i) => body.push(`-${drifted[ctxBefore.length + i]}`));
      newLines.forEach((l) => body.push(`+${l}`));
      const anchorLine = anchor !== null ? `@@ ${anchor}\n` : '';
      patch = `*** Begin Patch\n*** Update File: f.txt\n${anchorLine}${body.join('\n')}\n*** End Patch\n`;
      const fullO = drifted;
      const from = anchor !== null ? f.lines.indexOf(anchor) + 1 : 0;
      const found = occurrences(f.lines, fullO, from);
      if (found === null || found.occ[0] !== s - ctxBefore.length) { n -= 1; total -= 1; continue; }
      const nParts = [];
      ctxBefore.forEach((l, i) => nParts.push({ text: l, ctx: i }));
      newLines.forEach((l) => nParts.push({ text: l, ctx: -1 }));
      const exp = expectedReplace(f.lines, s - ctxBefore.length, fullO, nParts, found.tier, f.finalBr, false, false);
      expectedFiles = { 'f.txt': fileText({ ...f, lines: exp.lines, finalBr: exp.finalBr }) };
      expectedStdout = expectedFiles['f.txt'] === f.text ? 'ok: 0 files\n' : 'M f.txt\nok: 1 file\n';
    } else {
      // json: str_replace on a unique line, or insert, or create
      const mode = r();
      if (mode < 0.5 && f.lines.length > 0) {
        const s = ri(f.lines.length);
        const oldStr = f.lines[s];
        const count = f.text.split(oldStr).length - 1;
        if (count !== 1 || oldStr === '') { n -= 1; total -= 1; continue; }
        const newStr = randLine();
        patch = `${JSON.stringify({ command: 'str_replace', path: 'f.txt', old_str: oldStr, new_str: newStr })}\n`;
        // expected: string replace in the LF-normalised text, CRLF preserved by the tool
        let expText;
        if (f.br === '\r\n') {
          const lf = f.text.replaceAll('\r\n', '\n');
          expText = lf.replace(oldStr, newStr).replaceAll('\n', '\r\n');
        } else expText = f.text.replace(oldStr, newStr);
        expectedFiles = { 'f.txt': expText };
        expectedStdout = expText === f.text ? 'ok: 0 files\n' : 'M f.txt\nok: 1 file\n';
      } else if (mode < 0.8 && f.lines.length > 0) {
        const at = ri(f.lines.length + 1);
        const add = randLine();
        patch = `${JSON.stringify({ command: 'insert', path: 'f.txt', insert_line: at, new_str: add })}\n`;
        const lines = [...f.lines];
        lines.splice(at, 0, add);
        expectedFiles = { 'f.txt': fileText({ ...f, lines }) };
        expectedStdout = 'M f.txt\nok: 1 file\n';
      } else {
        const txt = `${randLine()}\n${randLine()}`;
        patch = `${JSON.stringify({ command: 'create', path: 'new.txt', file_text: txt })}\n`;
        expectedFiles = { 'f.txt': f.text, 'new.txt': txt };
        expectedStdout = 'A new.txt\nok: 1 file\n';
      }
    }
  } catch (e) {
    n -= 1; total -= 1; continue;
  }
  if (mutate) {
    // Corrupt the patch: delete or duplicate a random line. Expect exit 1 or 2
    // and, on exit 1, no file changes at all (atomicity). Exit 0 is possible for
    // benign mutations; then only determinism is checked.
    const plines = patch.split('\n');
    const at = ri(plines.length);
    if (r() < 0.5) plines.splice(at, 1);
    else plines.splice(at, 0, plines[at] ?? '');
    patch = plines.join('\n');
    expectedFiles = null;
    expectedExit = -1;
  }
  const got = runCase(files, argv, patch);
  if (got.exit === 124 || got.exit === null || (got.stderr ?? '').includes('node:internal')) {
    invariantFails += 1;
    if (mismatchSamples.length < 5) mismatchSamples.push(`CRASH kind=${kind} exit=${got.exit} stderr=${(got.stderr ?? '').slice(0, 300)}\npatch=${JSON.stringify(patch)}\nfiles=${JSON.stringify(files)}`);
    continue;
  }
  if (expectedExit === 0) {
    if (got.exit !== 0 || got.stdout !== expectedStdout || JSON.stringify(got.files) !== JSON.stringify(expectedFiles)) {
      recordMismatch(`kind=${kind} expected-exit-0`, `exit ${got.exit} (want 0), stdout ${JSON.stringify(got.stdout)} (want ${JSON.stringify(expectedStdout)})`, `patch=${JSON.stringify(patch)}\norig=${JSON.stringify(files)}\nwantFiles=${JSON.stringify(expectedFiles)}\ngotFiles=${JSON.stringify(got.files)}`);
    }
  } else {
    if (got.exit === 1) {
      if (JSON.stringify(got.files) !== JSON.stringify(files)) {
        invariantFails += 1;
        if (mismatchSamples.length < 5) mismatchSamples.push(`ATOMICITY kind=${kind}: exit 1 but files changed\npatch=${JSON.stringify(patch)}\norig=${JSON.stringify(files)}\ngot=${JSON.stringify(got.files)}`);
      }
    } else if (got.exit !== 0 && got.exit !== 2) {
      invariantFails += 1;
      if (mismatchSamples.length < 5) mismatchSamples.push(`BAD EXIT kind=${kind}: ${got.exit}\npatch=${JSON.stringify(patch)}`);
    }
  }
  if (n % 10 === 0) {
    const got2 = runCase(files, argv, patch);
    if (got2.exit !== got.exit || got2.stdout !== got.stdout || JSON.stringify(got2.files) !== JSON.stringify(got.files)) {
      invariantFails += 1;
      if (mismatchSamples.length < 5) mismatchSamples.push(`NON-DETERMINISTIC kind=${kind}\npatch=${JSON.stringify(patch)}`);
    }
  }
}

process.stdout.write(`fuzz: ${total} cases, expected-model mismatches ${mismatches}, invariant failures ${invariantFails}\n`);
for (const s of mismatchSamples) process.stdout.write(`---\n${s}\n`);
if (mismatches > 0 || invariantFails > 0) process.exitCode = 1;
