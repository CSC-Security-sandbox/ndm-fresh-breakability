import type { Content, TDocumentDefinitions } from 'pdfmake/interfaces';
import {
  DEFAULT_PDF_OPTIONS,
  type PdfGenerationOptions,
} from '../pdf-generator.options';

function mergeOptions(opts?: PdfGenerationOptions): PdfGenerationOptions {
  return { ...DEFAULT_PDF_OPTIONS, ...opts };
}

function txt(v: unknown, extra: Record<string, unknown> = {}): Content {
  if (v === null || v === undefined) {
    return { text: '', ...extra };
  }
  const s = String(v);
  // Soft break opportunities so long paths wrap inside narrow * columns (avoids edge clipping).
  const breakable = s
    .replace(/\//g, '/\u200B')
    .replace(/\\/g, '\\\u200B')
    .replace(/:\//g, ':\u200B/');
  return { text: breakable, ...extra };
}

function sumFilesDirs(files: unknown, directories: unknown): string {
  return String((Number(files) || 0) + (Number(directories) || 0));
}

const BLUE = '#0067C5';
const HEADER_BG = '#0067C5';
const SUBHEADER_BG = '#f4f9ff';
const GRID_LINE = '#c5d4e8';
const META_BOX_BORDER = '#7eb3e0';

/** Section title + full-width blue rule (legacy HTML/Puppeteer jobs report). */
function sectionHeading(label: string, marginTop = 6): Content {
  return {
    width: '*',
    margin: [0, marginTop, 0, 0],
    stack: [
      { text: label, style: 'sectionTitle', margin: [0, 0, 0, 4] },
      {
        canvas: [
          {
            type: 'line',
            x1: 0,
            y1: 0,
            x2: 10000,
            y2: 0,
            lineWidth: 0.75,
            lineColor: BLUE,
          },
        ],
        margin: [0, 0, 0, 8],
      },
    ],
  };
}

/** Equal flexible columns — pdfmake `'auto'` uses minimum content width only, so wide tables collapse to a tiny strip on large pages. */
function fullWidthStarColumns(n: number): ('*')[] {
  return Array(n).fill('*');
}

/**
 * One logical block: group title row + sub-header row + data rows.
 * Stacking several blocks (fewer columns each) keeps body text readable instead of one 18+ column row.
 */
function blockTable(
  groupLabel: string,
  subHeaders: Content[],
  dataRows: Content[][],
  marginBottom = 10,
): Content {
  const n = subHeaders.length;
  const topRow: Content[] = [
    { text: groupLabel, colSpan: n, style: 'thTop', alignment: 'left' },
    ...Array(n - 1).fill({}),
  ];
  const body: Content[][] = [topRow, subHeaders, ...dataRows];
  return {
    width: '*',
    margin: [0, 0, 0, marginBottom],
    table: {
      headerRows: 2,
      widths: fullWidthStarColumns(n),
      body,
    },
    layout: tableGridLayout(),
  };
}

function infoBox(label: string, value: string): Content {
  return {
    stack: [
      {
        text: label,
        fontSize: 10,
        bold: true,
        color: BLUE,
        margin: [0, 0, 0, 5],
      },
      { text: value || ' ', fontSize: 12, color: '#1a1a1a' },
    ],
    fillColor: '#f2f8fd',
  };
}

function buildCustomerBlock(data: Record<string, unknown>): Content {
  const ci = (data.customerInfo || {}) as Record<string, unknown>;
  const projectName =
    (ci.projectName as string) || 'NetApp Data Migrator';
  const reportDate = (ci.reportDate as string) || '';
  return {
    margin: [0, 0, 0, 16],
    width: '*',
    table: {
      widths: ['*', '*', '*'],
      body: [
        [
          infoBox('CUSTOMER', projectName),
          infoBox('REPORT VERSION', '6.7.0'),
          infoBox('GENERATED AT', reportDate),
        ],
      ],
    },
    layout: {
      hLineWidth: () => 0.5,
      vLineWidth: () => 0.5,
      hLineColor: () => META_BOX_BORDER,
      vLineColor: () => META_BOX_BORDER,
      paddingLeft: () => 12,
      paddingRight: () => 12,
      paddingTop: () => 12,
      paddingBottom: () => 12,
    },
  };
}

function emptyMessageTable(message: string): Content {
  return {
    width: '*',
    table: {
      widths: ['*'],
      body: [
        [
          {
            text: message,
            style: 'td',
            alignment: 'center',
            color: '#777777',
            margin: [8, 14, 8, 14],
          },
        ],
      ],
    },
    layout: tableGridLayout(),
  };
}

function buildSummaryTable(data: Record<string, unknown>): Content {
  const summary = (Array.isArray(data.summary) ? data.summary : []) as Record<
    string,
    unknown
  >[];

  function summaryEntryStack(
    row: Record<string, unknown>,
    marginBottom: number,
  ): Content {
    const src = (row.source || {}) as Record<string, unknown>;
    const tgt = (row.target || {}) as Record<string, unknown>;
    const det = (row.details || {}) as Record<string, unknown>;
    const coc = (row.coc_report || {}) as Record<string, unknown>;

    const srcHdr = [
      txt('File Server', { style: 'thSub' }),
      txt('Path', { style: 'thSub' }),
      txt('Total Files', { style: 'thSub' }),
      txt('Space Utilized', { style: 'thSub' }),
    ];
    const srcData: Content[][] = [
      [
        txt(src.file_server, { style: 'td' }),
        txt(src.path, { style: 'td' }),
        txt(sumFilesDirs(det.files, det.directories), { style: 'td' }),
        txt(det.capacity, { style: 'td' }),
      ],
    ];

    const destHdr = [
      txt('File Server', { style: 'thSub' }),
      txt('Path', { style: 'thSub' }),
      txt('Size', { style: 'thSub' }),
      txt('Transfer Protocol', { style: 'thSub' }),
      txt('Version', { style: 'thSub' }),
      txt('Job Type', { style: 'thSub' }),
    ];
    const destData: Content[][] = [
      [
        txt(tgt.file_server, { style: 'td' }),
        txt(tgt.path, { style: 'td' }),
        txt(tgt.capacity, { style: 'td' }),
        txt(src.protocol, { style: 'td' }),
        txt(src.protocol_version, { style: 'td' }),
        txt(src.job_type, { style: 'td' }),
      ],
    ];

    const procHdr = [
      txt('ID', { style: 'thSub' }),
      txt('Start Time', { style: 'thSub' }),
      txt('Elapsed Time', { style: 'thSub' }),
      txt('Error Logs', { style: 'thSub' }),
      txt('Current Status', { style: 'thSub' }),
    ];
    const procData: Content[][] = [
      [
        txt(det.job_run_id, { style: 'td' }),
        txt(det.created_at, { style: 'td' }),
        txt(det.duration != null ? `${det.duration} sec` : '', { style: 'td' }),
        txt(det.errors, { style: 'td' }),
        txt(det.status, { style: 'td' }),
      ],
    ];

    const valHdr = [
      txt('File Location', { style: 'thSub' }),
      txt('Data Volume', { style: 'thSub' }),
      txt('Status', { style: 'thSub' }),
    ];
    const valData: Content[][] = [
      [
        txt(coc.filePath, { style: 'td' }),
        txt(coc.size, { style: 'td' }),
        txt(coc.status, { style: 'td' }),
      ],
    ];

    return {
      width: '*',
      margin: [0, 0, 0, marginBottom],
      stack: [
        blockTable('Source', srcHdr, srcData),
        blockTable('Destination', destHdr, destData),
        blockTable('Process overview', procHdr, procData),
        blockTable('Validation metrics', valHdr, valData, 4),
      ],
    };
  }

  const tablesStack: Content[] =
    summary.length === 0
      ? [emptyMessageTable('No data available')]
      : summary.map((row, idx) =>
          summaryEntryStack(
            row,
            idx < summary.length - 1 ? 20 : 0,
          ),
        );

  return {
    width: '*',
    stack: [sectionHeading('Overview', 2), ...tablesStack],
    margin: [0, 0, 0, 18],
  };
}

function buildLastIterationTable(data: Record<string, unknown>): Content {
  const li = (data.last_iteration || {}) as Record<string, unknown>;
  const sum = (li.summary || {}) as Record<string, unknown>;
  const src = (sum.source || {}) as Record<string, unknown>;
  const tgt = (sum.target || {}) as Record<string, unknown>;
  const det = (sum.details || {}) as Record<string, unknown>;

  const sourceHdr = [
    txt('File Server', { style: 'thSub' }),
    txt('Path', { style: 'thSub' }),
  ];
  const sourceData: Content[][] = [
    [txt(src.file_server, { style: 'td' }), txt(src.path, { style: 'td' })],
  ];

  const destHdr = [
    txt('File Server', { style: 'thSub' }),
    txt('Path', { style: 'thSub' }),
    txt('Protocol', { style: 'thSub' }),
    txt('Version', { style: 'thSub' }),
    txt('Job Type', { style: 'thSub' }),
    txt('ID', { style: 'thSub' }),
    txt('Duration', { style: 'thSub' }),
  ];
  const destData: Content[][] = [
    [
      txt(tgt.file_server, { style: 'td' }),
      txt(tgt.path, { style: 'td' }),
      txt(src.protocol, { style: 'td' }),
      txt(src.protocol_version, { style: 'td' }),
      txt(src.job_type, { style: 'td' }),
      txt(li.job_run_id, { style: 'td' }),
      txt(li.duration, { style: 'td' }),
    ],
  ];

  const analysisHdr = [
    txt('Items', { style: 'thSub' }),
    txt('Capacity', { style: 'thSub' }),
  ];
  const analysisData: Content[][] = [
    [txt(det.files, { style: 'td' }), txt(det.capacity, { style: 'td' })],
  ];

  const dcHdr = [
    txt('Items', { style: 'thSub' }),
    txt('Operations', { style: 'thSub' }),
    txt('Capacity Copied', { style: 'thSub' }),
    txt('Capacity Deleted', { style: 'thSub' }),
  ];
  const dcData: Content[][] = [
    [
      txt(det.files, { style: 'td' }),
      txt(li.delta_operations, { style: 'td' }),
      txt(li.capacity_copied, { style: 'td' }),
      txt(li.capacity_deleted, { style: 'td' }),
    ],
  ];

  const perfHdr = [
    txt('Source Scan', { style: 'thSub' }),
    txt('Target Scan', { style: 'thSub' }),
    txt('Bandwidth', { style: 'thSub' }),
    txt('Throughput', { style: 'thSub' }),
  ];
  const perfData: Content[][] = [
    [
      txt('-', { style: 'td' }),
      txt('-', { style: 'td' }),
      txt('-', { style: 'td' }),
      txt('-', { style: 'td' }),
    ],
  ];

  const blocks: Content[] = [
    blockTable('Source', sourceHdr, sourceData),
    blockTable('Destination', destHdr, destData),
    blockTable('Analysis', analysisHdr, analysisData),
    blockTable('Data changes', dcHdr, dcData),
    blockTable('Performance', perfHdr, perfData, 4),
  ];

  return {
    width: '*',
    stack: [sectionHeading('Last Iteration'), { width: '*', stack: blocks }],
    margin: [0, 0, 0, 18],
  };
}

function buildLastErrorsTable(data: Record<string, unknown>): Content {
  const le = (data.last_errors || {}) as Record<string, unknown>;
  const sum = (le.summary || {}) as Record<string, unknown>;
  const src = (sum.source || {}) as Record<string, unknown>;
  const tgt = (sum.target || {}) as Record<string, unknown>;

  if (!data.last_errors || !sum.source) {
    return {
      width: '*',
      stack: [sectionHeading('Last Errors'), emptyMessageTable('No data available')],
      margin: [0, 0, 0, 18],
    };
  }

  const sourceHdr = [
    txt('File Server', { style: 'thSub' }),
    txt('Path', { style: 'thSub' }),
  ];
  const sourceData: Content[][] = [
    [txt(src.file_server, { style: 'td' }), txt(src.path, { style: 'td' })],
  ];

  const destHdr = [
    txt('File Server', { style: 'thSub' }),
    txt('Path', { style: 'thSub' }),
    txt('Protocol', { style: 'thSub' }),
    txt('Version', { style: 'thSub' }),
    txt('Type', { style: 'thSub' }),
  ];
  const destData: Content[][] = [
    [
      txt(tgt.file_server, { style: 'td' }),
      txt(tgt.path, { style: 'td' }),
      txt(src.protocol, { style: 'td' }),
      txt(src.protocol_version, { style: 'td' }),
      txt(src.job_type, { style: 'td' }),
    ],
  ];

  const errHdr = [
    txt('Permission Denied', { style: 'thSub' }),
    txt('Out of Space', { style: 'thSub' }),
    txt('Not Found', { style: 'thSub' }),
    txt('In Use', { style: 'thSub' }),
    txt('Timed Out', { style: 'thSub' }),
    txt('Network Issues', { style: 'thSub' }),
    txt('Other', { style: 'thSub' }),
  ];
  const errData: Content[][] = [
    [
      txt(le.permission_denied, { style: 'td' }),
      txt(le.out_of_space, { style: 'td' }),
      txt(le.file_not_found, { style: 'td' }),
      txt(le.in_use, { style: 'td' }),
      txt(le.timed_out, { style: 'td' }),
      txt(le.network_error, { style: 'td' }),
      txt(le.others, { style: 'td' }),
    ],
  ];

  const blocks: Content[] = [
    blockTable('Source', sourceHdr, sourceData),
    blockTable('Destination', destHdr, destData),
    blockTable('Errors', errHdr, errData, 4),
  ];

  return {
    width: '*',
    stack: [sectionHeading('Last Errors'), { width: '*', stack: blocks }],
    margin: [0, 0, 0, 18],
  };
}

function buildCutoversTable(data: Record<string, unknown>): Content {
  const cutovers = (Array.isArray(data.cutovers) ? data.cutovers : []) as Record<
    string,
    unknown
  >[];

  if (cutovers.length === 0) {
    return {
      width: '*',
      stack: [
        sectionHeading('Cutover'),
        emptyMessageTable('No cutover data available'),
      ],
      margin: [0, 0, 0, 18],
    };
  }

  const entryBlocks = (row: Record<string, unknown>, marginBottom: number): Content => {
    const src = (row.source || {}) as Record<string, unknown>;
    const tgt = (row.target || {}) as Record<string, unknown>;
    const det = (row.details || {}) as Record<string, unknown>;
    const coc = (row.coc_report || {}) as Record<string, unknown>;

    const sourceHdr = [
      txt('File Server', { style: 'thSub' }),
      txt('Path', { style: 'thSub' }),
    ];
    const sourceData: Content[][] = [
      [txt(src.file_server, { style: 'td' }), txt(src.path, { style: 'td' })],
    ];

    const destHdr = [
      txt('File Server', { style: 'thSub' }),
      txt('Path', { style: 'thSub' }),
      txt('Protocol', { style: 'thSub' }),
      txt('Version', { style: 'thSub' }),
      txt('Type', { style: 'thSub' }),
    ];
    const destData: Content[][] = [
      [
        txt(tgt.file_server, { style: 'td' }),
        txt(tgt.path, { style: 'td' }),
        txt(src.protocol, { style: 'td' }),
        txt(src.protocol_version, { style: 'td' }),
        txt(src.job_type, { style: 'td' }),
      ],
    ];

    const cutHdr = [
      txt('Time', { style: 'thSub' }),
      txt('Duration', { style: 'thSub' }),
      txt('Capacity', { style: 'thSub' }),
      txt('Files', { style: 'thSub' }),
      txt('Directories', { style: 'thSub' }),
      txt('Operations', { style: 'thSub' }),
      txt('Others', { style: 'thSub' }),
      txt('Errors', { style: 'thSub' }),
    ];
    const cutData: Content[][] = [
      [
        txt(det.created_at, { style: 'td' }),
        txt(det.duration != null ? `${det.duration} sec` : '', { style: 'td' }),
        txt(det.capacity, { style: 'td' }),
        txt(det.files, { style: 'td' }),
        txt(det.directories, { style: 'td' }),
        txt(det.operations, { style: 'td' }),
        txt('-', { style: 'td' }),
        txt(det.errors, { style: 'td' }),
      ],
    ];

    const cocHdr = [
      txt('File Path', { style: 'thSub' }),
      txt('Size', { style: 'thSub' }),
      txt('Digest', { style: 'thSub' }),
    ];
    const cocData: Content[][] = [
      [
        txt(coc.filePath, { style: 'td' }),
        txt(coc.size, { style: 'td' }),
        txt(coc.status, { style: 'td' }),
      ],
    ];

    return {
      width: '*',
      margin: [0, 0, 0, marginBottom],
      stack: [
        blockTable('Source', sourceHdr, sourceData),
        blockTable('Destination', destHdr, destData),
        blockTable('Cutover', cutHdr, cutData),
        blockTable('COC report', cocHdr, cocData, 4),
      ],
    };
  };

  const stacks: Content[] = cutovers.map((row, idx) =>
    entryBlocks(row, idx < cutovers.length - 1 ? 22 : 0),
  );

  return {
    width: '*',
    stack: [sectionHeading('Cutover'), ...stacks],
    margin: [0, 0, 0, 18],
  };
}

function tableGridLayout(): Record<string, unknown> {
  return {
    hLineWidth: () => 0.5,
    vLineWidth: () => 0.5,
    hLineColor: () => GRID_LINE,
    vLineColor: () => GRID_LINE,
    paddingLeft: () => 5,
    paddingRight: () => 5,
    paddingTop: () => 5,
    paddingBottom: () => 5,
  };
}

/**
 * Jobs report PDF — same sections as jobs_report.hbs + partials.
 */
export function buildJobsReportPdfDefinition(
  data: Record<string, unknown>,
  pdfOptions?: PdfGenerationOptions,
): TDocumentDefinitions {
  const o = mergeOptions(pdfOptions);
  const title = ((data.title as string) || 'Jobs report').trim();
  const bodyStack: Content[] = [
    { text: title, style: 'docTitle', margin: [0, 0, 0, 18] },
    buildCustomerBlock(data),
    buildSummaryTable(data),
    buildLastIterationTable(data),
    buildLastErrorsTable(data),
    buildCutoversTable(data),
  ];
  /** Root must be full-width or nested `width: '*'` tables only get intrinsic (minimal) width → squeezed strip on page. */
  const content: Content = { width: '*', stack: bodyStack };
  return {
    pageSize: o.pageSize,
    pageOrientation: o.pageOrientation,
    pageMargins: o.pageMargins,
    defaultStyle: { font: 'Roboto', fontSize: 10, color: '#1a1a1a' },
    styles: {
      docTitle: { fontSize: 22, bold: true, color: '#1a1a1a' },
      sectionTitle: { fontSize: 13, bold: true, color: BLUE },
      thTop: {
        bold: true,
        fontSize: 10,
        fillColor: HEADER_BG,
        color: '#ffffff',
        margin: [2, 7, 2, 7],
      },
      thSub: {
        bold: true,
        fontSize: 9,
        fillColor: SUBHEADER_BG,
        color: '#1a1a1a',
        margin: [2, 6, 2, 6],
      },
      td: { fontSize: 10, alignment: 'left', color: '#1a1a1a' },
      label: {},
      value: {},
    },
    content,
  };
}
