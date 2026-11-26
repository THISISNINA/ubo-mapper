// Turns a list of ownership / control rows into a laid-out chart and works
// out who the ultimate beneficial owners (UBOs) of a chosen company are.
//
// UBO rules applied (in line with FATF guidance and the EU AML rules):
// 1. Ownership: effective share (direct + through other companies) meets the threshold.
// 2. Voting rights: effective votes meet the threshold.
// 3. Control through an owner: majority (>50%) control of a company that itself
//    owns/controls enough, at any level.
// 4. Trusts and foundations: the founder/settlor, trustees/council, protector and
//    beneficiaries of a trust or foundation that owns/controls enough are all UBOs,
//    whatever their percentage. Corporate trustees are looked through.
// 5. Other control (right to appoint most of the board, veto rights, control by
//    agreement): counts as control.
// 6. Nominees are never UBOs; the person behind the nominee takes their place.
// 7. Only if nobody qualifies: the senior managing official(s) are named instead.
// 0. A UBO is always a natural person. Companies, trusts and foundations are never
//    UBOs themselves, however much they own: the people behind them are.
// 8. Companies listed on a regulated stock exchange publish their shareholders, so
//    they are not looked through: their own owners don't need to be identified.

export type Kind =
  | 'shares'
  | 'votes'
  | 'founder'
  | 'trustee'
  | 'protector'
  | 'beneficiary'
  | 'nominee'
  | 'control'
  | 'manager'
  | 'listed';
export type Rule = 'atLeast' | 'moreThan';

export const KINDS: { value: Kind; label: string; percent: 'required' | 'optional' | 'none' }[] = [
  { value: 'shares', label: 'Shares %', percent: 'required' },
  { value: 'votes', label: 'Votes %', percent: 'required' },
  { value: 'founder', label: 'Founder/settlor', percent: 'none' },
  { value: 'trustee', label: 'Trustee/council', percent: 'none' },
  { value: 'protector', label: 'Protector', percent: 'none' },
  { value: 'beneficiary', label: 'Beneficiary', percent: 'none' },
  { value: 'nominee', label: 'Owner via nominee', percent: 'optional' },
  { value: 'control', label: 'Other control', percent: 'none' },
  { value: 'manager', label: 'Senior manager', percent: 'none' },
  { value: 'listed', label: 'Listed', percent: 'none' },
];
export const percentMode = (k: Kind) => KINDS.find((x) => x.value === k)!.percent;

const TRUST_ROLES: Kind[] = ['founder', 'trustee', 'protector', 'beneficiary'];
const ROLE_STEP: Partial<Record<Kind, string>> = {
  founder: 'is founder / settlor of',
  trustee: 'is trustee / council member of',
  protector: 'is protector of',
  beneficiary: 'is beneficiary of',
  control: 'controls',
};

export interface InputRow {
  id: string;
  owner: string;
  company: string;
  kind: Kind;
  percent: string;
}

export interface Row {
  owner: string;
  company: string;
  kind: Kind;
  percent: number | null;
}

export interface ChartNode {
  key: string;
  name: string;
  x: number;
  y: number;
  isTarget: boolean;
  /** Effective ownership % of the main company, for owners at the top of the chart. */
  effective: number | null;
  isUbo: boolean;
  /** Stock exchange, if this company is listed. */
  listed: string | null;
}

export interface ChartEdge {
  from: string;
  to: string;
  kind: Kind;
  percent: number | null;
}

export interface Owner {
  key: string;
  name: string;
  effective: number;
  isUbo: boolean;
  /** Natural person (can be a UBO) or entity (company, trust, foundation: never a UBO). */
  isPerson: boolean;
  listed: string | null;
  reasons: string[];
}

export type EntityTypes = Record<string, 'person' | 'entity'>;

export interface Analysis {
  nodes: ChartNode[];
  edges: ChartEdge[];
  /** For lines that skip rows: points (centre x, row top y) to pass through, keyed "from>to". */
  routes: Record<string, { x: number; top: number }[]>;
  width: number;
  height: number;
  targetKey: string | null;
  targetName: string;
  /** Stock exchange, if the main company is listed (then no UBO is needed). */
  targetListed: string | null;
  companies: { key: string; name: string }[];
  owners: Owner[];
  warnings: string[];
}

export const NODE_W = 190;
export const NODE_H = 62;
const GAP_X = 36;
const GAP_Y = 100;
const PADDING = 30;
const WAYPOINT_W = 24; // room kept free for a line passing through a row
const WAYPOINT_GAP = 10;

export const keyOf = (name: string) => name.trim().replace(/\s+/g, ' ').toLowerCase();
// Rounds to 2 decimals; toPrecision first removes float noise (58.12499999... -> 58.125 -> 58.13).
const round = (n: number) => Math.round(Number((n * 100).toPrecision(12))) / 100;
const COMPANY_WORDS =
  /\b(ltd|limited|llc|inc|corp|corporation|co|company|holdings?|group|gmbh|ag|sa|sarl|bv|nv|plc|lp|llp|fz|fze|spv|partners)\b\.?/i;
const TRUST_WORDS = /\b(trust|foundation|stiftung|fondation|fundaci[oó]n|fondazione|stichting)\b/i;

export function edgeLabel(e: ChartEdge): string {
  if (e.kind === 'shares') return `${e.percent}%`;
  if (e.kind === 'votes') return `${e.percent}% votes`;
  if (e.kind === 'nominee') return e.percent === null || e.percent === 100 ? 'via nominee' : `${e.percent}% via nominee`;
  return {
    founder: 'founder',
    trustee: 'trustee / council',
    protector: 'protector',
    beneficiary: 'beneficiary',
    control: 'control',
    manager: 'senior manager',
    listed: 'listed',
  }[e.kind];
}

/** Checks the typed rows. Empty rows are ignored; bad rows get an error message. */
export function parseRows(input: InputRow[]): { rows: Row[]; errors: Record<string, string> } {
  const rows: Row[] = [];
  const errors: Record<string, string> = {};
  const seen = new Set<string>();

  for (const r of input) {
    const kind: Kind = KINDS.some((k) => k.value === r.kind) ? r.kind : 'shares';
    const mode = percentMode(kind);
    const owner = r.owner.trim().replace(/\s+/g, ' ');
    const company = r.company.trim().replace(/\s+/g, ' ');
    const percentText = mode === 'none' ? '' : (r.percent ?? '').trim().replace('%', '').replace(',', '.');
    if (!owner && !company && !percentText) continue;

    const percent = Number(percentText);
    const badPercent = !Number.isFinite(percent) || percent <= 0 || percent > 100;
    const pair = `${keyOf(owner)}|${keyOf(company)}|${kind}`;
    if (!owner || !company) errors[r.id] = 'Fill in both names.';
    else if (mode === 'required' && (!percentText || badPercent)) errors[r.id] = 'Enter a % from 0 to 100.';
    else if (mode === 'optional' && percentText && badPercent) errors[r.id] = 'Enter a % from 0 to 100, or leave it empty.';
    else if (keyOf(owner) === keyOf(company)) errors[r.id] = 'Owner and company are the same.';
    else if (seen.has(pair)) errors[r.id] = 'This row is listed twice.';
    else {
      seen.add(pair);
      rows.push({ owner, company, kind, percent: percentText ? percent : mode === 'optional' ? 100 : null });
    }
  }
  return { rows, errors };
}

export function analyse(
  allRows: Row[],
  requestedTarget: string | null,
  threshold: number,
  rule: Rule = 'atLeast',
  /** The user's own choice of person/entity for names at the top of the chart. */
  entityTypes: EntityTypes = {}
): Analysis {
  // "Listed on exchange" rows mark a company as listed; they are not ownership links.
  const listedRows = allRows.filter((r) => r.kind === 'listed');
  const rows = allRows.filter((r) => r.kind !== 'listed');
  const listed = new Map(listedRows.map((r) => [keyOf(r.owner), r.company]));

  // Names, in the order they first appear.
  const names = new Map<string, string>();
  for (const r of rows) {
    if (!names.has(keyOf(r.owner))) names.set(keyOf(r.owner), r.owner);
    if (!names.has(keyOf(r.company))) names.set(keyOf(r.company), r.company);
  }
  for (const r of listedRows) if (!names.has(keyOf(r.owner))) names.set(keyOf(r.owner), r.owner);
  const keys = [...names.keys()];
  const name = (k: string) => names.get(k)!;
  const edges: ChartEdge[] = rows.map((r) => ({ from: keyOf(r.owner), to: keyOf(r.company), kind: r.kind, percent: r.percent }));

  const ownersOf = new Map<string, ChartEdge[]>(keys.map((k) => [k, []]));
  const ownedBy = new Map<string, ChartEdge[]>(keys.map((k) => [k, []]));
  for (const e of edges) {
    ownersOf.get(e.to)!.push(e);
    ownedBy.get(e.from)!.push(e);
  }
  const isTop = (k: string) => ownersOf.get(k)!.length === 0;
  /**
   * Only natural people can be UBOs. Anything with owners or roles listed, or a listed
   * company, is an entity. At the top of the chart the name decides (Ltd, Trust, ...),
   * unless the user said otherwise.
   */
  const isPerson = (k: string) => {
    if (!isTop(k) || listed.has(k)) return false;
    if (entityTypes[k]) return entityTypes[k] === 'person';
    return !COMPANY_WORDS.test(name(k)) && !TRUST_WORDS.test(name(k));
  };

  const companies = keys.filter((k) => !isTop(k) || listed.has(k)).map((k) => ({ key: k, name: name(k) }));
  const bottom = companies.find((c) => ownedBy.get(c.key)!.length === 0);
  const targetKey =
    requestedTarget && companies.some((c) => c.key === requestedTarget)
      ? requestedTarget
      : (bottom ?? companies[0])?.key ?? null;

  const warnings: string[] = [];

  // ---- Layout: rows, top to bottom ----
  // Each entity sits one row below its lowest owner (loops are cut)...
  const layer = new Map<string, number>();
  const onStack = new Set<string>();
  const loops = new Set<string>();
  const place = (k: string): number | undefined => {
    if (layer.has(k)) return layer.get(k);
    if (onStack.has(k)) return undefined;
    onStack.add(k);
    let l = 0;
    for (const e of ownersOf.get(k)!) {
      const ownerLayer = place(e.from);
      if (ownerLayer === undefined) loops.add([name(e.from), name(k)].sort().join(' and '));
      else l = Math.max(l, ownerLayer + 1);
    }
    onStack.delete(k);
    layer.set(k, l);
    return l;
  };
  keys.forEach(place);
  // ...then each owner moves down to sit just above what it owns, so lines stay short.
  for (const k of [...keys].sort((a, b) => layer.get(b)! - layer.get(a)!)) {
    const below = ownedBy.get(k)!.map((e) => layer.get(e.to)!).filter((l) => l > layer.get(k)!);
    if (below.length) layer.set(k, Math.min(...below) - 1);
  }
  for (const pair of loops) warnings.push(`Circular ownership: ${pair}.`);

  // Lines that skip rows get a waypoint in every row they cross, so they are
  // routed through the gaps between boxes instead of behind them.
  const maxLayer = Math.max(0, ...layer.values());
  const byLayer: string[][] = Array.from({ length: maxLayer + 1 }, () => []);
  for (const k of keys) byLayer[layer.get(k)!].push(k);
  const up = new Map<string, string[]>();
  const down = new Map<string, string[]>();
  const waypoints = new Map<string, string[]>();
  for (const e of edges) {
    const pair = `${e.from}>${e.to}`;
    const from = layer.get(e.from)!;
    const to = layer.get(e.to)!;
    if (waypoints.has(pair) || to <= from) continue; // already done, or a loop going back up
    const chain = [e.from];
    for (let l = from + 1; l < to; l++) {
      const id = `~${pair}~${l}`;
      byLayer[l].push(id);
      layer.set(id, l);
      chain.push(id);
    }
    chain.push(e.to);
    for (let i = 1; i < chain.length; i++) {
      down.set(chain[i - 1], [...(down.get(chain[i - 1]) ?? []), chain[i]]);
      up.set(chain[i], [...(up.get(chain[i]) ?? []), chain[i - 1]]);
    }
    waypoints.set(pair, chain.slice(1, -1));
  }

  // Order each row to keep owners above what they own (fewer crossing lines).
  const widthOf = (id: string) => (names.has(id) ? NODE_W : WAYPOINT_W);
  const spacing = (a: string, b: string) =>
    widthOf(a) / 2 + (names.has(a) && names.has(b) ? GAP_X : WAYPOINT_GAP) + widthOf(b) / 2;
  const xOf = new Map<string, number>();
  const setX = () =>
    byLayer.forEach((ids) => {
      const xs = ids.reduce<number[]>((acc, id, i) => [...acc, i ? acc[i - 1] + spacing(ids[i - 1], id) : 0], []);
      const mid = xs.length ? xs[xs.length - 1] / 2 : 0;
      ids.forEach((id, i) => xOf.set(id, xs[i] - mid));
    });
  const average = (id: string, neighbours: string[] = []) =>
    neighbours.length ? neighbours.reduce((sum, n) => sum + xOf.get(n)!, 0) / neighbours.length : xOf.get(id)!;
  setX();
  for (let pass = 0; pass < 4; pass++) {
    for (let l = 1; l <= maxLayer; l++) {
      const pos = new Map(byLayer[l].map((id) => [id, average(id, up.get(id))]));
      byLayer[l].sort((a, b) => pos.get(a)! - pos.get(b)!);
      setX();
    }
    for (let l = maxLayer - 1; l >= 0; l--) {
      const pos = new Map(byLayer[l].map((id) => [id, average(id, down.get(id))]));
      byLayer[l].sort((a, b) => pos.get(a)! - pos.get(b)!);
      setX();
    }
  }
  // Centre owners above what they own, keeping boxes from overlapping.
  for (let l = maxLayer - 1; l >= 0; l--) {
    const ids = byLayer[l];
    const want = ids.map((id) => average(id, down.get(id)));
    const placed: number[] = [];
    want.forEach((w, i) => placed.push(i ? Math.max(w, placed[i - 1] + spacing(ids[i - 1], ids[i])) : w));
    const shift = want.reduce((sum, w, i) => sum + w - placed[i], 0) / want.length;
    ids.forEach((id, i) => xOf.set(id, placed[i] + shift));
  }

  // ---- Effective ownership and votes ----
  const pairOf = (e: ChartEdge) => `${e.from}|${e.to}`;
  const hasVotes = new Set(edges.filter((e) => e.kind === 'votes').map(pairOf));
  const ownWeight = (e: ChartEdge) => (e.kind === 'shares' || e.kind === 'nominee' ? e.percent : null);
  const voteWeight = (e: ChartEdge) =>
    e.kind === 'votes' || e.kind === 'nominee' || (e.kind === 'shares' && !hasVotes.has(pairOf(e))) ? e.percent : null;

  /**
   * Effective % of `target` held by every entity at once: an entity's share is the sum,
   * over everything it holds, of (% held x that holding's own share of the target).
   * Solved with repeated passes (exact for any size, and it also handles companies
   * that own each other). Listed companies are not looked through.
   */
  const weights = { own: ownWeight, votes: voteWeight };
  const bottomUp = [...keys].sort((a, b) => layer.get(b)! - layer.get(a)!); // fewer passes
  const solved = new Map<string, Map<string, number>>();
  let imprecise = false;
  const effective = (from: string, target: string, kind: keyof typeof weights) => {
    const id = `${kind}:${target}`;
    if (!solved.has(id)) {
      const share = new Map<string, number>(keys.map((k) => [k, 0]));
      let changed = true;
      for (let pass = 0; pass < 2000 && changed; pass++) {
        changed = false;
        for (const k of bottomUp) {
          if (k === target) continue;
          let total = 0;
          for (const e of ownedBy.get(k)!) {
            const w = weights[kind](e);
            if (w !== null) total += (w / 100) * (e.to === target ? 1 : listed.has(e.to) ? 0 : share.get(e.to)!);
          }
          total = Math.min(total, 1);
          if (Math.abs(total - share.get(k)!) > 1e-12) changed = true;
          share.set(k, total);
        }
      }
      if (changed) imprecise = true;
      solved.set(id, new Map([...share].map(([k, v]) => [k, round(v * 100)])));
    }
    return solved.get(id)!.get(from)!;
  };

  // ---- UBOs: walk up from the main company, collecting who owns or controls it ----
  const meets = (v: number) => (rule === 'moreThan' ? v > threshold : v >= threshold);
  const chains = new Map<string, string[][]>();
  const targetListed = targetKey ? listed.get(targetKey) ?? null : null;
  if (targetKey && !targetListed) {
    // "target": find everyone who owns/controls this entity (threshold applies).
    // "control": this entity owns/controls enough already; find who controls *it* (majority, roles).
    type Mode = 'target' | 'control';
    const queue: { key: string; mode: Mode; steps: string[] }[] = [{ key: targetKey, mode: 'target', steps: [] }];
    const queued = new Set([`${targetKey}:target`]);
    const add = (k: string, step: string, parent: string[], mode: Mode) => {
      if (k === targetKey || listed.has(k)) return; // listed companies are not looked through
      const chain = [step, ...parent];
      const list = chains.get(k) ?? [];
      if (list.length < 3 && !list.some((c) => c.join() === chain.join())) list.push(chain);
      chains.set(k, list);
      if (!isTop(k) && !queued.has(`${k}:${mode}`)) {
        queued.add(`${k}:${mode}`);
        queue.push({ key: k, mode, steps: chain });
      }
    };
    while (queue.length) {
      const { key: x, mode, steps } = queue.shift()!;
      if (mode === 'target') {
        for (const k of keys) {
          if (k === x) continue;
          const own = effective(k, x, 'own');
          const votes = effective(k, x, 'votes');
          if (meets(own)) add(k, `owns ${own}% of ${name(x)}`, steps, 'control');
          else if (meets(votes)) add(k, `holds ${votes}% of the votes in ${name(x)}`, steps, 'control');
        }
      } else {
        for (const e of ownersOf.get(x)!) {
          if ((e.kind === 'shares' || e.kind === 'votes') && e.percent! > 50)
            add(e.from, `${e.kind === 'votes' ? `holds ${e.percent}% of the votes in` : `owns ${e.percent}% of`} ${name(x)}`, steps, 'control');
        }
      }
      for (const e of ownersOf.get(x)!) {
        if (ROLE_STEP[e.kind]) add(e.from, `${ROLE_STEP[e.kind]} ${name(x)}`, steps, 'target');
        // A nominee shared between several real owners passes on only their part
        // (already counted in effective ownership), so only a majority holder takes its place.
        if (e.kind === 'nominee' && e.percent! > 50) add(e.from, `is the real owner behind ${name(x)}`, steps, 'control');
      }
    }
    // Nobody qualifies: name the senior managing official(s) instead.
    if (![...chains.keys()].some(isPerson)) {
      for (const e of ownersOf.get(targetKey)!) {
        if (e.kind === 'manager' && isPerson(e.from))
          chains.set(e.from, [[`is senior manager of ${name(targetKey)} (no UBO by ownership or control)`]]);
      }
    }
  }
  const explain = (chain: string[]) => {
    const text = chain.join(', which ').replace(/^is /, '');
    return text[0].toUpperCase() + text.slice(1) + '.';
  };

  const owners: Owner[] = keys
    .filter((k) => k !== targetKey && (isTop(k) || listed.has(k)))
    .map((k) => {
      const exchange = listed.get(k) ?? null;
      const person = isPerson(k);
      const chain = (chains.get(k) ?? []).map(explain);
      const reasons = exchange
        ? [`Listed on ${exchange}. Not looked through.`]
        : person
          ? chain
          : chain.slice(0, 1);
      return {
        key: k,
        name: name(k),
        effective: targetKey ? effective(k, targetKey, 'own') : 0,
        isUbo: person && chain.length > 0,
        isPerson: person,
        listed: exchange,
        reasons,
      };
    })
    .filter((o) => o.isUbo || o.effective > 0 || (!o.isPerson && o.reasons.length > 0))
    .sort((a, b) => Number(b.isUbo) - Number(a.isUbo) || b.effective - a.effective);

  // ---- Things to check ----
  for (const o of owners) {
    if (o.listed || o.isPerson) continue;
    if (TRUST_WORDS.test(o.name)) warnings.push(`${o.name}: no founder, trustee or beneficiaries listed.`);
    else warnings.push(`${o.name}: no owners listed.`);
  }
  for (const k of keys) {
    const into = ownersOf.get(k)!;
    const sum = (kind: Kind) => round(into.filter((e) => e.kind === kind).reduce((s, e) => s + (e.percent ?? 0), 0));
    const has = (...kinds: Kind[]) => into.some((e) => kinds.includes(e.kind));
    const shares = sum('shares');
    if (shares > 100) warnings.push(`${name(k)}: shares total ${shares}%.`);
    else if (shares > 0 && shares < 100 && !listed.has(k)) warnings.push(`${name(k)}: shares total ${shares}%.`);
    if (sum('votes') > 100) warnings.push(`${name(k)}: votes total ${sum('votes')}%.`);
    if (sum('nominee') > 100) warnings.push(`${name(k)}: underlying owners total ${sum('nominee')}%.`);

    const hasTrustRoles = has(...TRUST_ROLES);
    const looksLikeCompany = has('shares', 'votes') || (COMPANY_WORDS.test(name(k)) && !TRUST_WORDS.test(name(k)));
    if (hasTrustRoles && looksLikeCompany) {
      warnings.push(
        `${name(k)}: founder, trustee, protector and beneficiary apply to trusts and foundations only.`
      );
    } else if (!isTop(k) && (hasTrustRoles || TRUST_WORDS.test(name(k)))) {
      // (A trust/foundation at the very top was already warned about above.)
      const missing = [
        !has('founder') && 'founder',
        !has('trustee') && 'trustee',
        !has('beneficiary') && 'beneficiary',
      ].filter(Boolean);
      if (missing.length) warnings.push(`${name(k)}: no ${missing.join(' or ')} listed.`);
    }
    if (/nominee/i.test(name(k)) && ownedBy.get(k)!.length && !has('nominee'))
      warnings.push(`${name(k)}: possible nominee, no underlying owner listed.`);
  }
  const listedParent = owners.find((o) => o.listed && meets(o.effective));
  if (imprecise)
    warnings.push('Circular ownership: effective percentages are approximate.');
  if (targetKey && !targetListed && !owners.some((o) => o.isUbo))
    warnings.push(
      listedParent
        ? `No UBO found. ${listedParent.name} (listed, ${listedParent.listed}) holds ${listedParent.effective}%.`
        : `No UBO found. Add the senior managing official (type "Senior manager").`
    );
  else if (targetKey && owners.some((o) => o.reasons.some((r) => r.includes('no UBO by ownership or control'))))
    warnings.push('No UBO by ownership or control. Senior manager shown instead.');

  // ---- Coordinates ----
  const ids = [...xOf.keys()];
  const minX = ids.length ? Math.min(...ids.map((id) => xOf.get(id)! - widthOf(id) / 2)) : 0;
  const maxX = ids.length ? Math.max(...ids.map((id) => xOf.get(id)! + widthOf(id) / 2)) : 0;
  const left = (id: string) => PADDING + xOf.get(id)! - minX;
  const top = (id: string) => PADDING + layer.get(id)! * (NODE_H + GAP_Y);

  const ownerByKey = new Map(owners.map((o) => [o.key, o]));
  const nodes: ChartNode[] = keys.map((k) => {
    const o = ownerByKey.get(k);
    return {
      key: k,
      name: name(k),
      x: left(k) - NODE_W / 2,
      y: top(k),
      isTarget: k === targetKey,
      effective: o && o.effective > 0 ? o.effective : null,
      isUbo: o?.isUbo ?? false,
      listed: listed.get(k) ?? null,
    };
  });
  const routes = Object.fromEntries(
    [...waypoints].map(([pair, points]) => [pair, points.map((id) => ({ x: left(id), top: top(id) }))])
  );

  return {
    nodes,
    edges,
    routes,
    width: keys.length ? maxX - minX + PADDING * 2 : 0,
    height: keys.length ? (maxLayer + 1) * NODE_H + maxLayer * GAP_Y + PADDING * 2 : 0,
    targetKey,
    targetName: targetKey ? name(targetKey) : '',
    targetListed,
    companies,
    owners,
    warnings,
  };
}
