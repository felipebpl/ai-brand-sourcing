import type { ParseResult } from '../types';

/**
 * Parser port. Implementations interpret a supplier-uploaded XLSX file
 * (or any source format) into a typed QuotationExtraction.
 *
 * The default implementation is a Claude subagent with the
 * `quotation-parser` skill loaded — see
 * `src/infra/agent-sdk/adapters/parser.claude.ts`.
 *
 * `quotationId` is the DB row already created at upload time; the parser
 * does not own row creation, only structured extraction.
 */
export interface ParserPort {
  parse(input: {
    quotationId: string;
    storageUri: string;
    uploadedFilename: string;
    userInstruction: string | null;
  }): Promise<ParseResult>;
}
