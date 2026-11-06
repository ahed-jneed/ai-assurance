// The column names of binary dataset formats, for the special-category
// upload gate (#103): Parquet from its footer schema, and Office Open XML
// spreadsheets (.xlsx, .xlsm) from the first non-empty row of each
// worksheet. Both are parsed here byte by byte, without executing anything
// the file holds (no macros, formulas or external links are evaluated),
// within fixed limits on the bytes read and decompressed (one budget for the
// whole package, so a part named many times, or many parts, cannot multiply
// it), and in time linear in those bytes: the XML is read by a scanner that
// never backtracks, so malformed markup (unclosed tags or quotes) cannot make
// the scan quadratic.

/** Column names, or why a recognised format could not be read. */
export type BinaryHeader = { columns: string[] } | { unreadable: string };

/** The four bytes at `at` are Parquet's magic number (PAR1, or PARE). */
function parquetMagic(b: Uint8Array, at: number) {
  return (
    at >= 0 &&
    b.length >= at + 4 &&
    b[at] === 0x50 &&
    b[at + 1] === 0x41 &&
    b[at + 2] === 0x52 &&
    (b[at + 3] === 0x31 || b[at + 3] === 0x45)
  );
}
/** The file starts with Parquet's magic number. */
export function isParquet(b: Uint8Array) {
  return parquetMagic(b, 0);
}
/** The file ends with Parquet's magic number, where its footer ends. */
export function endsParquet(b: Uint8Array) {
  return b.length >= 12 && parquetMagic(b, b.length - 4);
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
    // Nested lists, sets and maps recurse here; struct() checks its own.
    if (depth > 32) throw new Malformed("nesting too deep");
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
  /** Decompressed bytes read from [Content_Types].xml. */
  contentTypesLimit = 1024 * 1024,
  /**
   * Decompressed bytes read from the whole package: content types, every
   * worksheet and the shared strings share it, so the per-part limits do not
   * add up (#125 review: 64 worksheets of 4 MiB and 16 MiB of shared strings
   * took 31 s of CPU).
   */
  packageBudget = 16 * 1024 * 1024;

/** The decompressed bytes a package may still produce. */
type Budget = { left: number };
/** The package budget was spent before the header rows were read. */
class BudgetSpent extends Error {}

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
 * limit was reached first. Every byte produced is taken from `budget`, and
 * BudgetSpent is thrown once the budget runs out before the limit does.
 */
async function entryText(
  b: Uint8Array,
  entry: ZipEntry,
  limit: number,
  budget: Budget,
  done: (text: string) => boolean = () => false,
): Promise<string | null> {
  const cap = Math.min(limit, budget.left),
    over = () => {
      if (cap < limit) throw new BudgetSpent();
      return null;
    };
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
    const read = data.subarray(0, cap),
      text = utf8.decode(read);
    budget.left -= read.length;
    return data.length > cap && !done(text) ? over() : text;
  }
  if (entry.method !== 8) throw new Malformed("unsupported compression");
  const reader = new Blob([data.slice()])
      .stream()
      .pipeThrough(new DecompressionStream("deflate-raw"))
      .getReader(),
    decoder = new TextDecoder("utf-8");
  let text = "",
    produced = 0,
    // `done` reads the text, which joins the chunks appended since it last
    // looked into one string: a copy of the whole text. Looking only once
    // the text has grown by half keeps those copies linear in the text
    // (looking after every 16 KiB chunk made 12 MiB take a second).
    check = 0;
  try {
    for (;;) {
      const { value, done: ended } = await reader.read();
      if (ended) return text + decoder.decode();
      produced += value.byteLength;
      budget.left = Math.max(0, budget.left - value.byteLength);
      text += decoder.decode(value, { stream: true });
      if (produced > cap) return done(text) ? text : over();
      if (text.length >= check) {
        if (done(text)) return text;
        check = text.length + Math.max(64 * 1024, text.length >> 1);
      }
    }
  } catch (error) {
    if (error instanceof BudgetSpent) throw error;
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
  if (!s.includes("&") && !s.includes("_")) return s;
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

/** An element tag: its local name (namespace prefix dropped). */
export type XmlTag = {
  name: string;
  /** A closing tag (</c>). */
  close: boolean;
  /** An empty-element tag (<c/>). */
  empty: boolean;
  /** The raw attribute list. */
  attributes: string;
};
/**
 * A scanner over XML markup that grows as it is decompressed. Each call
 * reads on from where the last one stopped and hands every complete tag and
 * run of character data to the callbacks, in order; a construct whose end
 * has not arrived yet waits for the next call, and the search for its end
 * resumes where it stopped. Every character is therefore examined a bounded
 * number of times, whatever the markup holds (unclosed tags, unbalanced
 * quotes): the scan is linear, unlike regular expressions that retry from
 * every opening tag. `tag` returns true to stop the scan.
 */
export function xmlScanner(
  tag: (t: XmlTag) => boolean | void,
  text: (s: string, cdata: boolean) => void,
) {
  let at = 0,
    // Where the search for the end of the pending construct resumes.
    search = 0,
    // The quote open at `search` inside a pending tag (0 when none).
    quote = 0,
    stopped = false;
  /** `ended`: the markup is complete, so trailing character data counts. */
  return (markup: string, ended = false) => {
    const n = markup.length;
    while (!stopped && at < n) {
      if (markup.charCodeAt(at) !== 0x3c) {
        const lt = markup.indexOf("<", Math.max(search, at));
        if (lt < 0) {
          if (ended) text(markup.slice(at), false);
          at = ended ? n : at;
          search = n;
          return stopped;
        }
        text(markup.slice(at, lt), false);
        at = search = lt;
        continue;
      }
      // Markup declarations and processing instructions.
      const bang = markup.charCodeAt(at + 1) === 0x21;
      if (at + 1 >= n || (bang && n - at < 9)) return stopped; // too short to tell
      const special = !bang
        ? markup.charCodeAt(at + 1) === 0x3f
          ? "?>"
          : ""
        : markup.startsWith("<!--", at)
          ? "-->"
          : markup.startsWith("<![CDATA[", at)
            ? "]]>"
            : ">";
      if (special) {
        const from = Math.max(search, at + (special === "]]>" ? 9 : 2)),
          end = markup.indexOf(special, from);
        if (end < 0) {
          search = Math.max(from, n - special.length + 1);
          return stopped;
        }
        if (special === "]]>") text(markup.slice(at + 9, end), true);
        at = search = end + special.length;
        continue;
      }
      // An element tag: its end is the first '>' outside a quoted value.
      let i = Math.max(search, at + 1),
        end = -1;
      for (; i < n; i++) {
        const c = markup.charCodeAt(i);
        if (quote) {
          if (c === quote) quote = 0;
        } else if (c === 0x22 || c === 0x27) quote = c;
        else if (c === 0x3e) {
          end = i;
          break;
        }
      }
      if (end < 0) {
        search = n;
        return stopped;
      }
      const close = markup.charCodeAt(at + 1) === 0x2f,
        empty = !close && markup.charCodeAt(end - 1) === 0x2f,
        inner = markup.slice(close ? at + 2 : at + 1, empty ? end - 1 : end),
        nameEnd = inner.search(/[\s/]|$/),
        qualified = inner.slice(0, nameEnd);
      at = search = end + 1;
      if (
        tag({
          name: qualified.slice(qualified.indexOf(":") + 1),
          close,
          empty,
          attributes: inner.slice(nameEnd),
        })
      )
        stopped = true;
    }
    return stopped;
  };
}
/**
 * The attributes of an element, read left to right in one pass. Reading
 * stops at the first malformed attribute.
 */
export function xmlAttributes(list: string) {
  const out = new Map<string, string>(),
    n = list.length;
  let i = 0;
  const space = () => {
    while (i < n && /\s/.test(list[i])) i++;
  };
  for (;;) {
    space();
    const start = i;
    while (i < n && !/[\s=]/.test(list[i])) i++;
    const name = list.slice(start, i);
    space();
    if (!name || list[i] !== "=") return out;
    i++;
    space();
    const q = list[i];
    if (q !== '"' && q !== "'") return out;
    const close = list.indexOf(q, i + 1);
    if (close < 0) return out;
    if (!out.has(name)) out.set(name, xmlText(list.slice(i + 1, close)));
    i = close + 1;
  }
}

type Cell = { shared: number } | { text: string };
/**
 * A scanner for the cells of a worksheet's first row that holds a value.
 * Called with the sheet's markup as it grows, it reads each character once.
 * It returns undefined while more of the sheet is needed, and an empty list
 * when the sheet data ends without a value. Called with `ended` once the
 * whole part was read, a row or cell the part leaves open counts as closed
 * there; a part that still has neither a value nor the end of its sheet
 * data stays undefined. Markup that is not well formed is read so that no
 * cell is lost: a <row> or <c> opened inside an open one closes it.
 */
export function firstRowScanner() {
  let found: Cell[] | undefined,
    row: Cell[] | null = null,
    cell: { type: string; v?: string; inline: string } | null = null,
    value: string | null = null,
    run: string | null = null,
    inlineString = false,
    phonetic = 0;
  const endCell = () => {
      if (!cell || !row) return;
      const { type, v, inline } = cell;
      cell = null;
      value = run = null;
      inlineString = false;
      phonetic = 0;
      if (type === "s") {
        const index = Number(v?.trim());
        if (
          v !== undefined &&
          v.trim() &&
          Number.isInteger(index) &&
          index >= 0
        )
          row.push({ shared: index });
      } else if (type === "inlineStr") {
        if (inline.trim()) row.push({ text: inline });
      } else if (v !== undefined && v.trim()) row.push({ text: v });
    },
    endRow = () => {
      endCell();
      const cells = row;
      row = null;
      if (cells?.length) found = cells;
      return found !== undefined;
    },
    scan = xmlScanner(
      (t) => {
        switch (t.name) {
          case "sheetData":
            if (t.close || t.empty) {
              endRow();
              found ??= [];
              return true;
            }
            return;
          case "row":
            if (row && endRow()) return true;
            if (!t.close && !t.empty) row = [];
            return;
          case "c":
            if (!row) return;
            endCell();
            if (!t.close)
              cell = {
                type: xmlAttributes(t.attributes).get("t") ?? "n",
                inline: "",
              };
            if (t.empty) endCell();
            return;
          case "v":
            if (!cell) return;
            if (t.close) {
              if (value !== null && cell.v === undefined) cell.v = value;
              value = null;
            } else if (t.empty) cell.v ??= "";
            else value = "";
            return;
          case "is":
            if (cell) inlineString = !t.close && !t.empty;
            return;
          case "rPh":
            if (cell && !t.empty)
              phonetic = Math.max(0, phonetic + (t.close ? -1 : 1));
            return;
          case "t":
            if (!cell || !inlineString || phonetic) return;
            if (t.close) {
              if (run !== null) cell.inline += run;
              run = null;
            } else if (!t.empty) run = "";
            return;
        }
      },
      (s, cdata) => {
        if (value === null && run === null) return;
        const decoded = cdata ? s : xmlText(s);
        if (value !== null) value += decoded;
        if (run !== null) run += decoded;
      },
    );
  return (markup: string, ended = false): Cell[] | undefined => {
    if (found) return found;
    scan(markup, ended);
    if (ended && !found) {
      if (run !== null && cell) cell.inline += run;
      if (value !== null && cell && cell.v === undefined) cell.v = value;
      endRow();
    }
    return found;
  };
}
/**
 * The texts of the shared strings table, read as it grows until it holds
 * more than `needed` items, phonetic runs excluded. Linear like
 * firstRowScanner; an <si> opened inside an open one closes it.
 */
function sharedStringsScanner(needed: number) {
  const strings: string[] = [];
  let item: string | null = null,
    run: string | null = null,
    phonetic = 0;
  const endItem = () => {
      if (item !== null) strings.push(item);
      item = run = null;
      phonetic = 0;
      return strings.length > needed;
    },
    scan = xmlScanner(
      (t) => {
        switch (t.name) {
          case "sst":
            return t.close || t.empty ? endItem() || true : undefined;
          case "si":
            if (endItem()) return true;
            if (t.empty) {
              item = "";
              return endItem();
            }
            if (!t.close) item = "";
            return;
          case "rPh":
            if (item !== null && !t.empty)
              phonetic = Math.max(0, phonetic + (t.close ? -1 : 1));
            return;
          case "t":
            if (item === null || phonetic) return;
            if (t.close) {
              if (run !== null) item += run;
              run = null;
            } else if (!t.empty) run = "";
            return;
        }
      },
      (s, cdata) => {
        if (run !== null) run += cdata ? s : xmlText(s);
      },
    );
  return {
    strings,
    /** Reads on; true once enough items, or the whole table, were read. */
    feed: (markup: string) => scan(markup),
  };
}

/** Entries of a ZIP archive by part name, exact names first. */
function partIndex(entries: ZipEntry[]) {
  const exact = new Map<string, ZipEntry>(),
    folded = new Map<string, ZipEntry>();
  for (const e of entries) {
    if (!exact.has(e.name)) exact.set(e.name, e);
    const k = e.name.toLowerCase();
    if (!folded.has(k)) folded.set(k, e);
  }
  return (name: string) => {
    const n = name.replace(/^\//, "");
    let decoded = n;
    try {
      decoded = decodeURIComponent(n);
    } catch {
      // A malformed escape: the raw name is tried alone.
    }
    return (
      exact.get(n) ??
      exact.get(decoded) ??
      folded.get(n.toLowerCase()) ??
      folded.get(decoded.toLowerCase())
    );
  };
}

/** The Override and Default declarations of [Content_Types].xml. */
function contentTypes(xml: string) {
  const overrides: { name: string; type: string }[] = [],
    defaults: { extension: string; type: string }[] = [];
  xmlScanner(
    (t) => {
      if (t.close) return;
      const a = xmlAttributes(t.attributes);
      if (t.name === "Override")
        overrides.push({
          name: a.get("PartName") ?? "",
          type: a.get("ContentType") ?? "",
        });
      else if (t.name === "Default")
        defaults.push({
          extension: (a.get("Extension") ?? "").toLowerCase(),
          type: a.get("ContentType") ?? "",
        });
    },
    () => {},
  )(xml);
  return { overrides, defaults };
}
/** A worksheet content type in XML (.xlsx, .xlsm) or not (.xlsb). */
const worksheetType = /worksheet/i,
  xmlType = /\+xml$/i;

/**
 * The column names of an Office Open XML spreadsheet: the first non-empty
 * row of every worksheet, shared strings resolved. Null for a ZIP archive
 * that is not a spreadsheet. A package recognised as a spreadsheet whose
 * worksheets cannot all be read (binary .xlsb worksheets, a declared part
 * that is missing, no worksheet at all) is reported unreadable.
 */
export async function spreadsheetColumns(
  b: Uint8Array,
): Promise<BinaryHeader | null> {
  try {
    const entries = zipEntries(b),
      part = partIndex(entries),
      types = part("[Content_Types].xml");
    if (!types) return null;
    const budget: Budget = { left: packageBudget },
      typesXml = await entryText(b, types, contentTypesLimit, budget);
    if (typesXml === null) throw new Malformed("content types too large");
    if (!/spreadsheetml|ms-excel/i.test(typesXml)) return null;
    const { overrides, defaults } = contentTypes(typesXml),
      overridden = new Set(
        overrides.map((o) => o.name.replace(/^\//, "").toLowerCase()),
      ),
      byExtension = new Map<string, string>();
    for (const d of defaults)
      if (!byExtension.has(d.extension)) byExtension.set(d.extension, d.type);
    const declared = [
      ...overrides.filter((o) => worksheetType.test(o.type)),
      // Parts typed by their extension, where no Override types them.
      ...entries.flatMap((e) => {
        const name = e.name.toLowerCase(),
          dot = name.lastIndexOf("."),
          type = dot < 0 ? undefined : byExtension.get(name.slice(dot + 1));
        return type &&
          worksheetType.test(type) &&
          !overridden.has(name) &&
          name !== "[content_types].xml"
          ? [{ name: e.name, type }]
          : [];
      }),
    ];
    if (declared.some((s) => !xmlType.test(s.type)))
      return {
        unreadable:
          "the workbook has binary worksheets (.xlsb), which are not read",
      };
    if (!declared.length)
      return { unreadable: "the workbook declares no worksheet" };
    // Each ZIP entry is read once, however many declarations name it or
    // however many central-directory entries point at its local header.
    const sheets = new Map<number, ZipEntry>();
    for (const s of declared) {
      const entry = part(s.name);
      if (!entry)
        return {
          unreadable:
            "worksheet " + s.name + " is declared but not in the workbook",
        };
      if (!sheets.has(entry.localOffset)) sheets.set(entry.localOffset, entry);
      if (sheets.size > maxWorksheets)
        return { unreadable: "the workbook has more than 64 worksheets" };
    }
    const shared = overrides.find((o) => /\.sharedStrings\+xml$/i.test(o.type));
    const rows: Cell[][] = [];
    for (const sheet of sheets.values()) {
      const scan = firstRowScanner(),
        markup = await entryText(
          b,
          sheet,
          worksheetLimit,
          budget,
          (t) => scan(t) !== undefined,
        ),
        cells = markup === null ? undefined : scan(markup, true);
      if (!cells)
        return {
          unreadable:
            markup === null
              ? "the first row of worksheet " +
                sheet.name +
                " is not within its first 4 MiB"
              : "worksheet " + sheet.name + " ends before its sheet data",
        };
      rows.push(cells);
    }
    const needed = rows
      .flat()
      .reduce((m, c) => ("shared" in c ? Math.max(m, c.shared) : m), -1);
    let strings: string[] = [];
    if (needed >= 0) {
      const entry = shared && part(shared.name);
      if (!entry) return { unreadable: "the shared strings table is missing" };
      const table = sharedStringsScanner(needed),
        // The package budget is the only limit on the shared strings.
        markup = await entryText(b, entry, packageBudget, budget, table.feed);
      if (markup !== null) table.feed(markup);
      strings = table.strings;
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
    if (error instanceof BudgetSpent)
      return {
        unreadable:
          "the workbook decompresses to more than 16 MiB before its header rows are read",
      };
    if (error instanceof Malformed)
      return {
        unreadable: "the spreadsheet could not be read: " + error.message,
      };
    throw error;
  }
}
