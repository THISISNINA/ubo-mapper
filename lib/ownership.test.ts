import assert from 'node:assert/strict';
import { analyse, keyOf, parseRows, type InputRow, type Kind, type Rule } from './ownership';

type R = [string, string, string] | [string, string, Kind, string?];
const input = (rows: R[]): InputRow[] =>
  rows.map((r, i) =>
    r.length === 3 && /^[\d.%]*$/.test(r[2])
      ? { id: String(i), owner: r[0], company: r[1], kind: 'shares', percent: r[2] }
      : { id: String(i), owner: r[0], company: r[1], kind: r[2] as Kind, percent: r[3] ?? '' }
  );
const run = (rows: R[], threshold = 25, rule: Rule = 'atLeast', target: string | null = null) =>
  analyse(parseRows(input(rows)).rows, target && keyOf(target), threshold, rule);
const owner = (a: ReturnType<typeof run>, name: string) => a.owners.find((o) => o.key === keyOf(name));
const ubos = (a: ReturnType<typeof run>) => a.owners.filter((o) => o.isUbo).map((o) => o.name).sort();
let count = 0;
const test = (name: string, fn: () => void) => {
  fn();
  count++;
  console.log(`OK: ${name}`);
};

test('indirect ownership multiplies along the chain; threshold applies', () => {
  const a = run([
    ['John', 'Alpine Ltd', '60'],
    ['Sarah', 'Alpine Ltd', '40'],
    ['Alpine Ltd', 'Meridian LLC', '60'],
    ['David', 'Meridian LLC', '25'],
    ['Maria', 'Meridian LLC', '15'],
  ]);
  assert.equal(a.targetName, 'Meridian LLC');
  assert.equal(owner(a, 'John')?.effective, 36);
  assert.equal(owner(a, 'Sarah')?.effective, 24);
  assert.deepEqual(ubos(a), ['David', 'John'], 'Sarah (24%) and Maria (15%) are below 25%');
  assert.deepEqual(a.warnings, []);
  const y = (n: string) => a.nodes.find((x) => x.key === keyOf(n))!.y;
  assert.ok(y('John') < y('Alpine Ltd') && y('Alpine Ltd') < y('Meridian LLC'), 'owners sit above what they own');
});

test('"more than 25%" rule excludes exactly 25%', () => {
  const rows: R[] = [['David', 'Target Co', '25'], ['Eve', 'Target Co', '75']];
  assert.deepEqual(ubos(run(rows, 25, 'atLeast')), ['David', 'Eve']);
  assert.deepEqual(ubos(run(rows, 25, 'moreThan')), ['Eve']);
});

test('two paths to the same company are added together', () => {
  const a = run([
    ['Ann', 'A Co', '50'],
    ['Ann', 'B Co', '50'],
    ['A Co', 'Target Co', '20'],
    ['B Co', 'Target Co', '30'],
  ]);
  assert.equal(owner(a, 'Ann')?.effective, 25);
  assert.equal(owner(a, 'Ann')?.isUbo, true);
});

test('foundation: founder, council and beneficiaries are UBOs with no percentage', () => {
  const a = run([
    ['Priya', 'Falcon Foundation', 'founder'],
    ['Omar', 'Falcon Foundation', 'trustee'],
    ['Lina', 'Falcon Foundation', 'beneficiary'],
    ['Paul', 'Falcon Foundation', 'protector'],
    ['Falcon Foundation', 'Target Co', '60'],
    ['Bob', 'Target Co', '40'],
  ]);
  assert.deepEqual(ubos(a), ['Bob', 'Lina', 'Omar', 'Paul', 'Priya']);
  assert.equal(owner(a, 'Falcon Foundation'), undefined, 'the foundation itself is not a person/UBO');
  assert.match(owner(a, 'Priya')!.reasons[0], /^Founder \/ settlor of Falcon Foundation, which owns 60% of Target Co\.$/);
  assert.deepEqual(a.warnings, []);
});

test('foundation with only a small stake does not make its people UBOs', () => {
  const a = run([
    ['Priya', 'Small Foundation', 'founder'],
    ['Omar', 'Small Foundation', 'trustee'],
    ['Lina', 'Small Foundation', 'beneficiary'],
    ['Small Foundation', 'Target Co', '10'],
    ['Bob', 'Target Co', '90'],
  ]);
  assert.deepEqual(ubos(a), ['Bob']);
});

test('a foundation or trust can itself be the main company', () => {
  const a = run(
    [
      ['Priya', 'Family Trust', 'founder'],
      ['Omar', 'Family Trust', 'trustee'],
      ['Lina', 'Family Trust', 'beneficiary'],
    ],
    25,
    'atLeast',
    'Family Trust'
  );
  assert.deepEqual(ubos(a), ['Lina', 'Omar', 'Priya']);
});

test('corporate trustee: its owners are UBOs too', () => {
  const a = run([
    ['Sam', 'Oak Trust', 'founder'],
    ['Trustee Co Ltd', 'Oak Trust', 'trustee'],
    ['Kim', 'Oak Trust', 'beneficiary'],
    ['Priya', 'Trustee Co Ltd', '100'],
    ['Oak Trust', 'Target Co', '100'],
  ]);
  assert.deepEqual(ubos(a), ['Kim', 'Priya', 'Sam']);
});

test('majority control of an owning company counts, even under 25% effective', () => {
  const a = run([
    ['Paul', 'Holdco Ltd', '60'],
    ['Quinn', 'Holdco Ltd', '40'],
    ['Holdco Ltd', 'Target Co', '30'],
    ['Rita', 'Target Co', '70'],
  ]);
  assert.equal(owner(a, 'Paul')?.effective, 18);
  assert.deepEqual(ubos(a), ['Paul', 'Rita'], 'Paul controls Holdco; Quinn (12%, no control) is not a UBO');
});

test('voting rights that differ from shares', () => {
  const a = run([
    ['Marcus', 'Target Co', '15'],
    ['Marcus', 'Target Co', 'votes', '55'],
    ['Nina', 'Target Co', '85'],
    ['Nina', 'Target Co', 'votes', '45'],
  ]);
  assert.deepEqual(ubos(a), ['Marcus', 'Nina']);
  assert.match(owner(a, 'Marcus')!.reasons[0], /55% of the votes/);
  assert.equal(owner(a, 'Marcus')?.effective, 15, 'effective ownership still shows shares only');
});

test('nominee: the real owner is the UBO, not the nominee', () => {
  const a = run([
    ['Amara', 'Cedar Nominees Ltd', 'nominee'],
    ['Cedar Nominees Ltd', 'Target Co', '30'],
    ['Bob', 'Target Co', '70'],
  ]);
  assert.deepEqual(ubos(a), ['Amara', 'Bob']);
  assert.equal(owner(a, 'Amara')?.effective, 30);
  assert.ok(!a.warnings.some((w) => w.includes('possible nominee')));
});

test('nominee holding for two people splits by the given %', () => {
  const a = run([
    ['Amara', 'Cedar Nominees Ltd', 'nominee', '50'],
    ['Ben', 'Cedar Nominees Ltd', 'nominee', '50'],
    ['Cedar Nominees Ltd', 'Target Co', '40'],
    ['Bob', 'Target Co', '60'],
  ]);
  assert.equal(owner(a, 'Amara')?.effective, 20);
  assert.deepEqual(ubos(a), ['Bob']);
});

test('other control (e.g. veto rights) makes someone a UBO', () => {
  const a = run([
    ['Marcus', 'Target Co', 'control'],
    ['Bob', 'Target Co', '10'],
  ]);
  assert.deepEqual(ubos(a), ['Marcus']);
});

test('senior manager is named only when nobody else qualifies', () => {
  const none = run([
    ['A', 'Target Co', '20'],
    ['B', 'Target Co', '20'],
    ['C', 'Target Co', '20'],
    ['D', 'Target Co', '20'],
    ['E', 'Target Co', '20'],
    ['Elena', 'Target Co', 'manager'],
  ]);
  assert.deepEqual(ubos(none), ['Elena']);
  assert.match(owner(none, 'Elena')!.reasons[0], /no UBO by ownership or control/);
  assert.ok(none.warnings.some((w) => w.includes('Senior manager shown instead')));

  const some = run([
    ['Bob', 'Target Co', '60'],
    ['Elena', 'Target Co', 'manager'],
  ]);
  assert.deepEqual(ubos(some), ['Bob'], 'a manager is not a UBO when someone owns enough');
});

test('trust roles on a company are flagged (screenshot case)', () => {
  const a = run([
    ['John Smith', 'Alpine Holdings Ltd', 'trustee'],
    ['Sarah Lee', 'Alpine Holdings Ltd', '40'],
    ['Alpine Holdings Ltd', 'Meridian Trading LLC', '60'],
    ['David Chen', 'Meridian Trading LLC', '25'],
    ['John Smith', 'Meridian Trading LLC', '15'],
  ]);
  assert.ok(a.warnings.some((w) => w.startsWith('Alpine Holdings Ltd: founder, trustee, protector and beneficiary apply to trusts and foundations only')));
  assert.ok(!a.warnings.some((w) => w.startsWith('Alpine Holdings Ltd: no')), 'no "missing founder" noise for a company');
});

test('lines that skip a row are routed around the boxes in that row', () => {
  const a = run([
    ['John', 'Alpine Ltd', '60'],
    ['Sarah', 'Alpine Ltd', '40'],
    ['Alpine Ltd', 'Meridian LLC', '60'],
    ['David', 'Meridian LLC', '25'],
    ['John', 'Meridian LLC', '15'],
  ]);
  const route = a.routes[`${keyOf('John')}>${keyOf('Meridian LLC')}`];
  assert.equal(route.length, 1, 'John is two rows above Meridian, so the line gets one waypoint');
  const boxesInRow = a.nodes.filter((n) => n.y === route[0].top);
  assert.ok(boxesInRow.length > 0);
  for (const n of boxesInRow) assert.ok(route[0].x < n.x - 5 || route[0].x > n.x + 190 + 5, `line clears ${n.name}`);
});

test('listed main company: no UBO needed, no "No UBO" warning', () => {
  const a = run([
    ['Big Bank plc', 'New York Stock Exchange', 'listed'],
    ['Fund A', 'Big Bank plc', '30'],
    ['Fund B', 'Big Bank plc', '5'],
  ]);
  assert.equal(a.targetName, 'Big Bank plc');
  assert.equal(a.targetListed, 'New York Stock Exchange');
  assert.deepEqual(ubos(a), [], 'no one is a UBO of a listed company');
  assert.ok(!a.warnings.some((w) => w.startsWith('No UBO found') || w.startsWith('Big Bank plc: shares total')));
});

test('a listed company can be the main company even with no owners entered', () => {
  const a = run([['Big Bank plc', 'NYSE', 'listed']]);
  assert.equal(a.targetName, 'Big Bank plc');
  assert.equal(a.nodes.length, 1, 'the exchange is not drawn as a box');
});

test('listed parent is not looked through; other owners still checked', () => {
  const a = run([
    ['Rich Person', 'Global Retail plc', '60'],
    ['Global Retail plc', 'LSE', 'listed'],
    ['Global Retail plc', 'Harbor Foods Ltd', '70'],
    ['Ana', 'Harbor Foods Ltd', '30'],
  ]);
  assert.deepEqual(ubos(a), ['Ana'], 'Rich Person is above a listed company, so not looked through');
  assert.equal(owner(a, 'Rich Person'), undefined);
  assert.equal(owner(a, 'Global Retail plc')?.listed, 'LSE');
  assert.equal(owner(a, 'Global Retail plc')?.isUbo, false);
  assert.ok(!a.warnings.some((w) => w.startsWith('Global Retail plc: no owners listed')));
});

test('no UBO because a listed company owns most of it: explained', () => {
  const a = run([
    ['Global Retail plc', 'LSE', 'listed'],
    ['Global Retail plc', 'Harbor Foods Ltd', '90'],
    ['Ana', 'Harbor Foods Ltd', '10'],
  ]);
  assert.deepEqual(ubos(a), []);
  assert.ok(a.warnings.some((w) => w === 'No UBO found. Global Retail plc (listed, LSE) holds 90%.'));
});

test('no UBO: warns to name the senior managing official', () => {
  const a = run([
    ['A', 'Target Co', '20'],
    ['B', 'Target Co', '20'],
    ['C', 'Target Co', '20'],
    ['D', 'Target Co', '20'],
    ['E', 'Target Co', '20'],
  ]);
  assert.deepEqual(ubos(a), []);
  assert.ok(a.warnings.some((w) => w.startsWith('No UBO found')));
});

test('an entity is never a UBO, even with the most shares', () => {
  const a = run([
    ['Holdco Ltd', 'Target Co', '80'],
    ['Bob', 'Target Co', '20'],
  ]);
  assert.deepEqual(ubos(a), [], 'Holdco Ltd owns 80% but is a company; Bob is under 25%');
  const holdco = owner(a, 'Holdco Ltd')!;
  assert.equal(holdco.isPerson, false);
  assert.equal(holdco.isUbo, false);
  assert.equal(holdco.reasons[0], 'Owns 80% of Target Co.');
  assert.ok(a.warnings.includes('Holdco Ltd: no owners listed.'));
  assert.ok(a.warnings.some((w) => w.startsWith('No UBO found')));
  assert.equal(a.nodes.find((n) => n.key === keyOf('Holdco Ltd'))!.isUbo, false, 'not gold in the chart');
});

test('trusts and foundations at the top are never UBOs either', () => {
  const a = run([['Blue Foundation', 'Target Co', '100']]);
  assert.deepEqual(ubos(a), []);
  assert.equal(owner(a, 'Blue Foundation')?.isPerson, false);
});

test('person/entity can be set by hand when the name does not tell', () => {
  const rows: R[] = [['Atlas', 'Target Co', '70'], ['Bob', 'Target Co', '30']];
  const guessed = run(rows);
  assert.deepEqual(ubos(guessed), ['Atlas', 'Bob'], 'a plain name is assumed to be a person');
  const fixed = analyse(parseRows(input(rows)).rows, null, 25, 'atLeast', { [keyOf('Atlas')]: 'entity' });
  assert.deepEqual(ubos(fixed), ['Bob']);
  assert.ok(fixed.warnings.includes('Atlas: no owners listed.'));
});

test('a company behind a nominee, or as senior manager, is not a UBO', () => {
  const a = run([
    ['Shadow Holdings Ltd', 'Cedar Nominees Ltd', 'nominee'],
    ['Cedar Nominees Ltd', 'Target Co', '60'],
    ['Bob', 'Target Co', '40'],
  ]);
  assert.deepEqual(ubos(a), ['Bob']);
  const m = run([
    ['A', 'Target Co', '20'],
    ['B', 'Target Co', '20'],
    ['C', 'Target Co', '20'],
    ['D', 'Target Co', '20'],
    ['E', 'Target Co', '20'],
    ['Corporate Director Ltd', 'Target Co', 'manager'],
  ]);
  assert.deepEqual(ubos(m), [], 'a corporate director cannot be named as senior managing official');
});

test('deep chain (8 levels) keeps 100% and the person is a UBO', () => {
  const rows: R[] = [['Person A', 'Level 1 Ltd', '100']];
  for (let i = 1; i < 8; i++) rows.push([`Level ${i} Ltd`, `Level ${i + 1} Ltd`, '100']);
  const a = run(rows);
  assert.equal(a.targetName, 'Level 8 Ltd');
  assert.equal(owner(a, 'Person A')?.effective, 100);
  assert.equal(owner(a, 'Person A')?.isUbo, true);
});

test('large interlinked structure (10 levels, 111 boxes) is exact and fast', () => {
  const rows: R[] = [];
  const L = 10;
  const W = 10;
  for (let p = 0; p < W; p++) rows.push([`Person ${p}`, `C0-${p} Ltd`, '60'], [`Person ${(p + 1) % W}`, `C0-${p} Ltd`, '40']);
  for (let l = 1; l < L; l++)
    for (let c = 0; c < W; c++)
      rows.push(
        [`C${l - 1}-${c} Ltd`, `C${l}-${c} Ltd`, '50'],
        [`C${l - 1}-${(c + 1) % W} Ltd`, `C${l}-${c} Ltd`, '30'],
        [`C${l - 1}-${(c + 3) % W} Ltd`, `C${l}-${c} Ltd`, '20']
      );
  for (let c = 0; c < W; c++) rows.push([`C${L - 1}-${c} Ltd`, 'Target Ltd', '10']);
  const started = Date.now();
  const a = run(rows, 25, 'atLeast', 'Target Ltd');
  assert.ok(Date.now() - started < 1000, 'finishes within a second');
  const total = a.owners.reduce((sum, o) => sum + o.effective, 0);
  assert.ok(Math.abs(total - 100) < 0.1, `the people's effective shares add up to 100% (got ${total})`);
});

test('companies owning each other: cross-holdings are counted', () => {
  // Zoe owns 90% of A. A owns 50% of Target and 40% of B; B owns 30% of Target and 10% of A.
  // A's share of Target, including the loop: (50% + 40% x 30%) / (1 - 40% x 10%) = 64.58%.
  // Zoe's share: 90% x 64.58% = 58.13%.
  const a = run(
    [
      ['Zoe', 'A Ltd', '90'],
      ['B Ltd', 'A Ltd', '10'],
      ['A Ltd', 'Target Ltd', '50'],
      ['A Ltd', 'B Ltd', '40'],
      ['Tom', 'B Ltd', '60'],
      ['B Ltd', 'Target Ltd', '30'],
      ['Ivy', 'Target Ltd', '20'],
    ],
    25,
    'atLeast',
    'Target Ltd'
  );
  assert.equal(owner(a, 'Zoe')?.effective, 58.13);
  assert.equal(owner(a, 'Zoe')?.isUbo, true);
  assert.ok(a.warnings.some((w) => w.startsWith('Circular ownership')), 'the loop is still pointed out');
  assert.ok(!a.warnings.some((w) => w.includes('approximate')));
});

test('loops are reported and do not hang', () => {
  const a = run([
    ['Zoe', 'Loop A Ltd', '100'],
    ['Loop A Ltd', 'Loop B Ltd', '50'],
    ['Loop B Ltd', 'Loop A Ltd', '30'],
  ]);
  assert.ok(a.warnings.some((w) => w.startsWith('Circular ownership')));
});

test('data problems are flagged', () => {
  const w = (rows: R[]) => run(rows).warnings.join('\n');
  assert.match(w([['X', 'Over Co', '70'], ['Y', 'Over Co', '50']]), /Over Co: shares total 120%/);
  assert.match(w([['X', 'Part Co', '55']]), /Part Co: shares total 55%/);
  assert.match(w([['X', 'V Co', 'votes', '70'], ['Y', 'V Co', 'votes', '50'], ['X', 'V Co', '100']]), /V Co: votes total 120%/);
  assert.match(w([['Holdco Ltd', 'Sub Co', '100']]), /Holdco Ltd: no owners listed/);
  assert.match(w([['Blue Foundation', 'Sub Co', '100']]), /Blue Foundation: no founder, trustee or beneficiaries listed/);
  assert.match(w([['Priya', 'Red Trust', 'founder'], ['Red Trust', 'Sub Co', '100']]), /Red Trust: no trustee or beneficiary listed/);
  assert.match(w([['Bob', 'Acme Nominees Ltd', '100'], ['Acme Nominees Ltd', 'Sub Co', '100']]), /Acme Nominees Ltd: possible nominee/);
});

test('row checks: empty rows ignored, bad rows explained, names matched loosely', () => {
  const parsed = parseRows(
    input([
      ['', '', ''],
      ['John', '', '50'],
      ['John', 'Acme', '150'],
      ['Acme', 'acme', '10'],
      ['John', 'Acme', '50%'],
      ['john ', 'ACME', '10'],
      ['John', 'Acme', 'votes', '60'],
      ['Priya', 'Falcon Foundation', 'founder'],
      ['Ann', 'Acme', 'votes', ''],
      ['Amara', 'Nominees Ltd', 'nominee', ''],
    ])
  );
  assert.deepEqual(Object.keys(parsed.errors), ['1', '2', '3', '5', '8']);
  assert.equal(parsed.rows.length, 4, 'shares, votes, founder (no %) and nominee (defaults to 100%)');
  assert.equal(parsed.rows.find((r) => r.kind === 'nominee')?.percent, 100);
});

console.log(`\nAll ${count} ownership tests passed.`);
