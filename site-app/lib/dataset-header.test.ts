// The binary dataset header readers behind the special-category upload gate
// (#103): Parquet footer schemas and spreadsheet header rows.
import { describe, expect, it } from "vitest";
import { pyarrowParquet, workbook, zipArchive } from "./dataset-header.fixture";
import {
  firstRowScanner,
  isParquet,
  isZip,
  parquetColumns,
  spreadsheetColumns,
  xmlText,
} from "./dataset-header";
import { uploadHeader } from "./special-category";

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
  });

  it("scans each complete row once as the sheet grows", () => {
    const scan = firstRowScanner();
    expect(scan('<row r="1"/><row r="2"><c><v>a')).toBeUndefined();
    expect(scan('<row r="1"/><row r="2"><c><v>a</v></c></row>')).toEqual([
      { text: "a" },
    ]);
    expect(firstRowScanner()("<sheetData/>")).toEqual([]);
    expect(xmlText("a&amp;b&#233;&#x20AC;_x0041_&bogus;")).toBe(
      "a&bé€A&bogus;",
    );
  });
});

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
    // A ZIP that is not a spreadsheet is not inspected.
    expect(
      await uploadHeader(
        "bundle.zip",
        (await zipArchive([{ name: "a.txt", text: "x" }])).slice().buffer,
      ),
    ).toBeNull();
  });
});
