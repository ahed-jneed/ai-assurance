// Test fixtures for the dataset header readers (#103): a Parquet file
// written by pyarrow 25.0.1, and Office Open XML workbooks assembled here.

/**
 * A Parquet file pyarrow 25.0.1 wrote (snappy, store_schema=False) from a
 * table of columns id, Ethnicity, address (a struct of city and zip) and
 * score.
 */
export const pyarrowParquet = () =>
  Uint8Array.from(
    atob(
      "UEFSMRUEFSAVJEwVBBUAEgAAEDwBAAAAAAAAAAIAAAAAAAAAFQAVEhUWLBUEFRAVBhUGHBgIAgAAAAAAAAAYCAEAAAAAAAAAFgAoCAIAAAAAAAAAGAgBAAAAAAAAABERAAAACSACAAAABAEBAwIVBBUUFRhMFQQVABIAAAokAQAAAEEBAAAAQhUAFRIVFiwVBBUQFQYVBhw2ACgBQhgBQRERAAAACSACAAAABAEBAwIVBBUUFRhMFQQVABIAAAokAQAAAHgBAAAAeRUAFRIVFiwVBBUQFQYVBhw2ACgBeRgBeBERAAAACSACAAAABAIBAwIVBBUUFRhMFQQVABIAAAokAQAAADEBAAAAMhUAFRIVFiwVBBUQFQYVBhw2ACgBMhgBMRERAAAACSACAAAABAIBAwIVBBUgFSRMFQQVABIAABA8AAAAAAAA4D8AAAAAAADQPxUAFRIVFiwVBBUQFQYVBhwYCAAAAAAAAOA/GAgAAAAAAADQPxYAKAgAAAAAAADgPxgIAAAAAAAA0D8REQAAAAkgAgAAAAQBAQMCFQQZfDUAGAZzY2hlbWEVCAAVBCUCGAJpZAAVDCUCGAlFdGhuaWNpdHklAEwcAAAANQIYB2FkZHJlc3MVBAAVDCUCGARjaXR5JQBMHAAAABUMJQIYA3ppcCUATBwAAAAVCiUCGAVzY29yZQAWBBkcGVwmABwVBBk1AAYQGRgCaWQVAhYEFswBFtQBJkgmCBwYCAIAAAAAAAAAGAgBAAAAAAAAABYAKAgCAAAAAAAAABgIAQAAAAAAAAAREQAZLBUEFQAVAgAVABUQFQIAPCkGGSYABAAAACYAHBUMGTUABhAZGAlFdGhuaWNpdHkVAhYEFnwWhAEmkAIm3AEcNgAoAUIYAUEREQAZLBUEFQAVAgAVABUQFQIAPBYEGQYZJgAEAAAAJgAcFQwZNQAGEBkoB2FkZHJlc3MEY2l0eRUCFgQWfBaEASaUAybgAhw2ACgBeRgBeBERABksFQQVABUCABUAFRAVAgA8FgQZBhk2AAAEAAAAJgAcFQwZNQAGEBkoB2FkZHJlc3MDemlwFQIWBBZ8FoQBJpgEJuQDHDYAKAEyGAExEREAGSwVBBUAFQIAFQAVEBUCADwWBBkGGTYAAAQAAAAmABwVChk1AAYQGRgFc2NvcmUVAhYEFswBFtQBJqgFJugEHBgIAAAAAAAA4D8YCAAAAAAAANA/FgAoCAAAAAAAAOA/GAgAAAAAAADQPxERABksFQQVABUCABUAFRAVAgA8KQYZJgAEAAAAFowGFgQmCBa0BgAoIHBhcnF1ZXQtY3BwLWFycm93IHZlcnNpb24gMjUuMC4xGVwcAAAcAAAcAAAcAAAcAAAAbQIAAFBBUjE=",
    ),
    (c) => c.charCodeAt(0),
  );

const encoder = new TextEncoder();
async function deflate(bytes: Uint8Array) {
  const stream = new Blob([bytes.slice()])
    .stream()
    .pipeThrough(new CompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}
export type ZipPart = {
  name: string;
  text: string;
  /** 0 stores the entry, 8 deflates it (the default). */
  method?: 0 | 8;
  flags?: number;
};
/**
 * A ZIP archive of the parts. CRC-32 fields are left zero: the reader under
 * test does not check them.
 */
export async function zipArchive(parts: ZipPart[]) {
  const locals: Uint8Array[] = [],
    centrals: Uint8Array[] = [];
  let offset = 0;
  for (const p of parts) {
    const name = encoder.encode(p.name),
      raw = encoder.encode(p.text),
      method = p.method ?? 8,
      data = method === 8 ? await deflate(raw) : raw,
      local = new Uint8Array(30 + name.length + data.length),
      lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true);
    lv.setUint16(6, p.flags ?? 0, true);
    lv.setUint16(8, method, true);
    lv.setUint32(18, data.length, true);
    lv.setUint32(22, raw.length, true);
    lv.setUint16(26, name.length, true);
    local.set(name, 30);
    local.set(data, 30 + name.length);
    const central = new Uint8Array(46 + name.length),
      cv = new DataView(central.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(8, p.flags ?? 0, true);
    cv.setUint16(10, method, true);
    cv.setUint32(20, data.length, true);
    cv.setUint32(24, raw.length, true);
    cv.setUint16(28, name.length, true);
    cv.setUint32(42, offset, true);
    central.set(name, 46);
    locals.push(local);
    centrals.push(central);
    offset += local.length;
  }
  const size = centrals.reduce((n, c) => n + c.length, 0),
    end = new Uint8Array(22),
    ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, parts.length, true);
  ev.setUint16(10, parts.length, true);
  ev.setUint32(12, size, true);
  ev.setUint32(16, offset, true);
  const out = new Uint8Array(offset + size + 22);
  let at = 0;
  for (const chunk of [...locals, ...centrals, end]) {
    out.set(chunk, at);
    at += chunk.length;
  }
  return out;
}

const mainNamespace =
  "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
/**
 * An .xlsx workbook: one worksheet per entry of `sheets` (the inner XML of
 * its sheetData), with the shared strings table `shared` (its <si> items).
 * `prefix` writes every element with that namespace prefix.
 */
export function workbook(
  sheets: string[],
  shared?: string[],
  options: { method?: 0 | 8; prefix?: string } = {},
) {
  const x = options.prefix ? options.prefix + ":" : "",
    ns =
      (options.prefix ? "xmlns:" + options.prefix : "xmlns") +
      '="' +
      mainNamespace +
      '"',
    element = (name: string, inner: string) =>
      "<" + x + name + " " + ns + ">" + inner + "</" + x + name + ">",
    override = (part: string, type: string) =>
      '<Override PartName="' +
      part +
      '" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.' +
      type +
      '+xml"/>',
    method = options.method;
  return zipArchive([
    {
      name: "[Content_Types].xml",
      text:
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/>' +
        override("/xl/workbook.xml", "sheet.main") +
        sheets
          .map((_, i) =>
            override("/xl/worksheets/sheet" + (i + 1) + ".xml", "worksheet"),
          )
          .join("") +
        (shared ? override("/xl/sharedStrings.xml", "sharedStrings") : "") +
        "</Types>",
      method,
    },
    { name: "xl/workbook.xml", text: element("workbook", ""), method },
    ...sheets.map((rows, i) => ({
      name: "xl/worksheets/sheet" + (i + 1) + ".xml",
      text: element(
        "worksheet",
        "<" + x + "sheetData>" + rows + "</" + x + "sheetData>",
      ),
      method,
    })),
    ...(shared
      ? [
          {
            name: "xl/sharedStrings.xml",
            text: element("sst", shared.join("")),
            method,
          },
        ]
      : []),
  ]);
}
