import { forwardRef } from 'react';
import { edgeLabel, NODE_H, NODE_W, type Analysis, type ChartEdge } from '@/lib/ownership';

// Plain SVG with inline colours and system fonts, so the PNG/PDF export
// looks exactly like the screen.
const FONT = 'Helvetica, Arial, sans-serif';
const HEADER_H = 84;
const COLORS = {
  ink: '#14181F',
  muted: '#5A6272',
  line: '#8A93A3',
  role: '#5B3FA0',
  box: '#FFFFFF',
  boxStroke: '#C9C2AE',
  target: '#14181F',
  ubo: '#FBF3E0',
  uboStroke: '#B8862E',
  listed: '#E6F2F2',
  listedStroke: '#0F6E6E',
};

/** Splits a name into at most two lines that fit in a box. */
function wrap(text: string, maxChars = 24): string[] {
  const lines: string[] = [];
  let line = '';
  for (const word of text.split(' ')) {
    if ((line + ' ' + word).trim().length > maxChars && line) {
      lines.push(line);
      line = word;
    } else line = (line + ' ' + word).trim();
  }
  lines.push(line);
  const shorten = (l: string) => (l.length > maxChars ? l.slice(0, maxChars - 1) + '…' : l);
  return lines.length > 2 ? [shorten(lines[0]), shorten(lines.slice(1).join(' '))] : lines.map(shorten);
}

/** One drawn line per owner→entity pair, even if it has several links (e.g. shares and votes). */
interface Link {
  from: string;
  to: string;
  label: string;
  dashed: boolean;
}
function linksOf(edges: ChartEdge[]): Link[] {
  const byPair = new Map<string, ChartEdge[]>();
  for (const e of edges) byPair.set(`${e.from}>${e.to}`, [...(byPair.get(`${e.from}>${e.to}`) ?? []), e]);
  return [...byPair.values()].map((es) => ({
    from: es[0].from,
    to: es[0].to,
    label: es.map(edgeLabel).join(' · '),
    dashed: es.every((e) => e.kind !== 'shares'),
  }));
}

/** Full size of the chart in pixels (also used for zoom-to-fit). */
export const chartSize = (analysis: Analysis) => ({
  width: Math.max(analysis.width, 680),
  height: analysis.height + HEADER_H,
});

const OrgChart = forwardRef<SVGSVGElement, { analysis: Analysis; ruleText: string; zoom?: number }>(function OrgChart(
  { analysis, ruleText, zoom = 1 },
  ref
) {
  const { nodes, targetName, routes } = analysis;
  const links = linksOf(analysis.edges);
  const routeOf = (l: Link) => routes[`${l.from}>${l.to}`] ?? [];
  const { width, height } = chartSize(analysis);
  const offsetX = (width - analysis.width) / 2;
  const byKey = new Map(nodes.map((n) => [n.key, n]));
  const date = new Date().toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' });

  // Spread lines across the edge of each box instead of all meeting in the middle,
  // ordered by where each line heads next so they don't cross.
  const centre = (key: string) => byKey.get(key)!.x + NODE_W / 2;
  const nextX = (l: Link) => routeOf(l)[0]?.x ?? centre(l.to);
  const prevX = (l: Link) => routeOf(l).at(-1)?.x ?? centre(l.from);
  const port = (key: string, towards: (l: Link) => number, mine: (l: Link) => string) => {
    const list = links.filter((l) => mine(l) === key).sort((a, b) => towards(a) - towards(b));
    return (l: Link) => byKey.get(key)!.x + (NODE_W * (list.indexOf(l) + 1)) / (list.length + 1);
  };
  const outX = new Map(nodes.map((n) => [n.key, port(n.key, nextX, (l) => l.from)]));
  const inX = new Map(nodes.map((n) => [n.key, port(n.key, prevX, (l) => l.to)]));

  return (
    <svg
      ref={ref}
      xmlns="http://www.w3.org/2000/svg"
      width={width}
      height={height}
      style={{ width: width * zoom, height: height * zoom, display: 'block' }}
      viewBox={`0 0 ${width} ${height}`}
      fontFamily={FONT}
    >
      <rect width={width} height={height} fill="#FFFFFF" />
      <text x={30} y={32} fontSize={18} fontWeight={700} fill={COLORS.ink}>
        {targetName ? `Ownership structure of ${targetName}` : 'Ownership structure'}
      </text>
      <text x={30} y={52} fontSize={11} fill={COLORS.muted}>
        {`Gold = UBO (${ruleText}) · Teal = listed company`}
      </text>
      <text x={30} y={68} fontSize={11} fill={COLORS.muted}>
        {`Solid = shares · Dashed = votes, control or role · ${date}`}
      </text>

      <defs>
        <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto">
          <path d="M0,0 L10,5 L0,10 z" fill={COLORS.line} />
        </marker>
        <marker id="arrow-role" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto">
          <path d="M0,0 L10,5 L0,10 z" fill={COLORS.role} />
        </marker>
      </defs>

      <g transform={`translate(${offsetX}, ${HEADER_H})`}>
        {links.map((l) => {
          const a = byKey.get(l.from)!;
          const b = byKey.get(l.to)!;
          const x1 = outX.get(l.from)!(l);
          const x2 = inX.get(l.to)!(l);
          const goesDown = b.y > a.y;
          const y1 = goesDown ? a.y + NODE_H : a.y;
          const y2 = goesDown ? b.y - 2 : b.y + NODE_H + 2;
          // Curve from box to box, passing straight down through any rows it skips.
          const curve = (xa: number, ya: number, xb: number, yb: number) =>
            `C${xa},${(ya + yb) / 2} ${xb},${(ya + yb) / 2} ${xb},${yb}`;
          const via = goesDown ? routeOf(l) : [];
          let d = `M${x1},${y1}`;
          let [lastX, lastY] = [x1, y1];
          for (const p of via) {
            d += ` ${curve(lastX, lastY, p.x, p.top)} L${p.x},${p.top + NODE_H}`;
            [lastX, lastY] = [p.x, p.top + NODE_H];
          }
          d += ` ${curve(lastX, lastY, x2, y2)}`;
          // Label on the last stretch, just above the company it points to.
          const midY = (lastY + y2) / 2;
          const midX = (lastX + x2) / 2;
          const labelW = l.label.length * 6.4 + 14;
          const color = l.dashed ? COLORS.role : COLORS.line;
          return (
            <g key={`${l.from}>${l.to}`}>
              <path
                d={d}
                fill="none"
                stroke={color}
                strokeWidth={1.5}
                strokeDasharray={l.dashed ? '5 4' : undefined}
                markerEnd={l.dashed ? 'url(#arrow-role)' : 'url(#arrow)'}
              />
              <rect x={midX - labelW / 2} y={midY - 10} width={labelW} height={20} rx={10} fill="#FFFFFF" stroke={color} />
              <text x={midX} y={midY + 4} fontSize={11.5} fontWeight={700} textAnchor="middle" fill={l.dashed ? COLORS.role : COLORS.ink}>
                {l.label}
              </text>
            </g>
          );
        })}

        {nodes.map((n) => {
          const lines = wrap(n.name);
          const exchange = n.listed && n.listed.length > 20 ? n.listed.slice(0, 19) + '…' : n.listed;
          const sub = n.isTarget
            ? n.listed ? 'MAIN COMPANY · LISTED' : 'MAIN COMPANY'
            : n.listed
              ? `Listed · ${exchange}`
              : [n.effective !== null ? `${n.effective}% effective` : '', n.isUbo ? 'UBO' : ''].filter(Boolean).join(' · ');
          const fill = n.isTarget ? COLORS.target : n.isUbo ? COLORS.ubo : n.listed ? COLORS.listed : COLORS.box;
          const stroke = n.isTarget ? COLORS.target : n.isUbo ? COLORS.uboStroke : n.listed ? COLORS.listedStroke : COLORS.boxStroke;
          const textColor = n.isTarget ? '#FFFFFF' : COLORS.ink;
          const contentH = lines.length * 16 + (sub ? 15 : 0);
          const top = n.y + (NODE_H - contentH) / 2 + 12;
          return (
            <g key={n.key}>
              <rect x={n.x} y={n.y} width={NODE_W} height={NODE_H} rx={8} fill={fill} stroke={stroke} strokeWidth={n.isUbo ? 2 : 1.2} />
              {lines.map((line, i) => (
                <text key={i} x={n.x + NODE_W / 2} y={top + i * 16} fontSize={13} fontWeight={600} textAnchor="middle" fill={textColor}>
                  {line}
                </text>
              ))}
              {sub && (
                <text
                  x={n.x + NODE_W / 2}
                  y={top + lines.length * 16 + 1}
                  fontSize={10.5}
                  fontWeight={n.isUbo ? 700 : 400}
                  textAnchor="middle"
                  fill={n.isTarget ? '#D8D3C6' : n.isUbo ? '#8A6A17' : n.listed ? COLORS.listedStroke : COLORS.muted}
                  letterSpacing={n.isTarget ? 1 : 0}
                >
                  {sub}
                </text>
              )}
            </g>
          );
        })}
      </g>
    </svg>
  );
});

export default OrgChart;
