import { describe, expect, it } from 'vitest';
import { PeleError, parse, supports } from '../../src/index.js';
import type { Scene, SceneShape } from '../../src/draw/scene.js';
import { assertSafe, draw, hasClass, itemById, items, lineOf, lines, paints, shapesOf, textsOf } from '../support/scene.js';

const FLOW = `
  commit id: "init"
  commit type: REVERSE tag: "v0.1"
  branch develop
  commit id: "feat" msg: "A message"
  commit type: HIGHLIGHT
  checkout main
  commit tag: "v0.2" tag: "stable"
  merge develop id: "merged" tag: "v1.0"
  branch hotfix
  commit id: "fix"
  checkout develop
  commit
  cherry-pick id: "fix"
  checkout main
  merge hotfix
`;

const withConfig = (yaml: string, body: string): string => `---\nconfig:\n  gitGraph:\n${yaml}\n---\n${body}`;

// Arguments after each path op code, as the scene's paths are written.
const ARGC = [2, 2, 6, 4, 7, 0];

// The op codes of a path: M 0, L 1, C 2, Q 3, A 4, Z 5.
function ops(cmds: number[]): string {
  let out = '';
  for (let i = 0; i < cmds.length; i += 1 + ARGC[cmds[i]]) out += cmds[i];
  return out;
}

const isCircle = (shape: SceneShape): boolean => ops(shape.cmds) === '0445';

// The lines between commits: the strokes that belong to no part of the diagram.
const edges = (scene: Scene): SceneShape[] => scene.shapes.filter((s) => s.item < 0 && s.kind === 'stroke');

// A commit's labels are in the muted colour, its tags in the text colour.
const commitLabels = (scene: Scene) => scene.texts.filter((t) => t.item >= 0 && hasClass(scene.items[t.item], 'pele-commit') && t.paint === 'var(--_m)');
const tags = (scene: Scene) => scene.texts.filter((t) => t.item >= 0 && hasClass(scene.items[t.item], 'pele-commit') && t.paint === 'var(--_fg)');

// Centers of the commit symbols, in drawing order, which is the order the commits were made in.
function commitCenters(scene: Scene): { x: number; y: number }[] {
  return items(scene, 'pele-commit').map((item) => {
    const { box } = shapesOf(scene, item).find((s) => s.kind === 'fill' && s.paint.startsWith('var(--pele-series-'))!;
    return { x: (box.x0 + box.x1) / 2, y: (box.y0 + box.y1) / 2 };
  });
}

describe('git graph rendering', () => {
  it('draws a lane per branch and a symbol per commit', () => {
    const { scene, type } = draw('gitGraph\n' + FLOW);
    expect(type).toBe('gitGraph');
    expect(supports('gitGraph\n commit')).toBe(true);
    const branches = items(scene, 'pele-branch');
    expect(branches).toHaveLength(3);
    // Each branch draws its lane as a line and its name on a tab.
    for (const branch of branches) expect(shapesOf(scene, branch).map((sh) => sh.kind)).toEqual(['stroke', 'fill']);
    expect(items(scene, 'pele-commit')).toHaveLength(10);
    expect(itemById(scene, 'develop', 'pele-branch')).toBeDefined();
    expect(lines(scene)).toContain('hotfix');
    for (const k of [1, 2, 3]) expect(paints(scene).some((p) => p.startsWith(`var(--pele-series-${k},`))).toBe(true);
  });

  it('gives each commit type its own symbol', () => {
    const { scene } = draw('gitGraph\n' + FLOW);
    const ofType = (type: string) => items(scene, `pele-commit-${type}`);
    expect(ofType('normal')).toHaveLength(5);
    expect(ofType('reverse')).toHaveLength(1);
    expect(ofType('highlight')).toHaveLength(1);
    expect(ofType('merge')).toHaveLength(2);
    expect(ofType('cherry-pick')).toHaveLength(1);
    // A highlight is a square, not a circle.
    expect(shapesOf(scene, ofType('highlight')[0]).some(isCircle)).toBe(false);
    expect(shapesOf(scene, ofType('normal')[0]).filter(isCircle)).toHaveLength(1);
    // A merge is a ring with a dot in it: the dot, and the ring's inside and outline.
    // (A tag's bullet is a circle too, in the border colour.)
    expect(shapesOf(scene, ofType('merge')[0]).filter((s) => isCircle(s) && s.paint !== 'var(--_b)')).toHaveLength(3);
  });

  it('draws a merge with a type as that type, and still marks it as a merge', () => {
    const { scene } = draw('gitGraph\n commit\n branch b\n commit\n checkout main\n commit\n merge b type: REVERSE');
    expect(items(scene).filter((i) => i.kind === 'pele-commit pele-commit-reverse pele-commit-merge')).toHaveLength(1);
  });

  it('labels commits with their ids, except unnamed merges and cherry-picks', () => {
    const { scene } = draw('gitGraph\n' + FLOW);
    expect(lines(scene)).toContain('init');
    expect(lines(scene)).toContain('merged');
    expect(commitLabels(scene)).toHaveLength(8);
    expect(commitLabels(scene).every((t) => t.angle === -45)).toBe(true);
    const hidden = draw(withConfig('    showCommitLabel: false', 'gitGraph\n' + FLOW)).scene;
    expect(commitLabels(hidden)).toHaveLength(0);
    expect(lines(hidden)).toContain('v0.1');
  });

  it('keeps ids level when rotateCommitLabel is off, and spaces commits to fit them', () => {
    const src = 'gitGraph\n commit id: "a rather long commit id"\n commit id: "another long commit id"\n commit';
    const rotated = draw(src);
    const level = draw(withConfig('    rotateCommitLabel: false', src));
    expect(commitLabels(level.scene)).toHaveLength(3);
    expect(commitLabels(level.scene).every((t) => t.angle === undefined)).toBe(true);
    expect(level.width).toBeGreaterThan(rotated.width);
    expect(level.height).toBeLessThan(rotated.height);
  });

  it('draws tags, the default cherry-pick tag, and no empty tag', () => {
    const { scene } = draw('gitGraph\n' + FLOW);
    expect(tags(scene)).toHaveLength(5);
    expect(lines(scene)).toContain('cherry-pick:fix');
    const none = draw('gitGraph\n commit id:"a" tag:""\n branch b\n commit id:"c"\n checkout main\n commit\n cherry-pick id:"c" tag:""').scene;
    expect(tags(none)).toHaveLength(0);
  });

  it('connects commits: straight along a lane, curved between lanes, dashed for a cherry-pick', () => {
    const { scene } = draw('gitGraph\n' + FLOW);
    const all = edges(scene);
    expect(all).toHaveLength(12);
    const dashed = all.filter((e) => e.dash);
    expect(dashed).toHaveLength(1);
    expect(ops(dashed[0].cmds)).toContain('2');
    expect(all.filter((e) => !ops(e.cmds).includes('2'))).toHaveLength(7);
    // A branch leaves its parent in a curve and a merge arrives in one, after a straight run.
    const merges = all.filter((e) => ops(e.cmds) === '012');
    expect(merges).toHaveLength(2);
    expect(merges[0].paint).toMatch(/^var\(--pele-series-2,/);
  });

  it('writes ids, tags, and branch names as plain text, with entity codes decoded and <br> as a line break', () => {
    const { scene } = draw('gitGraph\n commit id:"add <Button> #35;1" tag:"<i>t</i>"\n branch "one<br>two"\n commit id:"**a**"');
    expect(lines(scene)).toContain('add <Button> #1');
    expect(lines(scene)).toContain('<i>t</i>');
    expect(lines(scene)).toContain('**a**');
    expect(textsOf(scene, items(scene, 'pele-branch')[1]).map(lineOf)).toEqual(['one', 'two']);
    expect(itemById(scene, 'add <Button> #1')).toBeDefined();
  });

  it('lays lanes out across the page for TB and upside down for BT', () => {
    const body = '\n commit\n commit\n branch b\n commit\n commit\n checkout main\n commit';
    const lr = draw('gitGraph' + body);
    const tb = draw('gitGraph TB:' + body);
    const bt = draw('gitGraph BT:' + body);
    const [l, t, b] = [lr, tb, bt].map((r) => commitCenters(r.scene));
    expect(l).toHaveLength(5);
    expect(l[1].x).toBeGreaterThan(l[0].x);
    expect(l[1].y).toBe(l[0].y);
    expect(l[2].y).toBeGreaterThan(l[0].y);
    expect(t[1].y).toBeGreaterThan(t[0].y);
    expect(t[1].x).toBe(t[0].x);
    expect(t[2].x).toBeGreaterThan(t[0].x);
    expect(b[1].y).toBeLessThan(b[0].y);
    expect(b[2].x).toBeGreaterThan(b[0].x);
    expect(tb.height).toBeGreaterThan(tb.width);
    expect(bt.height).toBe(tb.height);
    expect(commitLabels(bt.scene).every((t) => t.angle === 45)).toBe(true);
  });

  it('shares positions between branches with parallelCommits', () => {
    const src = 'gitGraph\n commit\n branch develop\n commit\n commit\n checkout main\n commit\n commit';
    const serial = draw(src);
    const parallel = draw(withConfig('    parallelCommits: true', src));
    expect(parallel.width).toBeLessThan(serial.width);
    const centers = commitCenters(parallel.scene);
    expect(centers[3].x).toBe(centers[1].x);
    expect(centers[4].x).toBe(centers[2].x);
  });

  it('hides branch names and lane lines when showBranches is off', () => {
    const { scene } = draw(withConfig('    showBranches: false', 'gitGraph\n' + FLOW));
    expect(items(scene, 'pele-branch')).toHaveLength(0);
    expect(lines(scene)).not.toContain('develop');
    expect(items(scene, 'pele-commit')).toHaveLength(10);
  });

  it('names and orders the main branch from config, and orders branches by `order`', () => {
    const src = 'gitGraph\n commit\n branch b1\n commit\n branch b2 order: 3\n commit\n branch b3 order: 1\n commit';
    const model = parse(withConfig('    mainBranchName: trunk\n    mainBranchOrder: 2', src));
    expect(model.type).toBe('gitGraph');
    if (model.type !== 'gitGraph') return;
    expect(model.lanes).toEqual(['b1', 'b3', 'trunk', 'b2']);
    const { scene } = draw(withConfig('    mainBranchName: trunk\n    mainBranchOrder: 2', src));
    const ids = items(scene, 'pele-branch').map((i) => i.id);
    expect(ids.indexOf('b3')).toBeLessThan(ids.indexOf('trunk'));
    expect(lines(draw('%%{init: {"gitGraph": {"mainBranchName": "dev"}}}%%\ngitGraph\n commit').scene)).toContain('dev');
  });

  it('reads branch names that start with title', () => {
    const model = parse('gitGraph\n commit\n branch titles\n commit\n branch title/x\n commit\n checkout main\n merge titles\n branch title-2.0\n');
    expect(model.type).toBe('gitGraph');
    if (model.type !== 'gitGraph') return;
    expect(model.lanes).toEqual(['main', 'titles', 'title/x', 'title-2.0']);
    expect(model.title).toBeUndefined();
    expect(() => parse('gitGraph\n commit\n branch title.v2\n checkout title.v2')).not.toThrow();
  });

  it('takes the title from front matter unless the graph sets one', () => {
    expect(lines(draw('---\ntitle: From front matter\n---\ngitGraph\n commit').scene)).toContain('From front matter');
    const own = draw('---\ntitle: From front matter\n---\ngitGraph\n title Own\n commit').scene;
    expect(lines(own)).toContain('Own');
    expect(lines(own)).not.toContain('From front matter');
  });

  it('generates the same commit ids every time, in Mermaid\'s shape', () => {
    const src = 'gitGraph\n commit\n commit\n branch b\n commit\n checkout main\n commit\n merge b';
    const model = parse(src);
    if (model.type !== 'gitGraph') throw new Error('not a git graph');
    const ids = [...model.commits.keys()];
    expect(ids).toHaveLength(5);
    ids.forEach((id, seq) => expect(id).toMatch(new RegExp(`^${seq}-[0-9a-f]{7}$`)));
    expect(new Set(ids).size).toBe(5);
    expect(draw(src).scene).toEqual(draw(src).scene);
    const again = parse(src);
    expect(again.type === 'gitGraph' && [...again.commits.keys()]).toEqual(ids);
  });

  it('does not let a generated id replace a commit that already has it', () => {
    const first = parse('gitGraph\n commit');
    if (first.type !== 'gitGraph') throw new Error('not a git graph');
    const taken = [...first.commits.keys()][0].replace(/^0/, '1');
    const model = parse(`gitGraph\n commit id:"${taken}"\n commit`);
    if (model.type !== 'gitGraph') throw new Error('not a git graph');
    expect(model.commits.size).toBe(2);
    expect(model.warnings).toEqual([]);
  });

  it('keeps Mermaid\'s rule for a repeated commit id: the later commit replaces the earlier, with a warning', () => {
    const model = parse('gitGraph\n commit id:"a"\n commit id:"b"\n commit id:"a"');
    if (model.type !== 'gitGraph') throw new Error('not a git graph');
    expect([...model.commits.keys()]).toEqual(['a', 'b']);
    expect(model.commits.get('a')?.seq).toBe(2);
    expect(model.warnings).toEqual(['Commit ID a already exists']);
    expect(items(draw('gitGraph\n commit id:"a"\n commit id:"a"\n branch b\n commit id:"a"').scene, 'pele-commit').length).toBeGreaterThan(0);
  });

  it('rejects what Mermaid rejects, with its messages', () => {
    const cases: [string, string][] = [
      ['gitGraph\n commit\n branch main', 'Trying to create an existing branch. (Help: Either use a new name if you want create a new branch or try using "checkout main")'],
      ['gitGraph\n commit\n checkout nope', 'Trying to checkout branch which is not yet created. (Help try using "branch nope")'],
      ['gitGraph\n commit\n branch b\n merge b', 'Incorrect usage of "merge". Cannot merge a branch to itself'],
      ['gitGraph\n commit\n branch b\n merge main', "Cannot merge branch 'main' into itself."],
      ['gitGraph\n merge b', 'Incorrect usage of "merge". Current branch (main)has no commits'],
      ['gitGraph\n commit\n merge b', 'Incorrect usage of "merge". Branch to be merged (b) does not exist'],
      ['gitGraph\n branch b\n checkout main\n commit\n merge b', 'Incorrect usage of "merge". Branch to be merged (b) has no commits'],
      ['gitGraph\n commit\n branch b\n checkout main\n merge b', 'Incorrect usage of "merge". Both branches have same head'],
      ['gitGraph\n commit id:"a"\n branch b\n commit\n checkout main\n commit\n merge b id:"a"', 'Incorrect usage of "merge". Commit with id:a already exists, use different custom id'],
      ['gitGraph\n commit\n cherry-pick id:"nope"', 'Incorrect usage of "cherryPick". Source commit id should exist and provided'],
      ['gitGraph\n commit\n cherry-pick', 'Incorrect usage of "cherryPick". Source commit id should exist and provided'],
      ['gitGraph\n commit id:"a"\n cherry-pick id:"a"', 'Incorrect usage of "cherryPick". Source commit is already on current branch'],
      ['gitGraph\n branch b\n commit id:"a"\n checkout main\n cherry-pick id:"a"', 'Incorrect usage of "cherry-pick". Current branch (main)has no commits'],
      ['gitGraph\n commit id:"z"\n branch b\n commit id:"a"\n checkout main\n commit\n cherry-pick id:"a" parent:"q"', 'Invalid operation: The specified parent commit is not an immediate parent of the cherry-picked commit.'],
      ['gitGraph\n commit\n branch b\n commit\n checkout main\n commit\n merge b id:"m"\n checkout b\n cherry-pick id:"m"', 'Incorrect usage of cherry-pick: If the source commit is a merge commit, an immediate parent commit must be specified.'],
    ];
    for (const [src, message] of cases) {
      let error: unknown;
      try {
        draw(src);
      } catch (e) {
        error = e;
      }
      expect(error, src).toBeInstanceOf(PeleError);
      expect((error as PeleError).message, src).toBe(message);
      expect((error as PeleError).code, src).toBe('semantic');
    }
  });

  it('draws a graph with no commits, and one with only branches', () => {
    expect(lines(draw('gitGraph').scene)).toContain('main');
    const result = draw('gitGraph\n branch a\n branch "b c"');
    expect(items(result.scene, 'pele-branch')).toHaveLength(3);
    expect(lines(result.scene)).toContain('b c');
    assertSafe(result, 'branches only');
  });

  it('emits only finite coordinates', () => {
    for (const header of ['gitGraph', 'gitGraph TB:', 'gitGraph BT:']) {
      for (const config of ['    parallelCommits: true', '    rotateCommitLabel: false', '    showBranches: false']) {
        const result = draw(withConfig(config, header + '\n' + FLOW));
        expect(Number.isFinite(result.width) && Number.isFinite(result.height)).toBe(true);
        assertSafe(result, `${header} ${config}`);
      }
    }
  });
});
