// The column names of binary dataset formats, for the special-category
// upload gate (#103): Parquet from its footer schema, and Office Open XML
// spreadsheets (.xlsx, .xlsm) from the first non-empty row of each
// worksheet. Both are parsed here byte by byte, without executing anything
// the file holds (no macros, formulas or external links are evaluated), and
// within fixed limits on the bytes read and decompressed.

/** Column names, or why a recognised format could not be read. */
export type BinaryHeader = { columns: string[] } | { unreadable: string };

/** The file starts with Parquet's magic number. */
export function isParquet(b: Uint8Array) {
  return (
    b.length >= 4 &&
    b[0] === 0x50 &&
    b[1] === 0x41 &&
    b[2] === 0x52 &&
    (b[3] === 0x31 || b[3] === 0x45)
  );
}
/** The file starts with a ZIP local file header. */
export function isZip(b: Uint8Array) {
  return (
    b.length >= 4 &&
    b[0] === 0x50 &&
    b[1] === 0x4b &&
    b[2] === 0x03 &&
    b[3] === 0x04
  );
}

class Malformed extends Error {}
const utf8 = new TextDecoder("utf-8");

// Thrift compact protocol, as Parquet's footer uses it. Only what reading
// FileMetaData.schema needs; every other field is skipped by its type.
class CompactReader {
  i = 0;
  constructor(
    private b: Uint8Array,
    private end: number,
  ) {}
  byte() {
    if (this.i >= this.end) throw new Malformed("truncated footer");
    return this.b[this.i++];
  }
  varint() {
    let result = 0,
      shift = 0;
    for (;;) {
      const c = this.byte();
      // Values past 2^53 lose precision but are only ever skipped.
      result += (c & 0x7f) * 2 ** shift;
      if (!(c & 0x80)) return result;
      shift += 7;
      if (shift > 63) throw new Malformed("bad varint");
    }
  }
  zigzag() {
    const n = this.varint();
    return n % 2 ? -(n + 1) / 2 : n / 2;
  }
  binary() {
    const n = this.varint();
    if (n > this.end - this.i) throw new Malformed("truncated string");
    const s = this.b.subarray(this.i, this.i + n);
    this.i += n;
    return s;
  }
  /** Reads a struct, handing each field to `field` or skipping it. */
  struct(field: (id: number, type: number) => boolean, depth = 0) {
    if (depth > 32) throw new Malformed("nesting too deep");
    let last = 0;
    for (;;) {
      const h = this.byte();
      if (h === 0) return;
      const type = h & 0x0f,
        delta = h >> 4,
        id = delta ? last + delta : this.zigzag();
      last = id;
      if (!field(id, type)) this.skip(type, depth);
    }
  }
  /** A list header: its element type and size. */
  list() {
    const h = this.byte(),
      size = h >> 4 === 15 ? this.varint() : h >> 4;
    // Every element takes at least one byte.
    if (size > this.end - this.i) throw new Malformed("bad list size");
    return { type: h & 0x0f, size };
  }
  skip(type: number, depth: number): void {
    switch (type) {
      case 1:
      case 2:
        return; // booleans of a field carry their value in the header
      case 3:
        this.byte();
        return;
      case 4:
      case 5:
      case 6:
        this.varint();
        return;
      case 7:
        if (this.end - this.i < 8) throw new Malformed("truncated double");
        this.i += 8;
        return;
      case 8:
        this.binary();
        return;
      case 9:
      case 10: {
        const { type: t, size } = this.list();
        for (let k = 0; k < size; k++)
          if (t === 1 || t === 2) this.byte();
          else this.skip(t, depth + 1);
        return;
      }
      case 11: {
        const size = this.varint();
        if (!size) return;
        if (size > this.end - this.i) throw new Malformed("bad map size");
        const kv = this.byte();
        for (let k = 0; k < size; k++) {
          for (const t of [kv >> 4, kv & 0x0f])
            if (t === 1 || t === 2) this.byte();
            else this.skip(t, depth + 1);
        }
        return;
      }
      case 12:
        this.struct(() => false, depth + 1);
        return;
      default:
        throw new Malformed("unknown field type " + type);
    }
  }
}

/** The most schema elements a Parquet footer may declare. */
const maxParquetElements = 100_000;

/**
 * The leaf column paths of a Parquet file, from the schema in its footer
 * (FileMetaData field 2). A nested column is named by its dotted path. A
 * file whose footer is encrypted cannot be read.
 */
export function parquetColumns(b: Uint8Array): BinaryHeader {
  const n = b.length;
  if (n < 12) return { unreadable: "the Parquet file is truncated" };
  const tail = String.fromCharCode(...b.subarray(n - 4));
  if (tail === "PARE") return { unreadable: "the Parquet footer is encrypted" };
  if (tail !== "PAR1") return { unreadable: "the Parquet file has no footer" };
  const length = new DataView(b.buffer, b.byteOffset + n - 8, 4).getUint32(
    0,
    true,
  );
  if (length > n - 12)
    return { unreadable: "the Parquet footer length is out of range" };
  const r = new CompactReader(b, n - 8);
  r.i = n - 8 - length;
  const elements: { name: string; children: number }[] = [];
  try {
    r.struct((id, type) => {
      if (id !== 2 || type !== 9 || elements.length) return false;
      const { type: t, size } = r.list();
      if (t !== 12 || size > maxParquetElements)
        throw new Malformed("bad schema list");
      for (let k = 0; k < size; k++) {
        let name = "",
          children = 0;
        r.struct((fid, ftype) => {
          if (fid === 4 && ftype === 8) name = utf8.decode(r.binary());
          else if (fid === 5 && ftype === 5) children = r.zigzag();
          else return false;
          return true;
        }, 1);
        elements.push({ name, children: Math.max(0, children) });
      }
      // The schema is all the gate needs; FileMetaData writes it second.
      throw new SchemaRead();
    });
  } catch (error) {
    if (!(error instanceof SchemaRead)) {
      if (error instanceof Malformed)
        return { unreadable: "the Parquet footer is malformed" };
      throw error;
    }
  }
  if (!elements.length)
    return { unreadable: "the Parquet footer has no schema" };
  // Elements are in pre-order; the first is the root.
  const columns: string[] = [];
  let next = 1;
  function walk(prefix: string, count: number, depth: number) {
    if (depth > 64) throw new Malformed("schema too deep");
    for (let k = 0; k < count && next < elements.length; k++) {
      const el = elements[next++],
        path = prefix ? prefix + "." + el.name : el.name;
      if (el.children) walk(path, el.children, depth + 1);
      else columns.push(path);
    }
  }
  try {
    walk("", elements[0].children, 0);
  } catch {
    return { unreadable: "the Parquet schema is malformed" };
  }
  return { columns };
}
class SchemaRead extends Error {}

// ZIP and Office Open XML.
const maxZipEntries = 20_000,
  maxWorksheets = 64,
  /** Decompressed bytes read from one worksheet to find its first row. */
  worksheetLimit = 4 * 1024 * 1024,
  /** Decompressed bytes read from the shared strings table. */
  sharedStringsLimit = 16 * 1024 * 1024,
  /** Decompressed bytes read from [Content_Types].xml. */
  contentTypesLimit = 1024 * 1024;

type ZipEntry = {
  name: string;
  flags: number;
  method: number;
  compressedSize: number;
  localOffset: number;
};

function zipEntries(b: Uint8Array): ZipEntry[] {
  const view = new DataView(b.buffer, b.byteOffset, b.byteLength);
  let eocd = -1;
  for (let i = b.length - 22; i >= Math.max(0, b.length - 22 - 0xffff); i--)
    if (view.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  if (eocd < 0) throw new Malformed("no end of central directory");
  const count = view.getUint16(eocd + 10, true),
    size = view.getUint32(eocd + 12, true),
    offset = view.getUint32(eocd + 16, true);
  if (count === 0xffff || offset === 0xffffffff)
    throw new Malformed("ZIP64 archives are not read");
  if (count > maxZipEntries) throw new Malformed("too many entries");
  if (offset + size > eocd) throw new Malformed("bad central directory");
  const entries: ZipEntry[] = [];
  let p = offset;
  for (let k = 0; k < count; k++) {
    if (p + 46 > eocd || view.getUint32(p, true) !== 0x02014b50)
      throw new Malformed("bad central directory entry");
    const nameLength = view.getUint16(p + 28, true),
      extra = view.getUint16(p + 30, true),
      comment = view.getUint16(p + 32, true);
    if (p + 46 + nameLength > eocd) throw new Malformed("bad entry name");
    entries.push({
      flags: view.getUint16(p + 8, true),
      method: view.getUint16(p + 10, true),
      compressedSize: view.getUint32(p + 20, true),
      localOffset: view.getUint32(p + 42, true),
      name: utf8.decode(b.subarray(p + 46, p + 46 + nameLength)),
    });
    p += 46 + nameLength + extra + comment;
  }
  return entries;
}

/**
 * The text of one ZIP entry, decompressed as a stream and stopped once
 * `done` says enough was read or `limit` bytes were produced. Null when the
 * limit was reached first.
 */
async function entryText(
  b: Uint8Array,
  entry: ZipEntry,
  limit: number,
  done: (text: string) => boolean = () => false,
): Promise<string | null> {
  const view = new DataView(b.buffer, b.byteOffset, b.byteLength),
    at = entry.localOffset;
  if (at + 30 > b.length || view.getUint32(at, true) !== 0x04034b50)
    throw new Malformed("bad local header");
  if (entry.flags & 1) throw new Malformed("encrypted entry");
  const start =
      at + 30 + view.getUint16(at + 26, true) + view.getUint16(at + 28, true),
    data = b.subarray(start, start + entry.compressedSize);
  if (start + entry.compressedSize > b.length)
    throw new Malformed("truncated entry");
  if (entry.method === 0) {
    const text = utf8.decode(data.subarray(0, limit));
    return data.length > limit && !done(text) ? null : text;
  }
  if (entry.method !== 8) throw new Malformed("unsupported compression");
  const reader = new Blob([data.slice()])
      .stream()
      .pipeThrough(new DecompressionStream("deflate-raw"))
      .getReader(),
    decoder = new TextDecoder("utf-8");
  let text = "",
    produced = 0;
  try {
    for (;;) {
      const { value, done: ended } = await reader.read();
      if (ended) return text + decoder.decode();
      produced += value.byteLength;
      text += decoder.decode(value, { stream: true });
      if (done(text)) return text;
      if (produced > limit) return null;
    }
  } catch {
    throw new Malformed("corrupt deflate data");
  } finally {
    void reader.cancel().catch(() => {});
  }
}

const entities: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
};
/** XML character data with entities and OOXML's _xHHHH_ escapes decoded. */
export function xmlText(s: string) {
  return s
    .replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z]+);/gi, (m, e: string) => {
      if (e[0] !== "#") return entities[e] ?? m;
      const code = parseInt(
        e[1] === "x" || e[1] === "X" ? e.slice(2) : e.slice(1),
        e[1] === "x" || e[1] === "X" ? 16 : 10,
      );
      return code <= 0x10ffff ? String.fromCodePoint(code) : m;
    })
    .replace(/_x([0-9a-f]{4})_/gi, (_, h: string) =>
      String.fromCharCode(parseInt(h, 16)),
    );
}
/**
 * A regular expression over OOXML markup, where `~` stands for an optional
 * namespace prefix on an element name (x:row, x:c).
 */
function xml(source: string, flags = "") {
  return new RegExp(
    source.replaceAll("~", String.raw`(?:[A-Za-z_][\w.-]*:)?`),
    flags,
  );
}
const phoneticRun = xml(String.raw`<~rPh\b[\s\S]*?</~rPh>`, "g"),
  textRun = xml(String.raw`<~t(?:\s[^>]*)?(?:/>|>([\s\S]*?)</~t>)`, "g"),
  cellElement = xml(String.raw`<~c\b([^>]*?)(?:/>|>([\s\S]*?)</~c>)`, "g"),
  valueElement = xml(String.raw`<~v(?:\s[^>]*)?>([\s\S]*?)</~v>`),
  sheetDataEnd = xml(String.raw`</~sheetData>|<~sheetData\s*/>`);
/** The concatenated <t> runs of an <si> or <is>, phonetic runs excluded. */
function runsText(markup: string) {
  let out = "";
  for (const m of markup.replace(phoneticRun, "").matchAll(textRun))
    out += xmlText(m[1] ?? "");
  return out;
}
/** An attribute's value from an element's attribute list. */
function attribute(attributes: string, name: string) {
  const m = new RegExp(
    String.raw`(?:^|\s)` + name + String.raw`\s*=\s*(?:"([^"]*)"|'([^']*)')`,
  ).exec(attributes);
  return m ? (m[1] ?? m[2]) : undefined;
}

type Cell = { shared: number } | { text: string };
function rowCells(row: string): Cell[] {
  const cells: Cell[] = [];
  for (const c of row.matchAll(cellElement)) {
    const type = attribute(c[1], "t") ?? "n",
      body = c[2] ?? "",
      v = valueElement.exec(body)?.[1];
    if (type === "s") {
      const index = Number(v?.trim());
      if (v !== undefined && Number.isInteger(index) && index >= 0)
        cells.push({ shared: index });
    } else if (type === "inlineStr") {
      const text = runsText(body);
      if (text.trim()) cells.push({ text });
    } else if (v !== undefined && xmlText(v).trim())
      cells.push({ text: xmlText(v) });
  }
  return cells;
}
/**
 * A scanner for the cells of a worksheet's first row that holds a value.
 * Called with the sheet's markup as it grows, it reads each complete row
 * once. It returns undefined while more of the sheet is needed, and an
 * empty list when the sheet holds no value.
 */
export function firstRowScanner() {
  const row = xml(String.raw`<~row\b[^>]*?(?:/>|>([\s\S]*?)</~row>)`, "g");
  let found: Cell[] | undefined,
    position = 0;
  return (markup: string): Cell[] | undefined => {
    if (found) return found;
    row.lastIndex = position;
    for (let m; (m = row.exec(markup));) {
      position = row.lastIndex;
      const cells = rowCells(m[1] ?? "");
      if (cells.length) return (found = cells);
    }
    return sheetDataEnd.test(markup.slice(position)) ? (found = []) : undefined;
  };
}
/** Counts complete <si> elements as the shared strings table grows. */
function sharedStringCounter() {
  const end = xml(String.raw`</~si>|<~si\b[^>]*/>`, "g");
  let count = 0,
    position = 0;
  return (markup: string) => {
    end.lastIndex = position;
    while (end.exec(markup)) {
      count++;
      position = end.lastIndex;
    }
    return count;
  };
}

function part(entries: ZipEntry[], name: string) {
  const n = name.replace(/^\//, "");
  return (
    entries.find((e) => e.name === n) ??
    entries.find((e) => e.name.toLowerCase() === n.toLowerCase())
  );
}

/**
 * The column names of an Office Open XML spreadsheet: the first non-empty
 * row of every worksheet, shared strings resolved. Null for a ZIP archive
 * that is not a spreadsheet.
 */
export async function spreadsheetColumns(
  b: Uint8Array,
): Promise<BinaryHeader | null> {
  try {
    const entries = zipEntries(b),
      types = part(entries, "[Content_Types].xml");
    if (!types) return null;
    const typesXml = await entryText(b, types, contentTypesLimit);
    if (typesXml === null) throw new Malformed("content types too large");
    if (!/spreadsheetml|ms-excel/i.test(typesXml)) return null;
    const overrides = [
        ...typesXml.matchAll(xml(String.raw`<~Override\b([^>]*)>`, "g")),
      ].map((m) => ({
        name: attribute(m[1], "PartName") ?? "",
        type: attribute(m[1], "ContentType") ?? "",
      })),
      sheets = overrides
        .filter((o) => /\.worksheet\+xml$/i.test(o.type))
        .map((o) => part(entries, o.name))
        .filter((e) => e !== undefined),
      shared = overrides.find((o) => /\.sharedStrings\+xml$/i.test(o.type));
    if (sheets.length > maxWorksheets)
      return { unreadable: "the workbook has more than 64 worksheets" };
    const rows: Cell[][] = [];
    for (const sheet of sheets) {
      const scan = firstRowScanner(),
        markup = await entryText(
          b,
          sheet,
          worksheetLimit,
          (t) => scan(t) !== undefined,
        ),
        cells = markup === null ? undefined : scan(markup);
      if (!cells)
        return {
          unreadable:
            "the first row of worksheet " +
            sheet.name +
            " is not within its first 4 MiB",
        };
      rows.push(cells);
    }
    const needed = Math.max(
      -1,
      ...rows.flat().map((c) => ("shared" in c ? c.shared : -1)),
    );
    let strings: string[] = [];
    if (needed >= 0) {
      const entry = shared && part(entries, shared.name);
      if (!entry) return { unreadable: "the shared strings table is missing" };
      const count = sharedStringCounter(),
        markup = await entryText(
          b,
          entry,
          sharedStringsLimit,
          (t) => count(t) > needed,
        );
      if (markup === null)
        return {
          unreadable:
            "the shared strings of the header rows are not within the first 16 MiB",
        };
      strings = [
        ...markup.matchAll(
          xml(String.raw`<~si\b[^>]*?(?:/>|>([\s\S]*?)</~si>)`, "g"),
        ),
      ].map((m) => runsText(m[1] ?? ""));
      if (strings.length <= needed)
        return { unreadable: "the shared strings table is incomplete" };
    }
    const columns = new Set<string>();
    for (const c of rows.flat()) {
      const name = ("shared" in c ? strings[c.shared] : c.text).trim();
      if (name) columns.add(name);
    }
    return { columns: [...columns] };
  } catch (error) {
    if (error instanceof Malformed)
      return {
        unreadable: "the spreadsheet could not be read: " + error.message,
      };
    throw error;
  }
}
