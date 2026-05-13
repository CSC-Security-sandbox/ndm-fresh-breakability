/**
 * Roboto fonts from pdfmake vfs (base64) — loaded lazily so tests that mock
 * PDFGeneratorService do not need the pdfmake package at import time.
 */
let cachedFonts: Record<string, Record<string, Buffer>> | null = null;

export function getReportPdfFonts(): Record<string, Record<string, Buffer>> {
  if (cachedFonts) {
    return cachedFonts;
  }
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const vfsFonts = require('pdfmake/build/vfs_fonts');

  function vfsBuffer(filename: string): Buffer {
    // pdfmake 0.2.x exports the vfs directly: { 'Roboto-Regular.ttf': '<base64>', ... }
    const b64 = (vfsFonts as Record<string, string>)[filename];
    if (!b64) {
      throw new Error(`pdfmake vfs missing font: ${filename}`);
    }
    return Buffer.from(b64, 'base64');
  }

  cachedFonts = {
    Roboto: {
      normal: vfsBuffer('Roboto-Regular.ttf'),
      bold: vfsBuffer('Roboto-Medium.ttf'),
      italics: vfsBuffer('Roboto-Italic.ttf'),
      bolditalics: vfsBuffer('Roboto-MediumItalic.ttf'),
    },
  };
  return cachedFonts;
}
