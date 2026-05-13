export type PdfPageSizeName =
  | 'A4'
  | 'A3'
  | 'A2'
  | 'A1'
  | 'A0'
  | 'LETTER';

export interface PdfGenerationOptions {
  pageSize?: PdfPageSizeName | { width: number; height: number };
  pageOrientation?: 'portrait' | 'landscape';
  pageMargins?: [number, number, number, number];
}

export const DEFAULT_PDF_OPTIONS: PdfGenerationOptions = {
  pageSize: 'A4',
  pageOrientation: 'portrait',
  pageMargins: [40, 40, 40, 40],
};
