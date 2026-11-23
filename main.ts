// main.ts is mend, the CLI SPEC.md specifies, and this is the kit's starting point for it (MIT). It does sections 1 to 4, 9 and 10 of SPEC.md: the command line, the output and
// exit codes, safe paths, format detection, JSON edits and the all-or-nothing write. The other three formats are
// detected and then read as holding no edit, so they answer `error: parse 1`: reading unified diffs (section 6),
// SEARCH/REPLACE blocks (section 7) and V4A patches (section 8), and matching lines at three tiers (section 5), are
// yours to write. Node 22, the standard library alone; run it as `node main.ts [options] [PATCH]`.
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

/** The tree as the edits leave it: changed paths in `now` (null: deleted), the rest read from disk. */
class Tree {
  private readonly orig = new Map<string, string | null>();
  readonly now = new Map<string, string | null>();
  /** moves that succeeded: [old, new] */
  moves: Array<[string, string]> = [];
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

// ---- Section 3: files as lines -------------------------------------------------------------------------------------

interface FileLines {
  lines: string[];
  br: string;
  final: boolean;
}

function toLines(text: string): FileLines {
  const nl = text.indexOf('\n');
  const br = nl > 0 && text[nl - 1] === '\r' ? '\r\n' : '\n';
  if (text === '') return { lines: [], br, final: false };
  const lines = text.split(br);
  const final = text.endsWith(br);
  if (final) lines.pop();
  return { lines, br, final };
}

function fromLines(f: FileLines): string {
  if (f.lines.length === 0) return '';
  return f.lines.join(f.br) + (f.final ? f.br : '');
}

/** The text of a file an edit creates: LF breaks, a final break unless told otherwise. */
function created(lines: string[], final: boolean): string {
  return lines.length === 0 ? '' : lines.join('\n') + (final ? '\n' : '');
}

// ---- Section 5: matching lines at three tiers ----------------------------------------------------------------------

let STRICT = false;

const trimEndWs = (s: string): string => s.replace(/[ \t]+$/, '');
const trimWs = (s: string): string => s.replace(/^[ \t]+|[ \t]+$/g, '');
const norm: Array<(s: string) => string> = [(s) => s, trimEndWs, trimWs];
const leadWs = (s: string): string => /^[ \t]*/.exec(s)![0];

/** Positions at which `old` matches `hay` at one tier, none before `from`. */
function occurrences(hay: string[], old: string[], tier: number, from = 0): number[] {
  const f = norm[tier]!;
  const want = old.map(f);
  const have = hay.map(f);
  const out: number[] = [];
  for (let i = from; i + want.length <= have.length; i++) {
    let ok = true;
    for (let j = 0; j < want.length; j++) {
      if (have[i + j] !== want[j]) {
        ok = false;
        break;
      }
    }
    if (ok) out.push(i);
  }
  return out;
}

/** The occurrences at the first tier that has any (`keep` filters them first); tier -1 and none when there is no match. */
function findAt(hay: string[], old: string[], from = 0, keep: (i: number) => boolean = () => true): { tier: number; at: number[] } {
  for (let tier = 0; tier < (STRICT ? 1 : 3); tier++) {
    const at = occurrences(hay, old, tier, from).filter(keep);
    if (at.length > 0) return { tier, at };
  }
  return { tier: -1, at: [] };
}

interface Op {
  k: ' ' | '-' | '+';
  t: string;
  /** a `\` line followed this body line */
  noeol?: boolean;
  /** the body line was empty, not a lone space */
  empty?: boolean;
}

/** N for a match of `ops` (context lines, - lines, + lines) at `pos` in `file`, written as section 5 says. */
function newLines(file: string[], pos: number, tier: number, ops: Op[], oldFirst?: string): string[] {
  const first = oldFirst ?? ops.find((o) => o.k !== '+')?.t;
  const P = first === undefined ? '' : leadWs(first);
  const F = tier === 2 ? leadWs(file[pos]!) : '';
  const out: string[] = [];
  let at = pos;
  for (const o of ops) {
    if (o.k === '-') at += 1;
    else if (o.k === ' ') out.push(file[at++]!);
    else if (tier === 2 && !blank(o.t) && o.t.startsWith(P)) out.push(F + o.t.slice(P.length));
    else out.push(o.t);
  }
  return out;
}

// ---- Section 7: SEARCH/REPLACE blocks ------------------------------------------------------------------------------

function searchReplaceEdits(lines: string[]): Edit[] {
  const edits: Edit[] = [];
  let prevEnd = -1;
  let prevPath: string | null = null;
  for (let s = 0; s < lines.length; s++) {
    if (lines[s]!.trimEnd() !== '<<<<<<< SEARCH') continue;
    const mid = lines.findIndex((l, i) => i > s && l.trimEnd() === '=======');
    const end = mid < 0 ? -1 : lines.findIndex((l, i) => i > mid && l.trimEnd() === '>>>>>>> REPLACE');
    if (mid < 0 || end < 0) throw new Exit2(`error: parse ${s + 1}`);
    let path: string | null = null;
    for (let i = s - 1; i > prevEnd; i--) {
      const t = lines[i]!.trim();
      if (t !== '' && !t.startsWith('```')) {
        path = t;
        break;
      }
    }
    if (path === null) path = prevPath;
    if (path === null) throw new Exit2(`error: parse ${s + 1}`);
    const p = path;
    const oldL = lines.slice(s + 1, mid);
    const newL = lines.slice(mid + 1, end);
    edits.push((tree) => {
      if (!safe(p)) throw new Fail('unsafe', p);
      const cur = tree.get(p);
      if (oldL.length === 0) {
        if (cur !== null) throw new Fail('exists', p);
        tree.now.set(p, created(newL, true));
        return;
      }
      if (cur === null) throw new Fail('missing', p);
      const f = toLines(cur);
      const m = findAt(f.lines, oldL);
      if (m.at.length === 0) throw new Fail('no-match', p);
      if (m.at.length > 1) throw new Fail('ambiguous', p);
      const pos = m.at[0]!;
      f.lines.splice(pos, oldL.length, ...newLines(f.lines, pos, m.tier, newL.map((t) => ({ k: '+' as const, t })), oldL[0]));
      tree.now.set(p, fromLines(f));
    });
    prevEnd = end;
    prevPath = p;
    s = end;
  }
  return edits;
}

// ---- Section 6: unified diffs --------------------------------------------------------------------------------------

interface Hunk {
  a: number;
  ops: Op[];
}

interface Section {
  oldP: string | null | undefined;
  newP: string | null | undefined;
  gitOld: string | null;
  gitNew: string | null;
  renameFrom: string | null;
  renameTo: string | null;
  isNew: boolean;
  isDeleted: boolean;
  hunks: Hunk[];
  header: boolean;
}

const diffPath = (raw: string): string | null => {
  let p = raw.slice(4);
  const tab = p.indexOf('\t');
  if (tab >= 0) p = p.slice(0, tab);
  p = p.replace(/^ +| +$/g, '');
  if (p === '/dev/null') return null;
  if (p.startsWith('a/') || p.startsWith('b/')) p = p.slice(2);
  return p;
};

function splitGit(rest: string): [string, string] | null {
  if (!rest.startsWith('a/')) return null;
  const spots: number[] = [];
  for (let k = rest.indexOf(' b/'); k >= 0; k = rest.indexOf(' b/', k + 1)) spots.push(k);
  if (spots.length === 0) return null;
  const same = spots.find((k) => rest.slice(2, k) === rest.slice(k + 3));
  const k = same ?? spots[0]!;
  const x = rest.slice(2, k);
  const y = rest.slice(k + 3);
  return x === '' || y === '' ? null : [x, y];
}

function unifiedEdits(lines: string[]): Edit[] {
  const secs: Section[] = [];
  let sec: Section | null = null;
  let body: Hunk | null = null;
  const fresh = (): Section => ({ oldP: undefined, newP: undefined, gitOld: null, gitNew: null, renameFrom: null, renameTo: null, isNew: false, isDeleted: false, hunks: [], header: true });
  const pair = (i: number): boolean => lines[i]!.startsWith('--- ') && (lines[i + 1] ?? '').startsWith('+++ ');
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i]!;
    if (body !== null) {
      const first = l[0];
      const other = l !== '' && first !== ' ' && first !== '-' && first !== '+' && first !== '\\';
      if (!other && !l.startsWith('diff --git ') && !pair(i)) {
        if (first === '\\') {
          const prev = body.ops[body.ops.length - 1];
          if (prev !== undefined) prev.noeol = true;
        } else body.ops.push({ k: first === undefined ? ' ' : (first as ' ' | '-' | '+'), t: l.slice(1), empty: l === '' });
        continue;
      }
      body = null;
    }
    if (l.startsWith('diff --git ')) {
      const g = splitGit(l.slice(11));
      if (g === null) throw new Exit2(`error: parse ${i + 1}`);
      sec = fresh();
      sec.gitOld = g[0];
      sec.gitNew = g[1];
      secs.push(sec);
    } else if (pair(i)) {
      if (sec === null || !sec.header || sec.oldP !== undefined) {
        sec = fresh();
        secs.push(sec);
      }
      sec.oldP = diffPath(l);
      sec.newP = diffPath(lines[i + 1]!);
      i += 1;
    } else if (l.startsWith('--- ')) {
      if (sec !== null && sec.header) throw new Exit2(`error: parse ${i + 2}`);
    } else if (l.startsWith('@@')) {
      const m = /^@@ -(\d+)(?:,\d+)? \+\d+(?:,\d+)? @@/.exec(l);
      if (m === null || sec === null) throw new Exit2(`error: parse ${i + 1}`);
      body = { a: Number(m[1]), ops: [] };
      sec.hunks.push(body);
      sec.header = false;
    } else if (sec !== null && sec.header) {
      if (l.startsWith('rename from ')) sec.renameFrom = l.slice(12).trim();
      else if (l.startsWith('rename to ')) sec.renameTo = l.slice(10).trim();
      else if (l.startsWith('new file mode')) sec.isNew = true;
      else if (l.startsWith('deleted file mode')) sec.isDeleted = true;
    }
  }
  // empty lines at the end of a body are not part of it
  for (const s of secs) {
    for (const h of s.hunks) {
      while (h.ops.length > 0 && h.ops[h.ops.length - 1]!.k === ' ' && h.ops[h.ops.length - 1]!.t === '' && h.ops[h.ops.length - 1]!.empty) h.ops.pop();
    }
  }
  return secs.map((s): Edit => unifiedEdit(s));
}

/** Apply one hunk to `f`, `d` being the net growth of this section's earlier hunks; returns the new d. */
function applyHunk(f: FileLines, h: Hunk, d: number): number {
  const oldOps = h.ops.filter((o) => o.k !== '+');
  const oldL = oldOps.map((o) => o.t);
  let pos: number;
  let tier = 0;
  let toEnd: boolean;
  if (oldL.length > 0) {
    const m = findAt(f.lines, oldL);
    if (m.at.length === 0) throw new Fail('no-match', '');
    const want = h.a - 1 + d;
    pos = m.at[0]!;
    for (const c of m.at) if (Math.abs(c - want) < Math.abs(pos - want)) pos = c;
    tier = m.tier;
    toEnd = pos + oldL.length === f.lines.length;
  } else {
    pos = Math.min(Math.max(h.a + d, 0), f.lines.length);
    toEnd = pos === f.lines.length;
  }
  const add = newLines(f.lines, pos, tier, h.ops);
  f.lines.splice(pos, oldL.length, ...add);
  if (toEnd) {
    let last: Op | undefined;
    for (const o of h.ops) if (o.k !== '-') last = o;
    f.final = !(last !== undefined && last.noeol === true);
  }
  return d + add.length - oldL.length;
}

function unifiedEdit(s: Section): Edit {
  const oldP = s.oldP !== undefined ? s.oldP : s.renameFrom ?? s.gitOld;
  const newP = s.newP !== undefined ? s.newP : s.renameTo ?? s.gitNew;
  const creating = oldP === null || s.isNew;
  const deleting = !creating && (newP === null || s.isDeleted);
  return (tree) => {
    const paths = [oldP, newP].filter((x): x is string => x !== null && x !== undefined);
    for (const p of paths) if (!safe(p)) throw new Fail('unsafe', p);
    if (creating) {
      const p = (newP ?? oldP) as string;
      if (tree.get(p) !== null) throw new Fail('exists', p);
      const add: string[] = [];
      let lastNoeol = false;
      for (const h of s.hunks) {
        for (const o of h.ops) {
          if (o.k === '+') {
            add.push(o.t);
            lastNoeol = o.noeol === true;
          }
        }
      }
      tree.now.set(p, created(add, !lastNoeol));
      return;
    }
    const from = (oldP ?? newP) as string;
    const cur = tree.get(from);
    if (cur === null) throw new Fail('missing', from);
    if (deleting) {
      tree.now.set(from, null);
      return;
    }
    const to = (newP ?? oldP) as string;
    if (to !== from && tree.get(to) !== null) throw new Fail('exists', to);
    const f = toLines(cur);
    let d = 0;
    try {
      for (const h of s.hunks) d = applyHunk(f, h, d);
    } catch (e) {
      if (e instanceof Fail) throw new Fail(e.code, from);
      throw e;
    }
    if (to !== from) {
      tree.now.set(from, null);
      tree.moves.push([from, to]);
    }
    tree.now.set(to, fromLines(f));
  };
}

// ---- Section 8: V4A patches ----------------------------------------------------------------------------------------

interface Chunk {
  anchor: string | null;
  ops: Op[];
  eof: boolean;
}

function v4aEdits(lines: string[]): Edit[] {
  const nb = lines.map((l, i) => (blank(l) ? -1 : i)).filter((i) => i >= 0);
  if (nb.length === 0 || lines[nb[0]!]!.trim() !== '*** Begin Patch') throw new Exit2(`error: parse ${nb.length === 0 ? 1 : nb[0]! + 1}`);
  const last = nb[nb.length - 1]!;
  if (lines[last]!.trim() !== '*** End Patch') throw new Exit2(`error: parse ${lines.length + 1}`);
  const startsAt = (l: string): boolean => l.startsWith('*** Add File: ') || l.startsWith('*** Delete File: ') || l.startsWith('*** Update File: ');
  const edits: Edit[] = [];
  let i = nb[0]! + 1;
  while (i < last) {
    const l = lines[i]!;
    if (blank(l)) {
      i++;
      continue;
    }
    if (!startsAt(l)) throw new Exit2(`error: parse ${i + 1}`);
    const head = i;
    let j = i + 1;
    while (j < last && !startsAt(lines[j]!)) j++;
    let end = j;
    while (end > head + 1 && blank(lines[end - 1]!)) end--;
    const rest = lines.slice(head + 1, end);
    const at = (k: number): number => head + 1 + k + 1; // 1-based number of rest[k]
    const colon = l.indexOf(': ');
    const p = l.slice(colon + 2).replace(/^ +| +$/g, '');
    if (l.startsWith('*** Add File: ')) {
      const add = rest.map((r, k) => {
        if (r === '') return '';
        if (r[0] === '+') return r.slice(1);
        throw new Exit2(`error: parse ${at(k)}`);
      });
      edits.push((tree) => {
        if (!safe(p)) throw new Fail('unsafe', p);
        if (tree.get(p) !== null) throw new Fail('exists', p);
        tree.now.set(p, created(add, true));
      });
    } else if (l.startsWith('*** Delete File: ')) {
      if (rest.length > 0) throw new Exit2(`error: parse ${at(0)}`);
      edits.push((tree) => {
        if (!safe(p)) throw new Fail('unsafe', p);
        if (tree.get(p) === null) throw new Fail('missing', p);
        tree.now.set(p, null);
      });
    } else {
      let k = 0;
      let move: string | null = null;
      if (rest.length > 0 && rest[0]!.startsWith('*** Move to: ')) {
        move = rest[0]!.slice(13).replace(/^ +| +$/g, '');
        k = 1;
      }
      const chunks: Chunk[] = [];
      let cur: Chunk | null = null;
      for (; k < rest.length; k++) {
        const r = rest[k]!;
        if (r.startsWith('@@')) {
          cur = { anchor: r.slice(2).replace(/^ +| +$/g, '') || null, ops: [], eof: false };
          chunks.push(cur);
        } else if (r === '*** End of File') {
          if (cur === null || cur.eof) {
            cur = { anchor: null, ops: [], eof: true };
            chunks.push(cur);
          }
          cur.eof = true;
          cur = null;
        } else if (r === '' || r[0] === ' ' || r[0] === '-' || r[0] === '+') {
          if (cur === null) {
            if (chunks.length > 0) throw new Exit2(`error: parse ${at(k)}`);
            cur = { anchor: null, ops: [], eof: false };
            chunks.push(cur);
          }
          cur.ops.push({ k: r === '' ? ' ' : (r[0] as ' ' | '-' | '+'), t: r.slice(1) });
        } else throw new Exit2(`error: parse ${at(k)}`);
      }
      if (chunks.length === 0 && move === null) throw new Exit2(`error: parse ${head + 1}`);
      const mv = move;
      edits.push((tree) => {
        if (!safe(p)) throw new Fail('unsafe', p);
        if (mv !== null && !safe(mv)) throw new Fail('unsafe', mv);
        const text = tree.get(p);
        if (text === null) throw new Fail('missing', p);
        if (mv !== null && tree.get(mv) !== null) throw new Fail('exists', mv);
        const f = toLines(text);
        let cursor = 0;
        for (const c of chunks) {
          if (c.anchor !== null) {
            const a = findAt(f.lines, [c.anchor], cursor);
            if (a.at.length === 0) throw new Fail('no-match', p);
            cursor = a.at[0]! + 1;
          }
          const oldL = c.ops.filter((o) => o.k !== '+').map((o) => o.t);
          if (oldL.length === 0) {
            const at = c.eof ? f.lines.length : Math.min(cursor, f.lines.length);
            const add = c.ops.map((o) => o.t);
            f.lines.splice(at, 0, ...add);
            cursor = at + add.length;
            continue;
          }
          const m = findAt(f.lines, oldL, cursor, c.eof ? (x) => x + oldL.length === f.lines.length : () => true);
          if (m.at.length === 0) throw new Fail('no-match', p);
          const pos = m.at[0]!;
          const add = newLines(f.lines, pos, m.tier, c.ops);
          f.lines.splice(pos, oldL.length, ...add);
          cursor = pos + add.length;
        }
        if (mv !== null) {
          tree.now.set(p, null);
          tree.moves.push([p, mv]);
          tree.now.set(mv, fromLines(f));
        } else tree.now.set(p, fromLines(f));
      });
    }
    i = j;
  }
  return edits;
}

function run(args: string[]): { code: number; out: string[] } {
  let format: string | null = null;
  let check = false;
  const pos: string[] = [];
  let ended = false;
  for (const a of args) {
    if (!ended && a === '--') ended = true;
    else if (!ended && a.startsWith('-') && a !== '-') {
      if (a.startsWith('--format=') && format === null && FORMATS.includes(a.slice(9))) format = a.slice(9);
      else if (a === '--check' && !check) check = true;
      else if (a === '--strict' && !STRICT) STRICT = true;
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
  let edits: Edit[];
  try {
    edits = kind === 'json' ? jsonEdits(text, lines) : kind === 'unified' ? unifiedEdits(lines) : kind === 'search-replace' ? searchReplaceEdits(lines) : kind === 'v4a' ? v4aEdits(lines) : [];
    if (edits.length === 0) throw new Exit2('error: parse 1');
  } catch (e) {
    if (e instanceof Exit2) return { code: 2, out: [e.line] };
    throw e;
  }
  const tree = new Tree();
  const fails: Fail[] = [];
  for (const edit of edits) {
    const before = new Map(tree.now);
    const nMoves = tree.moves.length;
    try {
      edit(tree);
    } catch (e) {
      if (!(e instanceof Fail)) throw e;
      tree.moves.length = nMoves;
      tree.now.clear();
      for (const [k, v] of before) tree.now.set(k, v);
      fails.push(e);
    }
  }
  if (fails.length > 0) return { code: 1, out: [...fails.map((f) => `error: ${f.code} ${f.path}`), `failed: ${fails.length} of ${edits.length} edits`] };
  const rows: Array<[string, string]> = [];
  const skip = new Set<string>();
  for (const [from, to] of tree.moves) {
    if (tree.original(from) !== null && tree.get(from) === null && tree.original(to) === null && tree.get(to) !== null) {
      skip.add(from);
      skip.add(to);
      rows.push([to, `R ${from} -> ${to}`]);
    }
  }
  for (const p of tree.now.keys()) {
    if (skip.has(p)) continue;
    const was = tree.original(p);
    const now = tree.now.get(p)!;
    if (was === now) continue;
    rows.push([p, `${was === null ? 'A' : now === null ? 'D' : 'M'} ${p}`]);
  }
  rows.sort((a, b) => Buffer.compare(Buffer.from(a[0]), Buffer.from(b[0])));
  if (!check) {
    for (const p of tree.now.keys()) {
      const was = tree.original(p);
      const now = tree.now.get(p)!;
      if (was === now) continue;
      if (now === null) rmSync(p, { force: true });
      else {
        mkdirSync(dirname(p), { recursive: true });
        writeFileSync(p, now);
      }
    }
  }
  return { code: 0, out: [...rows.map((r) => r[1]), `ok: ${rows.length} ${rows.length === 1 ? 'file' : 'files'}`] };
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
