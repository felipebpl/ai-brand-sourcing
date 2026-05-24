import { describe, expect, test } from 'bun:test';
import { sanitizeFilename } from './file-storage';

describe('sanitizeFilename', () => {
  test('strips POSIX path traversal', () => {
    expect(sanitizeFilename('../../../etc/passwd')).toBe('passwd');
  });

  test('strips Windows path traversal', () => {
    expect(sanitizeFilename('..\\..\\Windows\\System32\\config')).toBe(
      'config',
    );
  });

  test('keeps alphanum, dots, dashes, underscores untouched', () => {
    expect(sanitizeFilename('quotation_1.v2-final.xlsx')).toBe(
      'quotation_1.v2-final.xlsx',
    );
  });

  test('replaces special characters with underscore', () => {
    expect(sanitizeFilename('quotation #2 (final).xlsx')).toBe(
      'quotation_2_final_.xlsx',
    );
  });

  test('handles spaces by collapsing to single underscore', () => {
    expect(sanitizeFilename('my  spaced   file.xlsx')).toBe(
      'my_spaced_file.xlsx',
    );
  });

  test('caps length at 120 characters', () => {
    const long = 'a'.repeat(200) + '.xlsx';
    const out = sanitizeFilename(long);
    expect(out.length).toBeLessThanOrEqual(120);
  });

  test('falls back to upload.xlsx when input is all-special', () => {
    expect(sanitizeFilename('***@@@!!!')).toMatch(/^_+$|^upload\.xlsx$/);
  });

  test('preserves directory-stripped basename for nested paths', () => {
    expect(sanitizeFilename('quotes/2026/q1.xlsx')).toBe('q1.xlsx');
  });
});
