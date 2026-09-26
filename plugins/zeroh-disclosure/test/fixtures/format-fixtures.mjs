// SPDX-License-Identifier: AGPL-3.0-only

// Fake PDFs, a PNG and a notebook for the format tests. The plugin's unit tests
// and the live acceptance scenarios share them. Fake values only.
export const PDF_KEY = 'sk_live_ZEROHR4PDF00000000000000';
export const PDF_EMAIL = 'r4-invoice@example.com';
export const NOTEBOOK_KEY = 'sk_live_ZEROHR4NOTEBOOK000000000';
// A 64x64 line plot. The API rejects images too small to process, such as a 1x1 pixel.
export const PLOT_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAIAAAAlC+aJAAABAklEQVR42u3TyQ3DMAxEUVWSSlJYGvc9hxgxHCuWKG4zAFnBfwOwbeTXClCAAhSgAAUoQAEW7/F6Nup6YsCnnhLwTacE/NSTPfG1nglwTacBdIenAdzXowOG9dCAYTouYGZ4XICoHg4grccCSNOBAAvDAwE09fkAZX0yQJmeCdAPnwkwrE8A2NZHA2zTQwHmw4cC/OojAK717gDXdF+A9/C+gLB6F0BkvT0gMt0YEDy8MSCr3gaQWG8ASEzXAnKH1wJA6hcBOPUrAJx0MQBqeDEAs34WAFs/BYBNHwOQhx8DKOr/Aljq+wCW9A6AaPgOgLH+AJDW7wDS9B1AXX8CbJz3Bm7jBFhi3KeDAAAAAElFTkSuQmCC';

export function textPdf() {
  const text = `Invoice key ${PDF_KEY} belongs to ${PDF_EMAIL}`;
  const content = Buffer.from(
    `BT /F1 12 Tf 72 720 Td (${escapePdf(text)}) Tj ET`,
  );
  return assemblePdf([
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    streamObject(content),
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ]);
}

export function scannedPdf() {
  const content = Buffer.from('q 200 0 0 100 72 600 cm /Im0 Do Q');
  return assemblePdf([
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /XObject << /Im0 5 0 R >> >> /Contents 4 0 R >>',
    streamObject(content),
    streamObject(Buffer.from([0x22, 0x88, 0xcc]), {
      prefix:
        '/Type /XObject /Subtype /Image /Width 1 /Height 1 /ColorSpace /DeviceRGB /BitsPerComponent 8 ',
    }),
  ]);
}

export function cidPdfWithoutToUnicode() {
  const glyphIds = Array.from({ length: 16 }, (_, index) =>
    (index + 1).toString(16).padStart(4, '0'),
  ).join('');
  const content = Buffer.from(`BT /F1 12 Tf 72 720 Td <${glyphIds}> Tj ET`);
  return assemblePdf([
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    streamObject(content),
    '<< /Type /Font /Subtype /Type0 /BaseFont /FixtureCID /Encoding /Identity-H /DescendantFonts [6 0 R] >>',
    '<< /Type /Font /Subtype /CIDFontType2 /BaseFont /FixtureCID /CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> >>',
  ]);
}

export function png() {
  return Buffer.from(PLOT_PNG_BASE64, 'base64');
}

export function notebook() {
  return JSON.stringify(
    {
      cells: [
        {
          cell_type: 'code',
          execution_count: 1,
          id: 'r4-cell',
          metadata: {},
          source: [`key = '${NOTEBOOK_KEY}'\n`, 'print(key)\n'],
          outputs: [
            {
              output_type: 'stream',
              name: 'stdout',
              text: [`${NOTEBOOK_KEY}\n`],
            },
            {
              output_type: 'display_data',
              metadata: {},
              data: {
                'text/plain': ['<Figure size 100x100>'],
                'image/png': PLOT_PNG_BASE64,
              },
            },
          ],
        },
      ],
      metadata: {
        kernelspec: {
          display_name: 'Python 3',
          language: 'python',
          name: 'python3',
        },
        language_info: { name: 'python', version: '3.13' },
      },
      nbformat: 4,
      nbformat_minor: 5,
    },
    null,
    2,
  );
}

function streamObject(content, { prefix = '' } = {}) {
  return Buffer.concat([
    Buffer.from(`<< ${prefix}/Length ${content.length} >>\nstream\n`),
    content,
    Buffer.from('\nendstream'),
  ]);
}

function assemblePdf(objects) {
  const header = Buffer.from('%PDF-1.4\n%\xff\xff\xff\xff\n', 'latin1');
  const parts = [header];
  const offsets = [0];
  let offset = header.length;
  for (const [index, source] of objects.entries()) {
    const body = Buffer.isBuffer(source) ? source : Buffer.from(source);
    const object = Buffer.concat([
      Buffer.from(`${index + 1} 0 obj\n`),
      body,
      Buffer.from('\nendobj\n'),
    ]);
    offsets.push(offset);
    parts.push(object);
    offset += object.length;
  }
  parts.push(
    Buffer.from(
      [
        `xref\n0 ${objects.length + 1}\n`,
        '0000000000 65535 f \n',
        ...offsets
          .slice(1)
          .map((value) => `${String(value).padStart(10, '0')} 00000 n \n`),
        `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${offset}\n%%EOF\n`,
      ].join(''),
    ),
  );
  return Buffer.concat(parts);
}

function escapePdf(value) {
  return value.replace(/[\\()]/gu, (character) => `\\${character}`);
}
