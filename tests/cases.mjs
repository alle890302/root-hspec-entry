// Targeted cases for SPEC.md sentences the practice set underweights.
// Each case: { name, files, argv, stdin, expect: { exit, stdout, files } }.
// `files` in expect is the FULL resulting tree (missing key = deleted).
// Run: node tests/cases.mjs
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, statSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const MAIN = join(dirname(fileURLToPath(import.meta.url)), '..', 'main.ts');

const cases = [];
const C = (name, files, argv, stdin, exit, stdout, outFiles) =>
  cases.push({ name, files, argv, stdin, expect: { exit, stdout, files: outFiles } });

// ---------- unified ----------
C('U1 noeol-add-end', { 'f.txt': 'a\nb\nc' }, ['-'],
  '--- a/f.txt\n+++ b/f.txt\n@@ -3,1 +3,2 @@\n c\n+d\n\\ No newline at end of file\n',
  0, 'M f.txt\nok: 1 file\n', { 'f.txt': 'a\nb\nc\nd' });
C('U2 noeol-add-end-with-break', { 'f.txt': 'a\nb\nc' }, ['-'],
  '--- a/f.txt\n+++ b/f.txt\n@@ -3,1 +3,2 @@\n c\n+d\n',
  0, 'M f.txt\nok: 1 file\n', { 'f.txt': 'a\nb\nc\nd\n' });
C('U3 noeol-remove-tail', { 'f.txt': 'a\nb\nc' }, ['-'],
  '--- a/f.txt\n+++ b/f.txt\n@@ -3,1 +2,0 @@\n-c\n\\ No newline at end of file\n',
  0, 'M f.txt\nok: 1 file\n', { 'f.txt': 'a\nb\n' });
C('U4 noeol-create', {}, ['-'],
  'diff --git a/n.txt b/n.txt\nnew file mode 100644\n--- /dev/null\n+++ b/n.txt\n@@ -0,0 +1,2 @@\n+one\n+two\n\\ No newline at end of file\n',
  0, 'A n.txt\nok: 1 file\n', { 'n.txt': 'one\ntwo' });
C('U5 noeol-create-with-break', {}, ['-'],
  'diff --git a/n.txt b/n.txt\nnew file mode 100644\n--- /dev/null\n+++ b/n.txt\n@@ -0,0 +1,2 @@\n+one\n+two\n',
  0, 'A n.txt\nok: 1 file\n', { 'n.txt': 'one\ntwo\n' });
C('U6 insert-beyond-end', { 'f.txt': 'a\nb\nc\n' }, ['-'],
  '--- a/f.txt\n+++ b/f.txt\n@@ -99,0 +100,1 @@\n+x\n',
  0, 'M f.txt\nok: 1 file\n', { 'f.txt': 'a\nb\nc\nx\n' });
C('U7 insert-top', { 'f.txt': 'a\nb\n' }, ['-'],
  '--- a/f.txt\n+++ b/f.txt\n@@ -0,0 +1,1 @@\n+x\n',
  0, 'M f.txt\nok: 1 file\n', { 'f.txt': 'x\na\nb\n' });
C('U8 nearest-tie-earlier', { 'f.txt': 'p\nq\ncommon\nr\ns\nt\nu\nv\ncommon\nz\n' }, ['-'],
  '--- a/f.txt\n+++ b/f.txt\n@@ -6,1 +6,1 @@\n-common\n+CHANGED\n',
  0, 'M f.txt\nok: 1 file\n', { 'f.txt': 'p\nq\nCHANGED\nr\ns\nt\nu\nv\ncommon\nz\n' });
C('U9 multi-hunk-d', { 'f.txt': 'q\nB\nr\nF\ns\nF\nt\n' }, ['-'],
  '--- a/f.txt\n+++ b/f.txt\n@@ -2,1 +2,2 @@\n B\n+B2\n@@ -6,1 +6,1 @@\n-F\n+F2\n',
  0, 'M f.txt\nok: 1 file\n', { 'f.txt': 'q\nB\nB2\nr\nF\ns\nF2\nt\n' });
C('U10 parse-bad-hunk', { 'f.txt': 'a\n' }, ['-'],
  '--- a/f.txt\n+++ b/f.txt\n@@ -x +y @@\n-a\n+b\n',
  2, 'error: parse 3\n', { 'f.txt': 'a\n' });
C('U11 parse-hunk-before-section', { 'f.txt': 'a\n' }, ['--format=unified', '-'],
  '@@ -1 +1 @@\n-a\n+b\n',
  2, 'error: parse 1\n', { 'f.txt': 'a\n' });
C('U12 parse-bare-dash', { 'x': 'a\n' }, ['-'],
  'diff --git a/x b/x\n--- a/x\n@@ -1 +1 @@\n-a\n+b\n',
  2, 'error: parse 3\n', { 'x': 'a\n' });
C('U13 parse-bad-diffgit', { 'x': 'a\n' }, ['-'],
  'diff --git a/x\n@@ -1 +1 @@\n-a\n+b\n',
  2, 'error: parse 1\n', { 'x': 'a\n' });
C('U14 rename-diff-only', { 'old.txt': 'a\nb\n' }, ['-'],
  'diff --git a/old.txt b/new.txt\nrename from old.txt\nrename to new.txt\n@@ -2,1 +2,1 @@\n-b\n+B\n',
  0, 'R old.txt -> new.txt\nok: 1 file\n', { 'old.txt': null, 'new.txt': 'a\nB\n' });
C('U15 new-file-mode-no-headers', {}, ['-'],
  'diff --git a/n.txt b/n.txt\nnew file mode 100644\n@@ -0,0 +1,2 @@\n+one\n+two\n',
  0, 'A n.txt\nok: 1 file\n', { 'n.txt': 'one\ntwo\n' });
C('U16 deleted-file-mode-hunks-not-read', { 'o.txt': 'zzz\n' }, ['-'],
  'diff --git a/o.txt b/o.txt\ndeleted file mode 100644\n@@ -1,1 +0,0 @@\n-not-in-file\n',
  0, 'D o.txt\nok: 1 file\n', { 'o.txt': null });
C('U17 move-new-exists', { 'a.txt': 'a\n', 'b.txt': 'b\n' }, ['-'],
  'diff --git a/a.txt b/b.txt\nrename from a.txt\nrename to b.txt\n@@ -1,1 +1,1 @@\n-a\n+A\n',
  1, 'error: exists b.txt\nfailed: 1 of 1 edits\n', { 'a.txt': 'a\n', 'b.txt': 'b\n' });
C('U18 move-missing', {}, ['-'],
  'diff --git a/a.txt b/b.txt\nrename from a.txt\nrename to b.txt\n@@ -1,1 +1,1 @@\n-a\n+A\n',
  1, 'error: missing a.txt\nfailed: 1 of 1 edits\n', {});
C('U19 unsafe-dotdot', {}, ['-'],
  '--- ../x\n+++ ../x\n@@ -1 +1 @@\n-a\n+b\n',
  1, 'error: unsafe ../x\nfailed: 1 of 1 edits\n', {});
C('U20 unsafe-abs', {}, ['-'],
  '--- /abs/x\n+++ /abs/x\n@@ -1 +1 @@\n-a\n+b\n',
  1, 'error: unsafe /abs/x\nfailed: 1 of 1 edits\n', {});
C('U21 unsafe-backslash', {}, ['-'],
  '--- a\\b\n+++ a\\b\n@@ -1 +1 @@\n-a\n+b\n',
  1, 'error: unsafe a\\b\nfailed: 1 of 1 edits\n', {});
C('U22 create-exists', { 'n.txt': 'old\n' }, ['-'],
  'diff --git a/n.txt b/n.txt\nnew file mode 100644\n--- /dev/null\n+++ b/n.txt\n@@ -0,0 +1,1 @@\n+new\n',
  1, 'error: exists n.txt\nfailed: 1 of 1 edits\n', { 'n.txt': 'old\n' });
C('U23 change-missing', {}, ['-'],
  '--- a/gone.txt\n+++ b/gone.txt\n@@ -1 +1 @@\n-a\n+b\n',
  1, 'error: missing gone.txt\nfailed: 1 of 1 edits\n', {});
C('U24 noop-change-no-hunks', { 'f.txt': 'a\n' }, ['-'],
  'diff --git a/f.txt b/f.txt\n--- a/f.txt\n+++ b/f.txt\n',
  0, 'ok: 0 files\n', { 'f.txt': 'a\n' });
C('U25 crlf-hunk', { 'f.txt': 'a\r\nb\r\nc\r\n' }, ['-'],
  '--- a/f.txt\n+++ b/f.txt\n@@ -2,1 +2,1 @@\n-b\n+B\n',
  0, 'M f.txt\nok: 1 file\n', { 'f.txt': 'a\r\nB\r\nc\r\n' });
C('U26 no-final-hunk-middle', { 'f.txt': 'a\nb\nc' }, ['-'],
  '--- a/f.txt\n+++ b/f.txt\n@@ -1,1 +1,1 @@\n-a\n+A\n',
  0, 'M f.txt\nok: 1 file\n', { 'f.txt': 'A\nb\nc' });
C('U27 empty-file-insert', { 'f.txt': '' }, ['-'],
  '--- a/f.txt\n+++ b/f.txt\n@@ -0,0 +1,1 @@\n+x\n',
  0, 'M f.txt\nok: 1 file\n', { 'f.txt': 'x\n' });
C('U28 empty-file-nomatch', { 'f.txt': '' }, ['-'],
  '--- a/f.txt\n+++ b/f.txt\n@@ -1,1 +1,1 @@\n-x\n+y\n',
  1, 'error: no-match f.txt\nfailed: 1 of 1 edits\n', { 'f.txt': '' });
C('U29 strict-tier1-fail', { 'f.txt': 'keep 1 \nkeep 2\n' }, ['--strict', '-'],
  '--- a/f.txt\n+++ b/f.txt\n@@ -1,1 +1,1 @@\n-keep 1\n+keep 9\n',
  1, 'error: no-match f.txt\nfailed: 1 of 1 edits\n', { 'f.txt': 'keep 1 \nkeep 2\n' });
C('U30 format-force-json', { 'f.txt': 'a\n' }, ['--format=json', '-'],
  '--- a/f.txt\n+++ b/f.txt\n@@ -1 +1 @@\n-a\n+b\n',
  2, 'error: parse 1\n', { 'f.txt': 'a\n' });
C('U31 check-no-write', { 'f.txt': 'a\nb\n' }, ['--check', '-'],
  '--- a/f.txt\n+++ b/f.txt\n@@ -1,1 +1,1 @@\n-a\n+A\n',
  0, 'M f.txt\nok: 1 file\n', { 'f.txt': 'a\nb\n' });
C('U32a usage-dup-check', {}, ['--check', '--check', '-'], '', 2, 'error: usage\n', {});
C('U32b usage-dup-format', {}, ['--format=unified', '--format=json', '-'], '', 2, 'error: usage\n', {});
C('U32c usage-bogus', {}, ['--bogus', '-'], '', 2, 'error: usage\n', {});
C('U32d usage-two-pos', {}, ['a.patch', 'b.patch'], '', 2, 'error: usage\n', {});
C('U32e usage-bad-format', {}, ['--format=git', '-'], '', 2, 'error: usage\n', {});
C('U33 no-patch', {}, ['missing.patch'], null, 2, 'error: no-patch\n', {});
C('U34 format-error-prose', {}, ['-'], 'just some prose\nnothing here\n', 2, 'error: format\n', {});
C('U35 parse1-empty-forced', {}, ['--format=unified', '-'], '', 2, 'error: parse 1\n', {});
C('U37 tab-in-path', { 'f.txt': 'a\n' }, ['-'],
  '--- a/f.txt\t2026-01-01\n+++ b/f.txt\t2026-01-01\n@@ -1,1 +1,1 @@\n-a\n+A\n',
  0, 'M f.txt\nok: 1 file\n', { 'f.txt': 'A\n' });
C('U38 hunk-context-blank', { 'f.txt': 'top\n\nold\nbottom\n' }, ['-'],
  '--- a/f.txt\n+++ b/f.txt\n@@ -1,4 +1,4 @@\n top\n\n-old\n+new\n bottom\n',
  0, 'M f.txt\nok: 1 file\n', { 'f.txt': 'top\n\nnew\nbottom\n' });
C('U39 overlapping-occurrences', { 'f.txt': 'a\na\na\n' }, ['-'],
  '--- a/f.txt\n+++ b/f.txt\n@@ -1,2 +1,2 @@\n-a\n-a\n+X\n+Y\n',
  0, 'M f.txt\nok: 1 file\n', { 'f.txt': 'X\nY\na\n' });
C('U40 move-hunk-fail-atomic', { 'a.txt': 'a\n' }, ['-'],
  'diff --git a/a.txt b/b.txt\nrename from a.txt\nrename to b.txt\n@@ -1,1 +1,1 @@\n-nope\n+y\n',
  1, 'error: no-match a.txt\nfailed: 1 of 1 edits\n', { 'a.txt': 'a\n' });
C('U41 multi-section-atomic', { 'a.txt': 'a\n', 'b.txt': 'b\n' }, ['-'],
  '--- a/a.txt\n+++ b/a.txt\n@@ -1,1 +1,1 @@\n-a\n+A\n--- a/b.txt\n+++ b/b.txt\n@@ -1,1 +1,1 @@\n-nope\n+B\n',
  1, 'error: no-match b.txt\nfailed: 1 of 2 edits\n', { 'a.txt': 'a\n', 'b.txt': 'b\n' });
C('U42 tier2-reindent-nostart', { 'f.txt': '    x\n    y\n' }, ['-'],
  '--- a/f.txt\n+++ b/f.txt\n@@ -1,2 +1,2 @@\n   x\n-  y\n+z\n',
  0, 'M f.txt\nok: 1 file\n', { 'f.txt': '    x\nz\n' });

// ---------- search-replace ----------
C('S1 path-inherit', { 'f.txt': 'one\ntwo\n' }, ['p.txt'],
  null, 0, 'M f.txt\nok: 1 file\n', { 'f.txt': 'ONE\nTWO\n' });
// placeholder replaced below (files carry the patch)
cases[cases.length - 1].files['p.txt'] =
  'f.txt\n<<<<<<< SEARCH\none\n=======\nONE\n>>>>>>> REPLACE\n\n<<<<<<< SEARCH\ntwo\n=======\nTWO\n>>>>>>> REPLACE\n';
C('S2 marker-trailing-ws', { 'f.txt': 'one\n' }, ['p.txt'],
  null, 0, 'M f.txt\nok: 1 file\n', { 'f.txt': 'ONE\n' });
cases[cases.length - 1].files['p.txt'] = 'f.txt\n<<<<<<< SEARCH   \none\n=======  \nONE\n>>>>>>> REPLACE\t\n';
C('S3 create-exists', { 'f.txt': 'old\n' }, ['p.txt'],
  null, 1, 'error: exists f.txt\nfailed: 1 of 1 edits\n', { 'f.txt': 'old\n' });
cases[cases.length - 1].files['p.txt'] = 'f.txt\n<<<<<<< SEARCH\n=======\nnew\n>>>>>>> REPLACE\n';
C('S4 create-new', {}, ['p.txt'],
  null, 0, 'A f.txt\nok: 1 file\n', { 'f.txt': 'l1\nl2\n' });
cases[cases.length - 1].files['p.txt'] = 'sub/f.txt\n<<<<<<< SEARCH\n=======\nl1\nl2\n>>>>>>> REPLACE\n';
cases[cases.length - 1].expect.files = { 'sub/f.txt': 'l1\nl2\n' };
cases[cases.length - 1].expect.stdout = 'A sub/f.txt\nok: 1 file\n';
C('S5 create-empty-new', {}, ['p.txt'],
  null, 0, 'A f.txt\nok: 1 file\n', { 'f.txt': '' });
cases[cases.length - 1].files['p.txt'] = 'f.txt\n<<<<<<< SEARCH\n=======\n>>>>>>> REPLACE\n';
C('S6 ambiguous-tier1', { 'f.txt': 'keep 1  \nkeep 1\t\n' }, ['p.txt'],
  null, 1, 'error: ambiguous f.txt\nfailed: 1 of 1 edits\n', { 'f.txt': 'keep 1  \nkeep 1\t\n' });
cases[cases.length - 1].files['p.txt'] = 'f.txt\n<<<<<<< SEARCH\nkeep 1\n=======\nkeep 2\n>>>>>>> REPLACE\n';
C('S7a sr-nomatch', { 'f.txt': 'a\n' }, ['p.txt'],
  null, 1, 'error: no-match f.txt\nfailed: 1 of 1 edits\n', { 'f.txt': 'a\n' });
cases[cases.length - 1].files['p.txt'] = 'f.txt\n<<<<<<< SEARCH\nzzz\n=======\ny\n>>>>>>> REPLACE\n';
C('S7b sr-missing', {}, ['p.txt'],
  null, 1, 'error: missing f.txt\nfailed: 1 of 1 edits\n', {});
cases[cases.length - 1].files['p.txt'] = 'f.txt\n<<<<<<< SEARCH\nzzz\n=======\ny\n>>>>>>> REPLACE\n';
C('S7c sr-unsafe', {}, ['p.txt'],
  null, 1, 'error: unsafe ../f.txt\nfailed: 1 of 1 edits\n', {});
cases[cases.length - 1].files['p.txt'] = '../f.txt\n<<<<<<< SEARCH\nzzz\n=======\ny\n>>>>>>> REPLACE\n';
C('S8 sr-no-separator', { 'f.txt': 'a\n' }, ['p.txt'],
  null, 2, 'error: parse 2\n', { 'f.txt': 'a\n' });
cases[cases.length - 1].files['p.txt'] = 'f.txt\n<<<<<<< SEARCH\na\n>>>>>>> REPLACE\n';
C('S9 sr-no-end', { 'f.txt': 'a\n' }, ['p.txt'],
  null, 2, 'error: parse 2\n', { 'f.txt': 'a\n' });
cases[cases.length - 1].files['p.txt'] = 'f.txt\n<<<<<<< SEARCH\na\n=======\nb\n';
C('S10 sr-first-no-path', { 'f.txt': 'a\n' }, ['p.txt'],
  null, 2, 'error: parse 1\n', { 'f.txt': 'a\n' });
cases[cases.length - 1].files['p.txt'] = '<<<<<<< SEARCH\na\n=======\nb\n>>>>>>> REPLACE\n';
C('S11 sr-crlf', { 'f.txt': 'a\r\nb\r\n' }, ['p.txt'],
  null, 0, 'M f.txt\nok: 1 file\n', { 'f.txt': 'a\r\nB\r\n' });
cases[cases.length - 1].files['p.txt'] = 'f.txt\n<<<<<<< SEARCH\nb\n=======\nB\n>>>>>>> REPLACE\n';
C('S12 sr-delete-all', { 'f.txt': 'a\nb\n' }, ['p.txt'],
  null, 0, 'M f.txt\nok: 1 file\n', { 'f.txt': '' });
cases[cases.length - 1].files['p.txt'] = 'f.txt\n<<<<<<< SEARCH\na\nb\n=======\n>>>>>>> REPLACE\n';
C('S13 sr-sequential', { 'f.txt': 'one\ntwo\n' }, ['p.txt'],
  null, 0, 'M f.txt\nok: 1 file\n', { 'f.txt': 'ONE\nTWO\n' });
cases[cases.length - 1].files['p.txt'] =
  'f.txt\n<<<<<<< SEARCH\none\n=======\nONE\n>>>>>>> REPLACE\n\nf.txt\n<<<<<<< SEARCH\nONE\n=======\nONE\n>>>>>>> REPLACE\n';
cases[cases.length - 1].expect.files = { 'f.txt': 'ONE\ntwo\n' };
C('S14 sr-strict', { 'f.txt': 'keep 1 \n' }, ['--strict', 'p.txt'],
  null, 1, 'error: no-match f.txt\nfailed: 1 of 1 edits\n', { 'f.txt': 'keep 1 \n' });
cases[cases.length - 1].files['p.txt'] = 'f.txt\n<<<<<<< SEARCH\nkeep 1\n=======\nkeep 2\n>>>>>>> REPLACE\n';
C('S15 sr-path-fence', { 'f.txt': 'a\nb\n' }, ['p.txt'],
  null, 0, 'M f.txt\nok: 1 file\n', { 'f.txt': 'a\nB\n' });
cases[cases.length - 1].files['p.txt'] = 'f.txt\n```txt\n<<<<<<< SEARCH\nb\n=======\nB\n>>>>>>> REPLACE\n```\n';
C('S16 sr-new-trailing-ws', { 'f.txt': 'a\n' }, ['p.txt'],
  null, 0, 'M f.txt\nok: 1 file\n', { 'f.txt': 'new   \n' });
cases[cases.length - 1].files['p.txt'] = 'f.txt\n<<<<<<< SEARCH\na\n=======\nnew   \n>>>>>>> REPLACE\n';

// ---------- v4a ----------
C('V1 missing-begin', { 'f.txt': 'a\n' }, ['--format=v4a', 'p.txt'],
  null, 2, 'error: parse 1\n', { 'f.txt': 'a\n' });
cases[cases.length - 1].files['p.txt'] = '*** Update File: f.txt\n a\n-b\n+c\n*** End Patch\n';
C('V2 missing-end', { 'f.txt': 'a\nb\n' }, ['p.txt'],
  null, 2, 'error: parse 4\n', { 'f.txt': 'a\nb\n' });
cases[cases.length - 1].files['p.txt'] = '*** Begin Patch\n*** Update File: f.txt\n a\n';
C('V3 trailing-junk-after-end', { 'f.txt': 'a\n' }, ['p.txt'],
  null, 2, 'error: parse 6\n', { 'f.txt': 'a\n' });
cases[cases.length - 1].files['p.txt'] = '*** Begin Patch\n*** Update File: f.txt\n a\n*** End Patch\njunk\n';
C('V4 add-empty-lines', {}, ['p.txt'],
  null, 0, 'A f.txt\nok: 1 file\n', { 'f.txt': 'a\n\nb\n' });
cases[cases.length - 1].files['p.txt'] = '*** Begin Patch\n*** Add File: f.txt\n+a\n+\n+b\n*** End Patch\n';
C('V5a add-exists', { 'f.txt': 'old\n' }, ['p.txt'],
  null, 1, 'error: exists f.txt\nfailed: 1 of 1 edits\n', { 'f.txt': 'old\n' });
cases[cases.length - 1].files['p.txt'] = '*** Begin Patch\n*** Add File: f.txt\n+new\n*** End Patch\n';
C('V5b delete-missing', {}, ['p.txt'],
  null, 1, 'error: missing f.txt\nfailed: 1 of 1 edits\n', {});
cases[cases.length - 1].files['p.txt'] = '*** Begin Patch\n*** Delete File: f.txt\n*** End Patch\n';
C('V6 update-no-chunk', { 'f.txt': 'a\n' }, ['p.txt'],
  null, 2, 'error: parse 2\n', { 'f.txt': 'a\n' });
cases[cases.length - 1].files['p.txt'] = '*** Begin Patch\n*** Update File: f.txt\n\n*** End Patch\n';
C('V7 update-move-only', { 'a.txt': 'a\nb\n' }, ['p.txt'],
  null, 0, 'R a.txt -> b.txt\nok: 1 file\n', { 'a.txt': null, 'b.txt': 'a\nb\n' });
cases[cases.length - 1].files['p.txt'] = '*** Begin Patch\n*** Update File: a.txt\n*** Move to: b.txt\n*** End Patch\n';
C('V8 move-exists', { 'a.txt': 'a\n', 'b.txt': 'b\n' }, ['p.txt'],
  null, 1, 'error: exists b.txt\nfailed: 1 of 1 edits\n', { 'a.txt': 'a\n', 'b.txt': 'b\n' });
cases[cases.length - 1].files['p.txt'] = '*** Begin Patch\n*** Update File: a.txt\n*** Move to: b.txt\n*** End Patch\n';
C('V9 anchor-nomatch', { 'f.txt': 'a\nb\n' }, ['p.txt'],
  null, 1, 'error: no-match f.txt\nfailed: 1 of 1 edits\n', { 'f.txt': 'a\nb\n' });
cases[cases.length - 1].files['p.txt'] = '*** Begin Patch\n*** Update File: f.txt\n@@ nope\n-a\n+A\n*** End Patch\n';
C('V10 anchor-tier2', { 'f.txt': '  def f():\n    x\n' }, ['p.txt'],
  null, 0, 'M f.txt\nok: 1 file\n', { 'f.txt': '  def f():\n    y\n' });
cases[cases.length - 1].files['p.txt'] = '*** Begin Patch\n*** Update File: f.txt\n@@ def f():\n-    x\n+    y\n*** End Patch\n';
C('V11 cursor-past-occurrence', { 'f.txt': 'a\nb\na\nb\n' }, ['p.txt'],
  null, 1, 'error: no-match f.txt\nfailed: 1 of 1 edits\n', { 'f.txt': 'a\nb\na\nb\n' });
cases[cases.length - 1].files['p.txt'] = '*** Begin Patch\n*** Update File: f.txt\n-a\n+x\n@@\n-x\n b\n+y\n*** End Patch\n';
C('V12 eof-not-at-end', { 'f.txt': 'a\nb\nc\n' }, ['p.txt'],
  null, 1, 'error: no-match f.txt\nfailed: 1 of 1 edits\n', { 'f.txt': 'a\nb\nc\n' });
cases[cases.length - 1].files['p.txt'] = '*** Begin Patch\n*** Update File: f.txt\n-a\n+X\n*** End of File\n*** End Patch\n';
C('V13 eof-empty-insert', { 'f.txt': 'a\nb\n' }, ['p.txt'],
  null, 0, 'M f.txt\nok: 1 file\n', { 'f.txt': 'a\nb\ntail\n' });
cases[cases.length - 1].files['p.txt'] = '*** Begin Patch\n*** Update File: f.txt\n+tail\n*** End of File\n*** End Patch\n';
C('V14 eof-chunk-anchor', { 'f.txt': 'a\nb\nc\n' }, ['p.txt'],
  null, 0, 'M f.txt\nok: 1 file\n', { 'f.txt': 'a\nb\nC\n' });
cases[cases.length - 1].files['p.txt'] = '*** Begin Patch\n*** Update File: f.txt\n@@ b\n-c\n+C\n*** End of File\n*** End Patch\n';
C('V15 chunk-anchor-no-body', { 'f.txt': 'a\nb\n' }, ['p.txt'],
  null, 0, 'ok: 0 files\n', { 'f.txt': 'a\nb\n' });
cases[cases.length - 1].files['p.txt'] = '*** Begin Patch\n*** Update File: f.txt\n@@ a\n*** End Patch\n';
C('V16 eof-no-chunk', { 'f.txt': 'a\n' }, ['p.txt'],
  null, 2, 'error: parse 3\n', { 'f.txt': 'a\n' });
cases[cases.length - 1].files['p.txt'] = '*** Begin Patch\n*** Update File: f.txt\n*** End of File\n*** End Patch\n';
C('V17 body-after-eof', { 'f.txt': 'a\nb\n' }, ['p.txt'],
  null, 2, 'error: parse 5\n', { 'f.txt': 'a\nb\n' });
cases[cases.length - 1].files['p.txt'] = '*** Begin Patch\n*** Update File: f.txt\n a\n*** End of File\n b\n*** End Patch\n';
C('V18 unknown-line', { 'f.txt': 'a\n' }, ['p.txt'],
  null, 2, 'error: parse 3\n', { 'f.txt': 'a\n' });
cases[cases.length - 1].files['p.txt'] = '*** Begin Patch\n*** Update File: f.txt\n*** Foo: bar\n*** End Patch\n';
C('V19 v4a-crlf', { 'f.txt': 'a\r\nb\r\n' }, ['p.txt'],
  null, 0, 'M f.txt\nok: 1 file\n', { 'f.txt': 'A\r\nb\r\n' });
cases[cases.length - 1].files['p.txt'] = '*** Begin Patch\n*** Update File: f.txt\n-a\n+A\n*** End Patch\n';
C('V20 v4a-move-r-sort', { 'z.txt': 'z\n', 'm.txt': 'm\n' }, ['p.txt'],
  null, 0, 'R z.txt -> a.txt\nM m.txt\nok: 2 files\n', { 'z.txt': null, 'a.txt': 'z\n', 'm.txt': 'M\n' });
cases[cases.length - 1].files['p.txt'] =
  '*** Begin Patch\n*** Update File: z.txt\n*** Move to: a.txt\n*** Update File: m.txt\n-m\n+M\n*** End Patch\n';
C('V21 add-blank-trailing', {}, ['p.txt'],
  null, 0, 'A f.txt\nok: 1 file\n', { 'f.txt': 'a\nb\n' });
cases[cases.length - 1].files['p.txt'] = '*** Begin Patch\n*** Add File: f.txt\n+a\n+b\n\n\n*** End Patch\n';
C('V22 update-blank-between-chunks', { 'f.txt': 'a\n\nb\nc\n' }, ['p.txt'],
  null, 0, 'M f.txt\nok: 1 file\n', { 'f.txt': 'A\n\nb\nC\n' });
cases[cases.length - 1].files['p.txt'] = '*** Begin Patch\n*** Update File: f.txt\n-a\n+A\n\n@@ b\n-c\n+C\n*** End Patch\n';
C('V23 v4a-tier2-nostart', { 'f.txt': '    x\n    y\n' }, ['p.txt'],
  null, 0, 'M f.txt\nok: 1 file\n', { 'f.txt': '    x\nz\n' });
cases[cases.length - 1].files['p.txt'] = '*** Begin Patch\n*** Update File: f.txt\n   x\n-  y\n+z\n*** End Patch\n';

C('U11b hunk-before-section-auto-is-format', { 'f.txt': 'a\n' }, ['-'],
  '@@ -1 +1 @@\n-a\n+b\n',
  2, 'error: format\n', { 'f.txt': 'a\n' });
C('V1b missing-begin-auto-is-format', { 'f.txt': 'a\n' }, ['p.txt'],
  null, 2, 'error: format\n', { 'f.txt': 'a\n' });
cases[cases.length - 1].files['p.txt'] = '*** Update File: f.txt\n a\n-b\n+c\n*** End Patch\n';

// ---------- json ----------
C('J1 array-parse-fault', { 'f.txt': 'a\n' }, ['p.txt'],
  null, 2, 'error: parse 1\n', { 'f.txt': 'a\n' });
cases[cases.length - 1].files['p.txt'] = '[{"command":"bogus","path":"f.txt"}]\n';
C('J2 jsonl-bad-line', { 'f.txt': 'a\n' }, ['p.txt'],
  null, 2, 'error: parse 2\n', { 'f.txt': 'a\n' });
cases[cases.length - 1].files['p.txt'] = '{"command":"create","path":"n.txt","file_text":"x"}\nnot json\n';
C('J3 insert-range', { 'f.txt': 'a\nb\n' }, ['p.txt'],
  null, 1, 'error: no-match f.txt\nfailed: 1 of 1 edits\n', { 'f.txt': 'a\nb\n' });
cases[cases.length - 1].files['p.txt'] = '{"command":"insert","path":"f.txt","insert_line":5,"new_str":"x"}\n';
C('J4 create-bytes', {}, ['p.txt'],
  null, 0, 'A n.txt\nok: 1 file\n', { 'n.txt': 'x' });
cases[cases.length - 1].files['p.txt'] = '{"command":"create","path":"n.txt","file_text":"x"}\n';
C('J5 str-replace-absent-new', { 'f.txt': 'aXb\n' }, ['p.txt'],
  null, 0, 'M f.txt\nok: 1 file\n', { 'f.txt': 'ab\n' });
cases[cases.length - 1].files['p.txt'] = '{"command":"str_replace","path":"f.txt","old_str":"X"}\n';

// ---------- cli misc ----------
C('C1 double-dash', { 'p.patch': '--- a/f.txt\n+++ b/f.txt\n@@ -1,1 +1,1 @@\n-a\n+A\n', 'f.txt': 'a\n' }, ['--', 'p.patch'],
  null, 0, 'M f.txt\nok: 1 file\n', { 'f.txt': 'A\n', 'p.patch': '--- a/f.txt\n+++ b/f.txt\n@@ -1,1 +1,1 @@\n-a\n+A\n' });
C('C3 format-auto-v4a', { 'f.txt': 'a\n' }, ['p.txt'],
  null, 0, 'M f.txt\nok: 1 file\n', { 'f.txt': 'A\n' });
cases[cases.length - 1].files['p.txt'] = '\n\n*** Begin Patch\n*** Update File: f.txt\n-a\n+A\n*** End Patch\n';

function readTree(dir) {
  const out = {};
  const walk = (d) => {
    for (const name of readdirSync(d)) {
      const p = join(d, name);
      const st = statSync(p);
      if (st.isDirectory()) walk(p);
      else if (st.isFile()) out[relative(dir, p).split(sep).join('/')] = readFileSync(p, 'utf8');
    }
  };
  walk(dir);
  return out;
}

function runOne(c) {
  const dir = mkdtempSync(join(tmpdir(), 'mend-case-'));
  try {
    for (const [p, text] of Object.entries(c.files)) {
      const f = join(dir, ...p.split('/'));
      mkdirSync(dirname(f), { recursive: true });
      writeFileSync(f, text);
    }
    const r = spawnSync(process.execPath, [MAIN, ...c.argv], { cwd: dir, input: c.stdin ?? '', encoding: 'utf8', timeout: 10000 });
    return { exit: r.status, stdout: r.stdout ?? '', files: readTree(dir), stderr: r.stderr ?? '' };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

let passed = 0;
const failures = [];
for (const c of cases) {
  // Expected full tree: input files unchanged unless the case's expect.files says otherwise.
  const want = {};
  for (const [p, text] of Object.entries(c.files)) want[p] = text;
  for (const [p, v] of Object.entries(c.expect.files)) {
    if (v === null) delete want[p];
    else want[p] = v;
  }
  const got = runOne(c);
  const why = [];
  if (got.exit !== c.expect.exit) why.push(`exit ${got.exit}, expected ${c.expect.exit} (stderr: ${(got.stderr ?? '').slice(0, 200)})`);
  if (got.stdout !== c.expect.stdout) why.push(`stdout ${JSON.stringify(got.stdout)}, expected ${JSON.stringify(c.expect.stdout)}`);
  for (const p of new Set([...Object.keys(want), ...Object.keys(got.files)])) {
    if (want[p] === undefined) why.push(`${p} should not exist, got ${JSON.stringify(got.files[p])}`);
    else if (got.files[p] === undefined) why.push(`${p} is missing`);
    else if (got.files[p] !== want[p]) why.push(`${p} differs: expected ${JSON.stringify(want[p])}, got ${JSON.stringify(got.files[p])}`);
  }
  // determinism: run again, must be identical
  const got2 = runOne(c);
  if (got2.exit !== got.exit || got2.stdout !== got.stdout || JSON.stringify(got2.files) !== JSON.stringify(got.files)) {
    why.push('NON-DETERMINISTIC second run');
  }
  if (why.length === 0) passed += 1;
  else failures.push(`${c.name}\n  ${why.join('\n  ')}`);
}
for (const f of failures) process.stdout.write(`FAIL ${f}\n`);
process.stdout.write(`${passed} of ${cases.length} targeted cases passed\n`);
if (failures.length > 0) process.exitCode = 1;
