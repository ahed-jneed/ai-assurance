// The binary dataset header readers behind the special-category upload gate
// (#103): Parquet footer schemas and spreadsheet header rows.
import { AsyncLocalStorage } from "node:async_hooks";
import { describe, expect, it, vi } from "vitest";
import { pyarrowParquet, workbook, zipArchive } from "./dataset-header.fixture";
import {
  endsParquet,
  firstRowScanner,
  isParquet,
  isZip,
  parquetColumns,
  spreadsheetColumns,
  xmlText,
} from "./dataset-header";
import { uploadHeader } from "./special-category";

/**
 * The CPU time in milliseconds this test process spends while `work` runs:
 * the reader itself, its garbage collection and the zlib threads that
 * inflate for it. Unlike wall-clock time, it does not grow while other
 * processes load the machine (#174). Vitest runs each test file in its own
 * process, one test at a time.
 */
async function cpuTime<T>(work: () => Promise<T>) {
  const before = process.cpuUsage(),
    result = await work(),
    used = process.cpuUsage(before);
  return { result, ms: (used.user + used.system) / 1000 };
}

describe("parquetColumns", () => {
  it("reads the leaf columns of a file pyarrow wrote, nested ones by path", () => {
    const b = pyarrowParquet();
    expect(isParquet(b)).toBe(true);
    expect(parquetColumns(b)).toEqual({
      columns: ["id", "Ethnicity", "address.city", "address.zip", "score"],
    });
  });

  it("reports a footer it cannot read instead of passing the file", () => {
    const b = pyarrowParquet();
    const encrypted = b.slice();
    encrypted.set([0x50, 0x41, 0x52, 0x45], b.length - 4);
    expect(parquetColumns(encrypted)).toEqual({
      unreadable: "the Parquet footer is encrypted",
    });
    expect(parquetColumns(b.subarray(0, b.length - 1))).toEqual({
      unreadable: "the Parquet file has no footer",
    });
    // A footer length past the start of the file.
    const long = b.slice();
    new DataView(long.buffer).setUint32(b.length - 8, b.length, true);
    expect(parquetColumns(long)).toEqual({
      unreadable: "the Parquet footer length is out of range",
    });
    // A footer cut short: its last bytes replaced by the magic number.
    const cut = new Uint8Array([...b.subarray(0, 4), 0x19, 0x7c, 0x35]);
    const footer = new Uint8Array(cut.length + 8);
    footer.set(cut);
    new DataView(footer.buffer).setUint32(cut.length, 3, true);
    footer.set([0x50, 0x41, 0x52, 0x31], cut.length + 4);
    expect(parquetColumns(footer)).toEqual({
      unreadable: "the Parquet footer is malformed",
    });
  });

  it("reports a footer of deeply nested lists instead of overflowing the stack", async () => {
    // FileMetaData field 1 as a list of lists of lists ..., 200 KB deep.
    const nested = new Uint8Array(200_000).fill(0x19),
      b = new Uint8Array(4 + nested.length + 8);
    b.set([0x50, 0x41, 0x52, 0x31]);
    b.set(nested, 4);
    new DataView(b.buffer).setUint32(4 + nested.length, nested.length, true);
    b.set([0x50, 0x41, 0x52, 0x31], b.length - 4);
    expect(parquetColumns(b)).toEqual({
      unreadable: "the Parquet footer is malformed",
    });
    expect(await uploadHeader("deep.parquet", b.buffer)).toEqual({
      unreadable: "the Parquet footer is malformed",
    });
  });
});

describe("spreadsheetColumns", () => {
  const cell = (ref: string, inner: string, type?: string) =>
    '<c r="' +
    ref +
    '"' +
    (type ? ' t="' + type + '"' : "") +
    ">" +
    inner +
    "</c>";
  it("reads the first non-empty row of every worksheet", async () => {
    const b = await workbook(
      [
        // Shared strings, rich text and an inline string; an empty row first.
        '<row r="1"/><row r="2" spans="1:4">' +
          cell("A2", "<v>0</v>", "s") +
          cell("B2", "<v>1</v>", "s") +
          cell("C2", "<is><t>Health &amp; disability</t></is>", "inlineStr") +
          cell("D2", "<v>2024</v>") +
          '</row><row r="3">' +
          cell("A3", "<v>2</v>", "s") +
          "</row>",
        // A formula's cached string is read; the formula is not evaluated.
        '<row r="5">' +
          cell("B5", '<f>CONCAT("rel","igion")</f><v>religion</v>', "str") +
          "</row>",
        "",
      ],
      [
        "<si><t>applicant_id</t></si>",
        '<si><r><t>Ethnic</t></r><r><rPr><b/></rPr><t xml:space="preserve">ity</t></r><rPh sb="0" eb="1"><t>x</t></rPh></si>',
        "<si><t>not a header</t></si>",
      ],
    );
    expect(isZip(b)).toBe(true);
    expect(await spreadsheetColumns(b)).toEqual({
      columns: [
        "applicant_id",
        "Ethnicity",
        "Health & disability",
        "2024",
        "religion",
      ],
    });
  });

  it("reads stored entries and namespace-prefixed markup", async () => {
    const b = await workbook(
      ['<x:row r="1"><x:c r="A1" t="s"><x:v>0</x:v></x:c></x:row>'],
      ["<x:si><x:t>sexual_orientation</x:t></x:si>"],
      { method: 0, prefix: "x" },
    );
    expect(await spreadsheetColumns(b)).toEqual({
      columns: ["sexual_orientation"],
    });
  });

  it("passes a ZIP archive that is not a spreadsheet", async () => {
    expect(
      await spreadsheetColumns(
        await zipArchive([{ name: "data.csv", text: "id,ethnicity\n" }]),
      ),
    ).toBeNull();
    expect(
      await spreadsheetColumns(
        await zipArchive([
          {
            name: "[Content_Types].xml",
            text: '<Types><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
          },
        ]),
      ),
    ).toBeNull();
  });

  it("reports a spreadsheet it cannot read within its limits", async () => {
    // The header row needs a shared string the table does not hold.
    expect(
      await spreadsheetColumns(
        await workbook(
          ['<row r="1">' + cell("A1", "<v>3</v>", "s") + "</row>"],
          ["<si><t>a</t></si>"],
        ),
      ),
    ).toEqual({ unreadable: "the shared strings table is incomplete" });
    expect(
      await spreadsheetColumns(
        await workbook([
          '<row r="1">' + cell("A1", "<v>0</v>", "s") + "</row>",
        ]),
      ),
    ).toEqual({ unreadable: "the shared strings table is missing" });
    // More than 4 MiB of empty rows before the first value: the scan stops.
    expect(
      await spreadsheetColumns(
        await workbook([
          '<row r="1"/>'.repeat(400_000) +
            "<row>" +
            cell("A1", "<v>1</v>") +
            "</row>",
        ]),
      ),
    ).toEqual({
      unreadable:
        "the first row of worksheet xl/worksheets/sheet1.xml is not within its first 4 MiB",
    });
    // An encrypted entry.
    const encrypted = await zipArchive([
      {
        name: "[Content_Types].xml",
        text: "<Types/>",
        flags: 1,
      },
    ]);
    expect(await spreadsheetColumns(encrypted)).toEqual({
      unreadable: "the spreadsheet could not be read: encrypted entry",
    });
    // A truncated archive has no end of central directory.
    const b = await workbook(["<row/>"]);
    expect(await spreadsheetColumns(b.subarray(0, b.length - 30))).toEqual({
      unreadable:
        "the spreadsheet could not be read: no end of central directory",
    });
    // Corrupt deflate data in a worksheet.
    const corrupt = await workbook([
        '<row r="1"><c t="inlineStr"><is><t>x</t></is></c></row>'.repeat(50),
      ]),
      sheet = new TextEncoder().encode("xl/worksheets/sheet1.xml"),
      at = corrupt.findIndex((_, i) =>
        sheet.every((c, j) => corrupt[i + j] === c),
      );
    corrupt.fill(0xff, at + sheet.length, at + sheet.length + 12);
    expect(await spreadsheetColumns(corrupt)).toEqual({
      unreadable: "the spreadsheet could not be read: corrupt deflate data",
    });
  });

  it("reports a recognised workbook whose worksheets it cannot read", async () => {
    const types = (inner: string) => ({
        name: "[Content_Types].xml",
        text:
          '<Types><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
          inner +
          "</Types>",
      }),
      sheet = {
        name: "xl/worksheets/sheet1.xml",
        text: '<worksheet><sheetData><row><c t="inlineStr"><is><t>ethnicity</t></is></c></row></sheetData></worksheet>',
      };
    // An .xlsb workbook: its worksheets are binary.
    expect(
      await spreadsheetColumns(
        await zipArchive([
          {
            name: "[Content_Types].xml",
            text: '<Types><Override PartName="/xl/workbook.bin" ContentType="application/vnd.ms-excel.sheet.binary.macroEnabled.main"/><Override PartName="/xl/worksheets/sheet1.bin" ContentType="application/vnd.ms-excel.worksheet"/></Types>',
          },
          { name: "xl/worksheets/sheet1.bin", text: "\u0000\u0001" },
        ]),
      ),
    ).toEqual({
      unreadable:
        "the workbook has binary worksheets (.xlsb), which are not read",
    });
    // Worksheets typed by a Default content type are read.
    expect(
      await spreadsheetColumns(
        await zipArchive([
          types(
            '<Default Extension="xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>',
          ),
          { name: "xl/workbook.xml", text: "<workbook/>" },
          sheet,
        ]),
      ),
    ).toEqual({ columns: ["ethnicity"] });
    // A declared worksheet that is missing, and no worksheet at all.
    expect(
      await spreadsheetColumns(
        await zipArchive([
          types(
            '<Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>',
          ),
          sheet,
        ]),
      ),
    ).toEqual({
      unreadable:
        "worksheet /xl/worksheets/sheet2.xml is declared but not in the workbook",
    });
    expect(
      await spreadsheetColumns(await zipArchive([types(""), sheet])),
    ).toEqual({ unreadable: "the workbook declares no worksheet" });
    // A worksheet that ends inside a tag, before its sheet data ends.
    expect(
      await spreadsheetColumns(
        await workbook(['<row><c t="x'], undefined, { method: 0 }),
      ),
    ).toEqual({
      unreadable:
        "worksheet xl/worksheets/sheet1.xml ends before its sheet data",
    });
  });

  it("reads malformed markup up to its limits in linear time", async () => {
    // Unclosed elements and quotes made regular expressions that retry from
    // every opening tag take time quadratic in the markup (#125 review).
    // Each read is bounded by the CPU time this process spends on it, not
    // by wall-clock time, so the bound holds while other processes load the
    // machine (#174). A linear read takes about 250 ms of CPU; a quadratic
    // one takes far longer than the bound.
    const limit = 4 * 1024 * 1024,
      fill = (unit: string, room = 256) =>
        unit.repeat(Math.floor((limit - room) / unit.length));
    const cases: [string, Promise<Uint8Array>, unknown][] = [
      [
        "unclosed <c>",
        workbook(["<row>" + fill("<c>") + "</row>"]),
        { columns: [] },
      ],
      ["unclosed <row>", workbook([fill("<row>")]), { columns: [] }],
      [
        "unclosed <t>",
        workbook([
          '<row><c t="inlineStr"><is>' +
            fill("<t>", 320) +
            "ethnicity</t></is></c></row>",
        ]),
        { columns: ["ethnicity"] },
      ],
      [
        "unclosed <v>",
        workbook(["<row><c>" + fill("<v>") + "religion</v></c></row>"]),
        { columns: ["religion"] },
      ],
      [
        "unclosed <si>",
        workbook(['<row><c t="s"><v>9999999</v></c></row>'], [fill("<si><t>")]),
        { unreadable: "the shared strings table is incomplete" },
      ],
      [
        "unclosed quotes",
        workbook(['<row><c t="' + fill("<c>") + "</row>"]),
        {
          unreadable:
            "worksheet xl/worksheets/sheet1.xml ends before its sheet data",
        },
      ],
      [
        "unclosed comments and markup declarations",
        workbook(["<row>" + fill("<!--") + "</row>"]),
        {
          unreadable:
            "worksheet xl/worksheets/sheet1.xml ends before its sheet data",
        },
      ],
      [
        "past the limit",
        workbook(["<row>" + "<c>".repeat(limit / 2)]),
        {
          unreadable:
            "the first row of worksheet xl/worksheets/sheet1.xml is not within its first 4 MiB",
        },
      ],
    ];
    cases.push([
      "unclosed Override tags in [Content_Types].xml",
      zipArchive([
        {
          name: "[Content_Types].xml",
          text: "<Types>spreadsheetml" + "<Override ".repeat(100_000),
        },
      ]),
      { unreadable: "the workbook declares no worksheet" },
    ]);
    // Every archive is built before the first read: deflating one while
    // another is read would count toward the CPU time of the read.
    const archives = await Promise.all(cases.map(([, archive]) => archive));
    for (const [i, [label, , expected]] of cases.entries()) {
      const { result, ms } = await cpuTime(() =>
        spreadsheetColumns(archives[i]),
      );
      expect(result, label).toEqual(expected);
      expect(ms, label).toBeLessThan(3000);
    }
    // Building the archives deflates about 30 MiB of markup and the reads
    // inflate it again: about 2 s on an idle machine, past the default 5 s
    // timeout under load (#174). The CPU bounds above are what this test
    // checks; the timeout only ends a read that never finishes.
  }, 60_000);

  it(
    "reads each worksheet once, within one budget for the whole package",
    {
      // The reader's work is bounded by counting what it decompresses below,
      // not by timing it. What remains is building the fixtures (deflating
      // about 37 MiB of XML) and inflating at most the 16 MiB budget: about
      // 1.5 s alone, past Vitest's default 5 s under parallel load (#170).
      timeout: 60_000,
    },
    async () => {
      // The #125 review probe: one worksheet named by 64 Overrides, about
      // 4 MiB of filler before a header cell that points near the end of
      // 16 MiB of shared strings. Without deduplication and one budget it
      // decompressed about 272 MiB and took 31 s of CPU.
      const mib = 1024 * 1024,
        overrides = Array.from(
          { length: 64 },
          () =>
            '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>',
        ).join(""),
        count = Math.floor((16 * mib) / "<si><t>x</t></si>".length),
        probe = await zipArchive([
          {
            name: "[Content_Types].xml",
            text:
              '<Types><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
              overrides +
              '<Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/></Types>',
          },
          { name: "xl/workbook.xml", text: "<workbook/>" },
          {
            name: "xl/worksheets/sheet1.xml",
            text:
              "<worksheet><sheetData>" +
              "<x>".repeat(Math.floor((4 * mib - 512) / 3)) +
              '<row><c t="s"><v>' +
              (count - 2) +
              "</v></c></row></sheetData></worksheet>",
          },
          {
            name: "xl/sharedStrings.xml",
            text: "<sst>" + "<si><t>x</t></si>".repeat(count) + "</sst>",
          },
        ]);
      expect(probe.length).toBeLessThan(200_000);
      let inflated = await inflation(() => spreadsheetColumns(probe));
      expect(inflated.result).toEqual({
        unreadable:
          "the workbook decompresses to more than 16 MiB before its header rows are read",
      });
      // [Content_Types].xml, the worksheet once for all 64 Overrides, and the
      // shared strings: within the one budget, not 4 MiB per Override plus
      // 16 MiB of shared strings.
      expect(inflated.streams).toBe(3);
      expect(inflated.bytes).toBeLessThanOrEqual(budget + slack);

      // Many distinct worksheets share the budget too.
      const sheets = Array.from(
        { length: 20 },
        () =>
          "<x>".repeat(Math.floor(mib / 3)) +
          '<row><c t="inlineStr"><is><t>a</t></is></c></row>',
      );
      const many = await workbook(sheets);
      inflated = await inflation(() => spreadsheetColumns(many));
      expect(inflated.result).toEqual({
        unreadable:
          "the workbook decompresses to more than 16 MiB before its header rows are read",
      });
      // About 1 MiB a worksheet: the budget runs out before the last ones are
      // opened, and the 20 MiB of worksheets are not all inflated.
      expect(inflated.streams).toBeLessThan(1 + sheets.length);
      expect(inflated.bytes).toBeLessThanOrEqual(budget + slack);
      expect(
        await spreadsheetColumns(await workbook(sheets.slice(0, 12))),
      ).toEqual({ columns: ["a"] });

      // Central-directory entries that share one local header read it once:
      // 64 of them are no more than one worksheet.
      const shared = await workbook(
          Array.from(
            { length: 65 },
            (_, i) =>
              '<row><c t="inlineStr"><is><t>c' + i + "</t></is></c></row>",
          ),
        ),
        view = new DataView(
          shared.buffer,
          shared.byteOffset,
          shared.byteLength,
        ),
        eocd = shared.length - 22,
        decoder = new TextDecoder();
      let p = view.getUint32(eocd + 16, true),
        first = -1;
      for (let k = 0; k < view.getUint16(eocd + 10, true); k++) {
        const nameLength = view.getUint16(p + 28, true),
          name = decoder.decode(shared.subarray(p + 46, p + 46 + nameLength));
        if (name.startsWith("xl/worksheets/")) {
          if (first < 0) first = view.getUint32(p + 42, true);
          else view.setUint32(p + 42, first, true);
        }
        p += 46 + nameLength;
      }
      expect(await spreadsheetColumns(shared)).toEqual({ columns: ["c0"] });
    },
  );

  it("scans each complete row once as the sheet grows", () => {
    const scan = firstRowScanner();
    expect(scan('<row r="1"/><row r="2"><c><v>a')).toBeUndefined();
    expect(scan('<row r="1"/><row r="2"><c><v>a</v></c></row>')).toEqual([
      { text: "a" },
    ]);
    expect(firstRowScanner()("<sheetData/>")).toEqual([]);
    // Once the whole part was read, an open row or cell counts as closed.
    expect(
      firstRowScanner()('<row><c t="inlineStr"><is><t>gender', true),
    ).toEqual([{ text: "gender" }]);
    expect(firstRowScanner()("<worksheet><row/>", true)).toBeUndefined();
    expect(xmlText("a&amp;b&#233;&#x20AC;_x0041_&bogus;")).toBe(
      "a&bé€A&bogus;",
    );
  });
});

const budget = 16 * 1024 * 1024,
  /**
   * What a stream may inflate past the point where the reader stops it:
   * the chunk that crossed the limit and those queued behind it.
   */
  slack = 1024 * 1024;

/**
 * Runs `read` with DecompressionStream wrapped to count the streams opened
 * and the bytes they produce: the reader's work, independent of how loaded
 * the machine is. Only streams opened from within `read` count, so work
 * still running from a test that timed out does not.
 */
async function inflation<T>(read: () => Promise<T>) {
  const Inner = globalThis.DecompressionStream,
    counted = { streams: 0, bytes: 0 },
    scope = new AsyncLocalStorage<typeof counted>();
  class Counting {
    readonly writable: WritableStream<BufferSource>;
    readonly readable: ReadableStream<Uint8Array>;
    constructor(format: CompressionFormat) {
      const inner = new Inner(format);
      this.writable = inner.writable;
      if (scope.getStore() !== counted) {
        this.readable = inner.readable;
        return;
      }
      counted.streams++;
      this.readable = inner.readable.pipeThrough(
        new TransformStream<Uint8Array, Uint8Array>({
          transform(chunk, controller) {
            counted.bytes += chunk.byteLength;
            controller.enqueue(chunk);
          },
        }),
      );
    }
  }
  vi.stubGlobal("DecompressionStream", Counting);
  try {
    const result = await scope.run(counted, read);
    return { result, ...counted };
  } finally {
    vi.unstubAllGlobals();
  }
}

describe("uploadHeader on binary datasets", () => {
  it("returns the columns, or why they could not be read", async () => {
    expect(
      await uploadHeader("applicants.parquet", pyarrowParquet().buffer),
    ).toEqual(["id", "Ethnicity", "address.city", "address.zip", "score"]);
    const xlsx = await workbook([
      '<row r="1"><c r="A1" t="inlineStr"><is><t>religion</t></is></c></row>',
    ]);
    expect(await uploadHeader("applicants.xlsx", xlsx.slice().buffer)).toEqual([
      "religion",
    ]);
    const encrypted = pyarrowParquet();
    encrypted.set([0x50, 0x41, 0x52, 0x45], encrypted.length - 4);
    expect(await uploadHeader("x.parquet", encrypted.buffer)).toEqual({
      unreadable: "the Parquet footer is encrypted",
    });
    // Parquet whose first bytes were changed is still read, by the magic
    // number ending its footer or by its name.
    const headless = pyarrowParquet();
    headless.fill(0, 0, 4);
    expect(endsParquet(headless)).toBe(true);
    for (const name of ["data.bin", "data.pq"])
      expect(await uploadHeader(name, headless.slice().buffer), name).toEqual([
        "id",
        "Ethnicity",
        "address.city",
        "address.zip",
        "score",
      ]);
    // A .parquet name on bytes that are neither Parquet nor text.
    expect(
      await uploadHeader(
        "x.parquet",
        new Uint8Array([0x08, 0x00, 0xff, 0xfe]).buffer,
      ),
    ).toEqual({ unreadable: "the Parquet file is truncated" });
    // A CSV misnamed .parquet is read as the text it is.
    expect(
      await uploadHeader(
        "x.parquet",
        new TextEncoder().encode("id,religion\n1,x").buffer,
      ),
    ).toEqual(["id", "religion"]);
    // A ZIP that is not a spreadsheet is not inspected.
    expect(
      await uploadHeader(
        "bundle.zip",
        (await zipArchive([{ name: "a.txt", text: "x" }])).slice().buffer,
      ),
    ).toBeNull();
  });
});
