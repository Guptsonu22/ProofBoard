import { parse } from 'csv-parse/sync';
import type { Info, CsvError } from 'csv-parse';
import { AppError } from '../lib/errors.js';

export type ColumnType = 'number' | 'date' | 'category' | 'text';
export type ColumnProfile = {
  id: string;
  originalName: string;
  displayName: string;
  type: ColumnType;
  rationale: string;
  missingCount: number;
  invalidCount: number;
  samples: string[];
};
export type IngestRow = {
  ordinal: number;
  sourceRow: number;
  sourceLine: number;
  values: string[];
  warnings: string[];
  rejected: boolean;
  rejectionReason: string | null;
};
export type ParsedCsv = { columns: ColumnProfile[]; rows: IngestRow[]; sourceRecordCount: number; parsedRowCount: number; rejectedRowCount: number };
type ParsedRecord = { record: string[]; info: Info; raw: string };

const MAX_COLUMNS = 100;
const MAX_ROWS = 50_000;
const MAX_RECORD_CHARS = 256_000;
const NUMBER = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/;
const ID_HEADER = /(?:^|[ _-])(id|identifier|code|key|uuid|zip|postal|reference|ref)(?:$|[ _-])|(?:customer|account|invoice|record|order)[ _-]?number/i;
const NUMBER_HEADER = /amount|total|count|price|quantity|revenue|sales|score|age|rate|percent|value|weight|height|cost|tax|balance/i;
const DATE_HEADER = /date|time|created|updated|timestamp|signup/i;

export function parseCsv(buffer: Buffer): ParsedCsv {
  if (buffer.includes(0)) throw new AppError(400, 'UNSUPPORTED_FILE', 'This file contains binary data. Upload a plain UTF-8 CSV.');
  let source: string;
  try {
    source = new TextDecoder('utf-8', { fatal: true }).decode(buffer).replace(/^\uFEFF/, '');
  } catch {
    throw new AppError(400, 'INVALID_UTF8', 'This file is not valid UTF-8. Save it as UTF-8 CSV and try again.');
  }
  if (!source.trim()) throw new AppError(400, 'EMPTY_FILE', 'The CSV is empty. Add a header row and at least one data row.');
  if ([...source].some((char) => (char.codePointAt(0) ?? 0) === 0 || ((char.codePointAt(0) ?? 0) < 32 && !'\r\n\t'.includes(char)))) {
    throw new AppError(400, 'UNSUPPORTED_FILE', 'This file contains binary or unsupported control characters. Upload a plain UTF-8 CSV.');
  }
  assertBalancedQuotes(source);

  const malformed: Array<{ raw: string; reason: string; line: number }> = [];
  let parsed: ParsedRecord[];
  try {
    parsed = parse(source, {
      bom: true, columns: false, skip_empty_lines: false, skip_records_with_error: true,
      relax_column_count: true, raw: true, info: true, max_record_size: MAX_RECORD_CHARS,
      on_skip(error: CsvError | undefined, raw: string | undefined) {
        malformed.push({ raw: raw ?? '', reason: friendlyCsvError(error), line: typeof error?.lines === 'number' ? error.lines : 1 });
      },
    }) as unknown as ParsedRecord[];
  } catch (error) {
    throw new AppError(400, 'MALFORMED_CSV', `The CSV could not be parsed: ${friendlyCsvError(error as CsvError)}. Check the quotes and record length.`);
  }
  if (parsed.length < 2) throw new AppError(400, 'EMPTY_FILE', 'No CSV data rows were found. Add a header row and at least one data row.');
  if (malformed.some((entry) => entry.line <= parsed[0]!.info.lines)) throw new AppError(400, 'MALFORMED_HEADER', 'The CSV header contains malformed quoting. Repair the first row and upload again.');
  const headers = parsed[0]!.record;
  if (!headers.length || headers.length > MAX_COLUMNS) throw new AppError(400, 'COLUMN_LIMIT', `CSV files must have between 1 and ${MAX_COLUMNS} columns.`);
  const dataRecords = parsed.slice(1);
  if (dataRecords.length + malformed.length > MAX_ROWS) throw new AppError(413, 'ROW_LIMIT', `This file exceeds the ${MAX_ROWS.toLocaleString()} source-row limit.`);

  const rows: IngestRow[] = [];
  // Merge recoverable parser errors and valid records by their original source line.
  const events = [
    ...dataRecords.map((entry, index) => ({ kind: 'parsed' as const, entry, line: entry.info.lines, tie: index })),
    ...malformed.map((entry, index) => ({ kind: 'bad' as const, entry, line: entry.line, tie: index })),
  ].sort((a, b) => a.line - b.line || a.tie - b.tie);
  for (const event of events) {
    const ordinal = rows.length + 1;
    if (event.kind === 'bad') {
      const reason = `Malformed CSV record: ${event.entry.reason}`;
      rows.push({ ordinal, sourceRow: ordinal + 1, sourceLine: event.line, values: [event.entry.raw.slice(0, MAX_RECORD_CHARS)], warnings: [reason], rejected: true, rejectionReason: reason });
      continue;
    }
    const record = event.entry.record;
    const reason = record.length !== headers.length ? `Expected ${headers.length} fields but found ${record.length}.` : null;
    rows.push({ ordinal, sourceRow: ordinal + 1, sourceLine: event.line, values: record, warnings: reason ? [reason] : [], rejected: !!reason, rejectionReason: reason });
  }
  if (headers.length > MAX_COLUMNS || rows.some((row) => row.values.length > MAX_COLUMNS)) throw new AppError(400, 'COLUMN_LIMIT', `CSV files may contain no more than ${MAX_COLUMNS} columns.`);

  const columns = profileColumns(headers, rows.filter((row) => !row.rejected));
  for (const row of rows) {
    if (row.rejected) continue;
    columns.forEach((column, index) => {
      const value = row.values[index] ?? '';
      if (value.trim() === '') { row.warnings.push(`${column.displayName}: value is missing.`); return; }
      const invalid = column.type === 'number' ? !(NUMBER.test(value.trim()) && Number.isFinite(Number(value))) : column.type === 'date' ? !isIsoDate(value) : false;
      if (invalid) row.warnings.push(`${column.displayName}: “${value.slice(0, 80)}” is not a valid ${column.type}.`);
    });
  }
  return { columns, rows, sourceRecordCount: rows.length, parsedRowCount: rows.filter((row) => !row.rejected).length, rejectedRowCount: rows.filter((row) => row.rejected).length };
}

function assertBalancedQuotes(source: string): void {
  let quoted = false;
  let fieldStart = true;
  for (let index = 0; index < source.length; index++) {
    const char = source[index];
    if (char === '"') {
      if (quoted) {
        if (source[index + 1] === '"') { index++; continue; }
        quoted = false;
      } else if (fieldStart) quoted = true;
      fieldStart = false;
    } else if (!quoted && char === ',') fieldStart = true;
    else if (!quoted && (char === '\n' || char === '\r')) fieldStart = true;
    else if (!quoted && fieldStart && char !== ' ' && char !== '\t') fieldStart = false;
  }
  if (quoted) throw new AppError(400, 'MALFORMED_CSV', 'The CSV ends inside a quoted field. Close the quote or repair the final record.');
}

function friendlyCsvError(error?: CsvError): string {
  if (!error) return 'invalid quoting';
  if (error.code === 'CSV_QUOTE_NOT_CLOSED') return 'a quoted field was not closed';
  if (error.code === 'CSV_INVALID_CLOSING_QUOTE') return 'a quote appeared in an unquoted field';
  return error.message.replace(/^CSV_[A-Z_]+:\s*/, '').slice(0, 180);
}

function profileColumns(headers: string[], rows: IngestRow[]): ColumnProfile[] {
  return headers.map((originalName, index) => {
    const id = `column_${index + 1}`;
    const values = rows.map((row) => row.values[index] ?? '');
    const present = values.filter((value) => value.trim() !== '');
    const distinct = new Set(present);
    const numericCount = present.filter((value) => NUMBER.test(value.trim()) && Number.isFinite(Number(value))).length;
    const dateCount = present.filter(isIsoDate).length;
    const mostlyUniqueIntegers = present.length >= 5 && distinct.size / present.length >= 0.8 && present.every((value) => /^[+-]?\d+$/.test(value.trim()));
    const idLike = ID_HEADER.test(originalName.trim()) || present.some((value) => /^0\d+$/.test(value.trim())) || (mostlyUniqueIntegers && !NUMBER_HEADER.test(originalName));
    let type: ColumnType;
    let rationale: string;
    if (present.length === 0) {
      type = 'text'; rationale = 'No non-empty samples; kept as text because there is not enough evidence to infer a type.';
    } else if (!idLike && ((DATE_HEADER.test(originalName) && dateCount >= 3 && dateCount / present.length >= 0.75) || dateCount / present.length >= 0.9)) {
      type = 'date'; rationale = DATE_HEADER.test(originalName) && dateCount / present.length < 0.9 ? `The header indicates dates and at least 75% of non-empty samples are valid ISO dates (${dateCount}/${present.length}).` : `At least 90% of non-empty samples are valid ISO dates (${dateCount}/${present.length}).`;
    } else if (!idLike && ((NUMBER_HEADER.test(originalName) && numericCount >= 3 && numericCount / present.length >= 0.75) || numericCount / present.length >= 0.95)) {
      type = 'number'; rationale = NUMBER_HEADER.test(originalName) && numericCount / present.length < 0.95 ? `The header indicates a measure and at least 75% of non-empty samples are finite numbers (${numericCount}/${present.length}); identifiers are excluded.` : `At least 95% of non-empty samples are finite numeric values (${numericCount}/${present.length}); the column name and values do not look like identifiers.`;
    } else if (distinct.size <= Math.min(50, Math.ceil(present.length * 0.2))) {
      type = 'category'; rationale = `The column has low cardinality (${distinct.size} distinct values across ${present.length} non-empty samples).`;
    } else {
      type = idLike ? 'category' : 'text';
      rationale = idLike ? 'Identifier-like names, leading zeroes, or mostly unique integer strings are kept categorical to avoid treating IDs as measures.' : 'Values do not meet the conservative number or ISO date thresholds, and cardinality is too high for a category.';
    }
    const invalidCount = type === 'number' ? present.length - numericCount : type === 'date' ? present.length - dateCount : 0;
    return {
      id, originalName, displayName: originalName.trim() ? (headers.slice(0, index).includes(originalName) ? `${originalName} (${index + 1})` : originalName) : `Column ${index + 1} (unnamed)`,
      type, rationale, missingCount: values.length - present.length, invalidCount,
      samples: [...new Set(present)].slice(0, 3),
    };
  });
}

function isIsoDate(value: string): boolean {
  const input = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/.test(input)) return false;
  const date = new Date(input);
  return Number.isFinite(date.valueOf()) && date.toISOString().slice(0, 10) === input.slice(0, 10);
}
