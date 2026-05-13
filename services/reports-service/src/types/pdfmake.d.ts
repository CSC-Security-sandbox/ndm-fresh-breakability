/**
 * Minimal typings so the project compiles before/without @types/pdfmake in node_modules.
 * When @types/pdfmake is installed, it augments these declarations.
 */
declare module 'pdfmake/interfaces' {
  export type Content = Record<string, unknown> | string | number | null | undefined | Content[];

  export interface TDocumentDefinitions {
    content?: Content | Content[];
    defaultStyle?: Record<string, unknown>;
    styles?: Record<string, Record<string, unknown>>;
    pageSize?: string | { width?: number; height?: number };
    pageOrientation?: 'portrait' | 'landscape';
    pageMargins?: number | [number, number] | [number, number, number, number];
    [key: string]: unknown;
  }
}
