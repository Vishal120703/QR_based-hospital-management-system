// Builds a printable A4 PDF of bedside QR labels in the browser. The QR is
// drawn as vector squares so it scans at any size; text is rendered through a
// canvas so hospital and ward names in any script (for example Hindi) print
// correctly. The libraries load only when someone downloads labels.

export type LabelSize = 'large' | 'medium' | 'small';

export interface LabelOptions {
  size: LabelSize;
  hospitalName: string;
  // The hospital's logo as a PNG data URL, printed at the top of each label.
  logo?: { dataUrl: string; width: number; height: number } | null;
}

export interface Label {
  url: string;
  bedName: string;
  bedCode: string;
  location: string;
  version: number;
}

export const labelSizes: Record<
  LabelSize,
  { name: string; help: string; cols: number; rows: number }
> = {
  large: { name: 'Large', help: '1 per A4 page, for the wall above the bed', cols: 1, rows: 1 },
  medium: { name: 'Medium', help: '4 per A4 page, for bed rails and headboards', cols: 2, rows: 2 },
  small: { name: 'Small', help: '12 per A4 page, sticker size', cols: 3, rows: 4 },
};

const page = { width: 210, height: 297, margin: 10 };

// Where label `index` goes: which page, and its cell in millimetres.
export function labelCell(index: number, size: LabelSize) {
  const { cols, rows } = labelSizes[size];
  const perPage = cols * rows;
  const width = (page.width - page.margin * 2) / cols;
  const height = (page.height - page.margin * 2) / rows;
  const slot = index % perPage;
  return {
    page: Math.floor(index / perPage),
    x: page.margin + (slot % cols) * width,
    y: page.margin + Math.floor(slot / cols) * height,
    width,
    height,
  };
}

export function labelsFileName(area: string, date = new Date()): string {
  const slug =
    area
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'beds';
  return `careqr-labels-${slug}-${date.toISOString().slice(0, 10)}.pdf`;
}

interface Line {
  text: string;
  size: number; // font size in mm
  weight?: 400 | 600 | 700;
  color?: string;
  maxLines?: number;
}

const pxPerMm = 9; // about 230 dpi: crisp text, files stay small
const fontFamily =
  'system-ui, -apple-system, "Segoe UI", Roboto, "Noto Sans", "Noto Sans Devanagari", "Nirmala UI", sans-serif';

function wrap(context: CanvasRenderingContext2D, text: string, width: number, maxLines: number) {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (context.measureText(next).width <= width || !current) {
      current = next;
    } else {
      lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  if (lines.length <= maxLines) return lines;
  const kept = lines.slice(0, maxLines);
  let last = `${kept[maxLines - 1]}…`;
  while (last.length > 1 && context.measureText(last).width > width) {
    last = `${last.slice(0, -2)}…`;
  }
  kept[maxLines - 1] = last;
  return kept;
}

// Renders centred lines of text to a PNG and returns it with its height in mm.
function textBlock(lines: Line[], widthMm: number): { image: string; height: number } | null {
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d');
  if (!context) return null;
  const width = Math.round(widthMm * pxPerMm);
  const font = (line: Line) =>
    `${line.weight ?? 400} ${Math.round(line.size * pxPerMm)}px ${fontFamily}`;
  const laidOut = lines.flatMap((line) => {
    context.font = font(line);
    return wrap(context, line.text, width, line.maxLines ?? 1).map((text) => ({ ...line, text }));
  });
  const lineHeight = (line: Line) => Math.round(line.size * pxPerMm * 1.3);
  canvas.width = width;
  canvas.height = Math.max(
    1,
    laidOut.reduce((sum, line) => sum + lineHeight(line), 0),
  );
  // An opaque background keeps the PDF small (no transparency mask).
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.textAlign = 'center';
  context.textBaseline = 'top';
  let y = 0;
  for (const line of laidOut) {
    context.font = font(line);
    context.fillStyle = line.color ?? '#17212b';
    context.fillText(line.text, width / 2, y + Math.round(line.size * pxPerMm * 0.12));
    y += lineHeight(line);
  }
  return { image: canvas.toDataURL('image/png'), height: canvas.height / pxPerMm };
}

export async function buildLabelsPdf(labels: Label[], options: LabelOptions) {
  const [{ jsPDF }, QRCode] = await Promise.all([import('jspdf'), import('qrcode')]);
  const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait', compress: true });
  doc.setProperties({ title: `${options.hospitalName} bedside QR labels`, creator: 'CARE QR' });

  // The header is the same on every label: render it once and let the PDF
  // reuse that one image, which keeps large batches small.
  const first = labelCell(0, options.size);
  const headerScale = first.width / 95;
  const top = textBlock(
    [
      { text: options.hospitalName, size: 3.2 * headerScale, color: '#5d6b78', maxLines: 1 },
      { text: 'Scan for help', size: 5.4 * headerScale, weight: 700, color: '#0f766e' },
      { text: 'सहायता के लिए स्कैन करें', size: 3.8 * headerScale, weight: 600, color: '#0f766e' },
    ],
    first.width - 10 * headerScale,
  );

  labels.forEach((label, index) => {
    const cell = labelCell(index, options.size);
    if (index > 0 && cell.x === page.margin && cell.y === page.margin) doc.addPage();
    const scale = cell.width / 95; // typography is designed for the medium label
    const pad = 5 * scale;
    const inner = cell.width - pad * 2;

    // Dashed cut line around each label.
    doc.setLineDashPattern([1.2, 1.2], 0);
    doc.setDrawColor(170, 170, 170);
    doc.setLineWidth(0.2);
    doc.rect(cell.x + 0.5, cell.y + 0.5, cell.width - 1, cell.height - 1);
    doc.setLineDashPattern([], 0);

    const bottom = textBlock(
      [
        { text: label.bedName, size: 8 * scale, weight: 700, maxLines: 1 },
        { text: label.location, size: 3.4 * scale, color: '#3a4652', maxLines: 2 },
        ...(options.size === 'small'
          ? []
          : [
              {
                text: 'Water, nurse help, cleaning… No app or login needed.',
                size: 2.9 * scale,
                color: '#3a4652',
                maxLines: 2,
              },
              {
                text: 'Not for emergencies — press the nurse-call button.',
                size: 2.9 * scale,
                weight: 700 as const,
                color: '#b42318',
                maxLines: 2,
              },
            ]),
        {
          text: `${label.bedCode} · QR v${label.version}`,
          size: 2.3 * scale,
          color: '#8a96a3',
        },
      ],
      inner,
    );
    const gap = 2.5 * scale;
    // Logo: fitted into a short box, centred, keeping its proportions.
    const logo = options.logo;
    const logoBox = { width: inner * 0.6, height: 11 * scale };
    const logoScale = logo ? Math.min(logoBox.width / logo.width, logoBox.height / logo.height) : 0;
    const logoHeight = logo ? logo.height * logoScale : 0;
    const topHeight = (top?.height ?? 0) + (logo ? logoHeight + gap / 2 : 0);
    const bottomHeight = bottom?.height ?? 0;
    const qrSize = Math.min(
      inner * 0.82,
      cell.height - pad * 2 - topHeight - bottomHeight - gap * 2,
    );
    const total = topHeight + gap + qrSize + gap + bottomHeight;
    let y = cell.y + (cell.height - total) / 2;

    if (logo) {
      const logoWidth = logo.width * logoScale;
      doc.addImage(
        logo.dataUrl,
        'PNG',
        cell.x + (cell.width - logoWidth) / 2,
        y,
        logoWidth,
        logoHeight,
        'careqr-logo',
      );
      y += logoHeight + gap / 2;
    }

    if (top) doc.addImage(top.image, 'PNG', cell.x + pad, y, inner, top.height, 'careqr-header');
    y += (top?.height ?? 0) + gap;

    // QR modules as filled squares, merging horizontal runs.
    const qr = QRCode.create(label.url, { errorCorrectionLevel: 'M' });
    const count = qr.modules.size;
    const quiet = 2;
    const module = qrSize / (count + quiet * 2);
    const qrX = cell.x + (cell.width - qrSize) / 2 + quiet * module;
    const qrY = y + quiet * module;
    doc.setFillColor(0, 0, 0);
    for (let row = 0; row < count; row += 1) {
      let start = -1;
      for (let col = 0; col <= count; col += 1) {
        const dark = col < count && qr.modules.get(row, col);
        if (dark && start < 0) start = col;
        if (!dark && start >= 0) {
          // A little overlap into the next row avoids the white seams some
          // viewers and printers draw between adjacent rows.
          doc.rect(
            qrX + start * module,
            qrY + row * module,
            (col - start) * module,
            module * 1.08,
            'F',
          );
          start = -1;
        }
      }
    }
    y += qrSize + gap;

    if (bottom) doc.addImage(bottom.image, 'PNG', cell.x + pad, y, inner, bottom.height);
  });
  return doc;
}

export async function downloadLabelsPdf(
  labels: Label[],
  options: LabelOptions & { fileName: string },
): Promise<void> {
  const doc = await buildLabelsPdf(labels, options);
  doc.save(options.fileName);
}

// Opens the PDF in a new tab for printing. Returns false if a pop-up blocker
// stopped it, so the caller can offer the download instead.
export async function openLabelsPdf(labels: Label[], options: LabelOptions): Promise<boolean> {
  const tab = window.open('', '_blank');
  if (!tab) return false;
  try {
    const doc = await buildLabelsPdf(labels, options);
    const url = URL.createObjectURL(doc.output('blob'));
    tab.location.href = url;
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    return true;
  } catch (error) {
    tab.close();
    throw error;
  }
}
