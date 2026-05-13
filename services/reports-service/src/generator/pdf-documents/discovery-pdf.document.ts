import type { Content, TDocumentDefinitions } from 'pdfmake/interfaces';
import {
  DEFAULT_PDF_OPTIONS,
  type PdfGenerationOptions,
} from '../pdf-generator.options';

type DiscoveryRow = { sub_category?: string; value?: string | number | null };
type DiscoveryCategories = Record<string, DiscoveryRow[]>;

function mergeOptions(opts?: PdfGenerationOptions): PdfGenerationOptions {
  return { ...DEFAULT_PDF_OPTIONS, ...opts };
}

/**
 * Same logical layout as discovery_pdf_report.hbs: per-category two-column tables.
 */
export function buildDiscoveryPdfDefinition(
  categories: DiscoveryCategories,
  pdfOptions?: PdfGenerationOptions,
): TDocumentDefinitions {
  const o = mergeOptions(pdfOptions);
  const content: Content[] = [
    { text: 'Data Summary', style: 'title', margin: [0, 0, 0, 8] },
  ];

  for (const [categoryName, rows] of Object.entries(categories || {})) {
    if (!Array.isArray(rows) || rows.length === 0) {
      continue;
    }
    const body: Content[][] = [
      [
        { text: 'Sub Category', style: 'th', fillColor: '#f2f2f2' },
        { text: '', style: 'th', fillColor: '#f2f2f2' },
      ],
    ];
    let r = 0;
    for (const row of rows) {
      if (!row?.sub_category) {
        continue;
      }
      const fill = r % 2 === 0 ? '#f9f9f9' : undefined;
      body.push([
        { text: String(row.sub_category), style: 'td', fillColor: fill },
        {
          text: row.value != null && row.value !== '' ? String(row.value) : '',
          style: 'td',
          fillColor: fill,
        },
      ]);
      r++;
    }
    if (body.length <= 1) {
      continue;
    }
    content.push(
      { text: categoryName, style: 'h2', margin: [0, 10, 0, 4] },
      {
        table: {
          headerRows: 1,
          widths: ['*', '*'],
          body,
        },
        layout: {
          hLineWidth: () => 0.5,
          vLineWidth: () => 0.5,
          hLineColor: () => '#dddddd',
          vLineColor: () => '#dddddd',
        },
        margin: [0, 0, 0, 16],
      },
    );
  }

  return {
    pageSize: o.pageSize,
    pageOrientation: o.pageOrientation,
    pageMargins: o.pageMargins,
    defaultStyle: { font: 'Roboto', fontSize: 10 },
    styles: {
      title: { fontSize: 20, bold: true },
      h2: { fontSize: 14, bold: true },
      th: { bold: true },
      td: {},
    },
    content: content.length > 1 ? content : [{ text: 'No report sections to display.', margin: [0, 8, 0, 0] }],
  };
}
