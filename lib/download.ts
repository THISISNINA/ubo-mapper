// Saves the chart (an <svg> element) as a PNG or PDF file.
// The PDF uses a JPEG copy: a full-size PNG would make a ~15 MB file.

/** Browsers refuse very large canvases (Safari: ~16 million pixels), so big charts get a lower scale. */
const MAX_PIXELS = 16_000_000;

async function toImage(svg: SVGSVGElement, type: 'image/png' | 'image/jpeg') {
  const width = Number(svg.getAttribute('width'));
  const height = Number(svg.getAttribute('height'));
  const scale = Math.min(3, Math.sqrt(MAX_PIXELS / (width * height)));
  const source = new XMLSerializer().serializeToString(svg);

  const img = new Image();
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error('Could not draw the chart.'));
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(source);
  });

  const canvas = document.createElement('canvas');
  canvas.width = Math.round(width * scale);
  canvas.height = Math.round(height * scale);
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  return { dataUrl: canvas.toDataURL(type, 0.92), width, height };
}

export async function downloadPng(svg: SVGSVGElement, fileName: string) {
  const { dataUrl } = await toImage(svg, 'image/png');
  const link = document.createElement('a');
  link.href = dataUrl;
  link.download = `${fileName}.png`;
  link.click();
}

// Paper sizes in points (portrait). A big chart gets bigger paper so the text stays readable.
const PAPER = [
  { name: 'a4', w: 595, h: 842 },
  { name: 'a3', w: 842, h: 1191 },
  { name: 'a2', w: 1191, h: 1684 },
  { name: 'a1', w: 1684, h: 2384 },
  { name: 'a0', w: 2384, h: 3370 },
];
const MARGIN = 28;
const MIN_SCALE = 0.6; // below this, text gets too small to read when printed

export async function downloadPdf(svg: SVGSVGElement, fileName: string) {
  const [{ dataUrl, width, height }, { jsPDF }] = await Promise.all([toImage(svg, 'image/jpeg'), import('jspdf')]);
  const landscape = width > height;
  const fitOn = (p: (typeof PAPER)[number]) => {
    const [pw, ph] = landscape ? [p.h, p.w] : [p.w, p.h];
    return Math.min((pw - MARGIN * 2) / width, (ph - MARGIN * 2) / height, 1);
  };
  const paper = PAPER.find((p) => fitOn(p) >= MIN_SCALE) ?? PAPER[PAPER.length - 1];

  const pdf = new jsPDF({ orientation: landscape ? 'landscape' : 'portrait', unit: 'pt', format: paper.name });
  const pageW = pdf.internal.pageSize.getWidth() - MARGIN * 2;
  const fit = fitOn(paper);
  const w = width * fit;
  const h = height * fit;
  pdf.addImage(dataUrl, 'JPEG', MARGIN + (pageW - w) / 2, MARGIN, w, h);
  pdf.save(`${fileName}.pdf`);
}

export const fileNameFor = (company: string) =>
  'ownership-' + (company.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'chart');
