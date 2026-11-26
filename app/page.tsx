'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import OrgChart, { chartSize } from '@/components/OrgChart';
import { analyse, KINDS, parseRows, percentMode, type EntityTypes, type InputRow, type Kind, type Rule } from '@/lib/ownership';
import { downloadPdf, downloadPng, fileNameFor } from '@/lib/download';

const STORAGE_KEY = 'ubo-mapper';
const newId = () => Math.random().toString(36).slice(2, 10);
const row = (owner = '', company = '', kind: Kind = 'shares', percent = ''): InputRow => ({ id: newId(), owner, company, kind, percent });

const EXAMPLES: Record<string, { label: string; rows: () => InputRow[] }> = {
  company: {
    label: 'Companies only',
    rows: () => [
      row('John Smith', 'Alpine Holdings Ltd', 'shares', '60'),
      row('Sarah Lee', 'Alpine Holdings Ltd', 'shares', '40'),
      row('Alpine Holdings Ltd', 'Meridian Trading LLC', 'shares', '60'),
      row('David Chen', 'Meridian Trading LLC', 'shares', '25'),
      row('Maria Garcia', 'Meridian Trading LLC', 'shares', '15'),
    ],
  },
  foundation: {
    label: 'Foundation, nominee & control',
    rows: () => [
      row('Priya Nair', 'Falcon Foundation', 'founder'),
      row('Omar Haddad', 'Falcon Foundation', 'trustee'),
      row('Lina Nair', 'Falcon Foundation', 'beneficiary'),
      row('Falcon Foundation', 'Northgate Holdings Ltd', 'shares', '60'),
      row('Amara Okafor', 'Cedar Nominees Ltd', 'nominee'),
      row('Cedar Nominees Ltd', 'Northgate Holdings Ltd', 'shares', '30'),
      row('Marcus Webb', 'Northgate Holdings Ltd', 'shares', '10'),
      row('Marcus Webb', 'Northgate Holdings Ltd', 'control'),
      row('Elena Rossi', 'Northgate Holdings Ltd', 'manager'),
    ],
  },
  listed: {
    label: 'Listed parent company',
    rows: () => [
      row('Global Retail plc', 'London Stock Exchange', 'listed'),
      row('Global Retail plc', 'Harbor Foods Ltd', 'shares', '70'),
      row('Ana Silva', 'Harbor Foods Ltd', 'shares', '30'),
      row('Ken Ito', 'Harbor Foods Ltd', 'manager'),
    ],
  },
};

/** Reads pasted lines like "John Smith, Alpine Ltd, 60" or "Priya, Falcon Foundation, founder". */
function kindFromText(text: string): Kind {
  const t = text.toLowerCase();
  if (/listed|exchange/.test(t)) return 'listed';
  if (/vot/.test(t)) return 'votes';
  if (/found|settl/.test(t)) return 'founder';
  if (/trustee|council|board/.test(t)) return 'trustee';
  if (/protect/.test(t)) return 'protector';
  if (/benef/.test(t)) return 'beneficiary';
  if (/nominee/.test(t)) return 'nominee';
  if (/manag|ceo|director|officer/.test(t)) return 'manager';
  if (/control|veto|appoint/.test(t)) return 'control';
  return 'shares';
}
function parsePasted(text: string): InputRow[] {
  return text
    .split('\n')
    .filter((line) => line.trim())
    .map((line) => {
      const separator = line.includes('\t') ? '\t' : line.includes(';') ? ';' : ',';
      const [owner = '', company = '', ...rest] = line.split(separator).map((s) => s.trim());
      const extra = rest.join(' ');
      return row(owner, company, kindFromText(extra), extra.match(/\d+(?:[.,]\d+)?/)?.[0] ?? '');
    });
}

const button =
  'rounded-md border border-ink/20 bg-white px-3 py-1.5 text-sm hover:bg-ink/5 disabled:cursor-not-allowed disabled:opacity-40';
const input =
  'w-full min-w-0 rounded-md border border-ink/20 bg-white px-2 py-1.5 text-sm focus:border-ledger-teal focus:outline-none disabled:bg-ink/5 disabled:text-ink/30';
const columns = 'grid grid-cols-[1fr_1fr_132px_58px_24px] gap-1.5';

export default function Home() {
  const [rows, setRows] = useState<InputRow[]>([]);
  const [target, setTarget] = useState<string | null>(null);
  const [threshold, setThreshold] = useState(25);
  const [rule, setRule] = useState<Rule>('atLeast');
  const [entityTypes, setEntityTypes] = useState<EntityTypes>({});
  const [loaded, setLoaded] = useState(false);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteText, setPasteText] = useState('');
  const [busy, setBusy] = useState(false);
  const [zoom, setZoom] = useState<number | 'fit'>('fit');
  const [view, setView] = useState({ w: 0, h: 0, wide: true });
  const viewRef = useRef<HTMLDivElement>(null);

  // Track the chart area's size for "Fit".
  useEffect(() => {
    const el = viewRef.current;
    if (!el) return;
    const measure = () => setView({ w: el.clientWidth, h: el.clientHeight, wide: window.innerWidth >= 1024 });
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  const chartRef = useRef<SVGSVGElement>(null);

  // Keep the list in this browser so it is still there next time.
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null');
      if (saved?.rows) {
        setRows(saved.rows.map((r: InputRow) => ({ ...r, kind: r.kind ?? 'shares' })));
        setTarget(saved.target ?? null);
        setThreshold(saved.threshold ?? 25);
        setRule(saved.rule ?? 'atLeast');
        setEntityTypes(saved.entityTypes ?? {});
      } else setRows(EXAMPLES.company.rows());
    } catch {
      setRows(EXAMPLES.company.rows());
    }
    setLoaded(true);
  }, []);
  useEffect(() => {
    if (!loaded) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ rows, target, threshold, rule, entityTypes }));
    } catch {}
  }, [rows, target, threshold, rule, entityTypes, loaded]);

  const { rows: valid, errors } = useMemo(() => parseRows(rows), [rows]);
  const analysis = useMemo(
    () => analyse(valid, target, threshold, rule, entityTypes),
    [valid, target, threshold, rule, entityTypes]
  );
  const allNames = useMemo(
    () => [...new Set(valid.flatMap((r) => [r.owner, r.company]))].sort((a, b) => a.localeCompare(b)),
    [valid]
  );
  const size = chartSize(analysis);
  // Fit shrinks big charts to the screen (never enlarges). On narrow screens the page
  // scrolls down, so only the width counts there.
  const fitZoom = Math.max(
    0.1,
    Math.min(1, (view.w - 40) / size.width, view.wide ? (view.h - 40) / size.height : Infinity)
  );
  const scale = zoom === 'fit' ? fitZoom : zoom;
  const ZOOMS = [0.25, 0.5, 0.75, 1, 1.5, 2];
  const ruleText = rule === 'moreThan' ? `more than ${threshold}%` : `${threshold}% or more`;

  const update = (id: string, field: keyof InputRow, value: string) =>
    setRows((rs) => rs.map((r) => (r.id === id ? { ...r, [field]: value } : r)));

  const download = async (kind: 'png' | 'pdf') => {
    if (!chartRef.current) return;
    setBusy(true);
    try {
      const name = fileNameFor(analysis.targetName);
      await (kind === 'png' ? downloadPng(chartRef.current, name) : downloadPdf(chartRef.current, name));
    } catch (err) {
      alert(`Download failed: ${(err as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="min-h-screen lg:flex">
      <aside className="space-y-8 border-ink/10 bg-white/60 p-5 sm:p-6 lg:h-screen lg:w-[620px] lg:shrink-0 lg:overflow-y-auto lg:border-r">
        <header>
          <h1 className="font-display text-2xl">UBO Mapper</h1>
          <p className="mt-1 text-sm text-ink/60">
            Ownership chart and UBO check.
          </p>
        </header>

        <section>
          <h2 className="mb-2 font-semibold">Ownership &amp; control</h2>
          <div className={`${columns} text-xs text-ink/50`}>
            <span>Person or entity</span>
            <span>Of company / foundation</span>
            <span>Type</span>
            <span>%</span>
          </div>
          <datalist id="names">
            {allNames.map((n) => (
              <option key={n} value={n} />
            ))}
          </datalist>
          <div className="mt-1 space-y-1.5">
            {rows.map((r) => {
              const mode = percentMode(r.kind ?? 'shares');
              return (
                <div key={r.id}>
                  <div className={columns}>
                    <input className={input} list="names" placeholder="e.g. John Smith" value={r.owner}
                      onChange={(e) => update(r.id, 'owner', e.target.value)} aria-label="Person or entity" />
                    <input className={input} list="names" value={r.company}
                      placeholder={r.kind === 'listed' ? 'e.g. London Stock Exchange' : 'e.g. Alpine Ltd'}
                      onChange={(e) => update(r.id, 'company', e.target.value)} aria-label="Of company or foundation" />
                    <select className={`${input} px-1`} value={r.kind ?? 'shares'} aria-label="Type"
                      onChange={(e) => update(r.id, 'kind', e.target.value)}>
                      {KINDS.map((k) => (
                        <option key={k.value} value={k.value}>{k.label}</option>
                      ))}
                    </select>
                    <input className={input} inputMode="decimal" aria-label="Percent"
                      placeholder={mode === 'none' ? '—' : mode === 'optional' ? '100' : '%'}
                      title={mode === 'none' ? 'No percentage needed for this type' : undefined}
                      disabled={mode === 'none'} value={mode === 'none' ? '' : r.percent}
                      onChange={(e) => update(r.id, 'percent', e.target.value)} />
                    <button className="rounded-md text-lg leading-none text-ink/40 hover:bg-ink/5 hover:text-ledger-rust"
                      onClick={() => setRows((rs) => rs.filter((x) => x.id !== r.id))} aria-label="Remove row" title="Remove row">
                      ×
                    </button>
                  </div>
                  {errors[r.id] && <p className="mt-0.5 text-xs text-ledger-rust">{errors[r.id]}</p>}
                </div>
              );
            })}
          </div>

          <div className="mt-3 flex flex-wrap gap-2">
            <button className={button} onClick={() => setRows((rs) => [...rs, row()])}>+ Add row</button>
            <button className={button} onClick={() => setPasteOpen((o) => !o)}>Paste a list</button>
            <select className={`${button} pr-2`} value="" aria-label="Load an example"
              onChange={(e) => {
                const ex = EXAMPLES[e.target.value];
                if (ex) { setRows(ex.rows()); setTarget(null); }
              }}>
              <option value="">Load example…</option>
              {Object.entries(EXAMPLES).map(([key, ex]) => (
                <option key={key} value={key}>{ex.label}</option>
              ))}
            </select>
            <button className={button} disabled={rows.length === 0}
              onClick={() => { if (confirm('Remove all rows?')) { setRows([row()]); setTarget(null); } }}>
              Clear all
            </button>
          </div>

          <details className="mt-3 text-xs text-ink/60">
            <summary className="cursor-pointer">Types</summary>
            <ul className="mt-2 list-disc space-y-1 pl-4">
              <li><b>Shares %</b>: shareholding.</li>
              <li><b>Votes %</b>: voting rights, if different from shares.</li>
              <li><b>Founder, Trustee/council, Protector, Beneficiary</b>: roles in a trust or foundation. No %.</li>
              <li><b>Owner via nominee</b>: person a nominee holds shares for. Empty % = 100%.</li>
              <li><b>Other control</b>: right to appoint the board, veto rights, control by agreement.</li>
              <li><b>Listed</b>: company in the first box, exchange in the second. Not looked through.</li>
              <li><b>Senior manager</b>: CEO or managing director. Shown only when no UBO is found.</li>
            </ul>
          </details>

          {pasteOpen && (
            <div className="mt-3 space-y-2">
              <p className="text-xs text-ink/60">
                One per line: <em>person, company, % or type</em>. Excel columns also work.
              </p>
              <textarea className={`${input} h-28 font-mono text-xs`} value={pasteText} onChange={(e) => setPasteText(e.target.value)}
                placeholder={'John Smith, Alpine Holdings Ltd, 60\nPriya Nair, Falcon Foundation, founder\nMarcus Webb, Northgate Ltd, 55% votes\nGlobal Retail plc, London Stock Exchange, listed'} />
              <button className={button} disabled={!pasteText.trim()}
                onClick={() => {
                  setRows((rs) => [...rs.filter((r) => r.owner || r.company || r.percent), ...parsePasted(pasteText)]);
                  setPasteText('');
                  setPasteOpen(false);
                }}>
                Add these rows
              </button>
            </div>
          )}
        </section>

        {analysis.companies.length > 0 && (
          <section>
            <h2 className="mb-2 font-semibold">Beneficial owners</h2>
            <div className="grid grid-cols-[auto_1fr] items-center gap-x-3 gap-y-2 text-sm">
              <label htmlFor="target" className="text-ink/60">Of</label>
              <select id="target" className={input} value={analysis.targetKey ?? ''} onChange={(e) => setTarget(e.target.value)}>
                {analysis.companies.map((c) => (
                  <option key={c.key} value={c.key}>{c.name}</option>
                ))}
              </select>
              <label htmlFor="threshold" className="text-ink/60">UBO if</label>
              <span className="flex flex-wrap items-center gap-1.5">
                <select className={`${input} !w-auto`} value={rule} onChange={(e) => setRule(e.target.value as Rule)} aria-label="Rule">
                  <option value="atLeast">at least</option>
                  <option value="moreThan">more than</option>
                </select>
                <input id="threshold" className={`${input} !w-16`} type="number" min={1} max={100} value={threshold}
                  onChange={(e) => setThreshold(Math.min(100, Math.max(1, Number(e.target.value) || 25)))} />
                <span>% ownership or votes, or control</span>
              </span>
            </div>
            {analysis.targetListed && (
              <p className="mt-3 rounded-md bg-ledger-teal/10 px-3 py-2 text-sm text-ledger-teal">
                {analysis.targetName} is listed on {analysis.targetListed}. UBO identification not required.
              </p>
            )}
            {(analysis.owners.length > 0 || !analysis.targetListed) && (
            <ul className="mt-3 divide-y divide-ink/10 rounded-md border border-ink/10 bg-white">
              {analysis.owners.length === 0 && <li className="px-3 py-2 text-sm text-ink/50">No owners found.</li>}
              {analysis.owners.map((o) => (
                <li key={o.key} className="px-3 py-2 text-sm">
                  <div className="flex items-center justify-between gap-3">
                    <span className="flex min-w-0 items-center gap-2">
                      <span className="font-medium">{o.name}</span>
                      {!o.listed && (
                        <select
                          className="rounded border border-ink/15 bg-white px-1 py-0.5 text-xs text-ink/60"
                          value={o.isPerson ? 'person' : 'entity'}
                          aria-label={`Is ${o.name} a person or an entity?`}
                          title="Natural person or entity"
                          onChange={(e) => setEntityTypes((t) => ({ ...t, [o.key]: e.target.value as 'person' | 'entity' }))}
                        >
                          <option value="person">Person</option>
                          <option value="entity">Entity</option>
                        </select>
                      )}
                    </span>
                    <span className="flex items-center gap-2">
                      {o.effective > 0 && <span className="font-mono tabular-nums">{o.effective}%</span>}
                      {o.listed && <span className="rounded bg-ledger-teal/10 px-1.5 py-0.5 text-xs font-semibold text-ledger-teal">LISTED</span>}
                      {o.isUbo && <span className="rounded bg-ledger-gold/15 px-1.5 py-0.5 text-xs font-semibold text-[#8A6A17]">UBO</span>}
                    </span>
                  </div>
                  {o.reasons.map((reason) => (
                    <p key={reason} className="mt-0.5 text-xs text-ink/60">{reason}</p>
                  ))}
                </li>
              ))}
            </ul>
            )}
            <p className="mt-1.5 text-xs text-ink/50">
              UBOs are natural persons only. % = effective ownership, direct and indirect.
            </p>
          </section>
        )}

        {analysis.warnings.length > 0 && (
          <section>
            <h2 className="mb-2 font-semibold">Check these</h2>
            <ul className="space-y-1.5 text-sm text-[#7A2D1F]">
              {analysis.warnings.map((w) => (
                <li key={w} className="rounded-md bg-ledger-rust/10 px-3 py-2">{w}</li>
              ))}
            </ul>
          </section>
        )}
      </aside>

      <section className="flex min-w-0 flex-1 flex-col lg:h-screen">
        <div className="flex flex-wrap items-center justify-end gap-2 border-b border-ink/10 px-5 py-3">
          <div className="mr-auto flex items-center gap-1 text-sm" aria-label="Zoom">
            <button className={`${button} px-2.5`} disabled={scale <= ZOOMS[0]} aria-label="Zoom out"
              onClick={() => setZoom([...ZOOMS].reverse().find((z) => z < scale - 0.01) ?? ZOOMS[0])}>−</button>
            <span className="w-12 text-center font-mono text-xs tabular-nums text-ink/60">{Math.round(scale * 100)}%</span>
            <button className={`${button} px-2.5`} disabled={scale >= ZOOMS[ZOOMS.length - 1]} aria-label="Zoom in"
              onClick={() => setZoom(ZOOMS.find((z) => z > scale + 0.01) ?? ZOOMS[ZOOMS.length - 1])}>+</button>
            <button className={`${button} ${zoom === 'fit' ? 'bg-ink/5' : ''}`} onClick={() => setZoom('fit')}>Fit</button>
          </div>
          <button className={button} disabled={!analysis.nodes.length || busy} onClick={() => download('png')}>Download PNG</button>
          <button className={button} disabled={!analysis.nodes.length || busy} onClick={() => download('pdf')}>Download PDF</button>
        </div>
        <div ref={viewRef} className="relative flex-1 overflow-auto p-5">
          {analysis.nodes.length > 0 ? (
            <div className="inline-block rounded-lg border border-ink/10 shadow-sm">
              <OrgChart ref={chartRef} analysis={analysis} ruleText={ruleText} zoom={scale} />
            </div>
          ) : (
            <div className="flex h-full min-h-64 items-center justify-center text-center text-sm text-ink/50">
              Add a row to start.
            </div>
          )}
        </div>
      </section>
    </main>
  );
}
