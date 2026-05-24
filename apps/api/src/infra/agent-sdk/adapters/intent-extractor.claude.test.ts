import { describe, expect, test } from 'bun:test';
import {
  extractJson,
  extractUserInstructionIntent,
} from './intent-extractor.claude';

describe('extractJson', () => {
  test('parses bare JSON object', () => {
    expect(extractJson('{"a": 1}')).toEqual({ a: 1 });
  });

  test('parses object with leading whitespace', () => {
    expect(extractJson('   \n  {"a": 1}\n')).toEqual({ a: 1 });
  });

  test('extracts object surrounded by prose', () => {
    const text = 'Here is the intent:\n\n{"priority": "speed"}\n\nThat is all.';
    expect(extractJson(text)).toEqual({ priority: 'speed' });
  });

  test('returns null when no braces present', () => {
    expect(extractJson('not json at all')).toBeNull();
  });

  test('returns null when braces enclose invalid JSON', () => {
    expect(extractJson('prefix { invalid: } suffix')).toBeNull();
  });

  test('handles nested objects', () => {
    expect(
      extractJson('{"a": 1, "b": {"c": [1, 2]}}'),
    ).toEqual({ a: 1, b: { c: [1, 2] } });
  });
});

describe('extractUserInstructionIntent fallback paths', () => {
  test('returns balanced for null instruction', async () => {
    const intent = await extractUserInstructionIntent(null);
    expect(intent.priority).toBe('balanced');
    expect(intent.constraints).toEqual({});
  });

  test('returns balanced for empty string', async () => {
    const intent = await extractUserInstructionIntent('');
    expect(intent.priority).toBe('balanced');
  });

  test('returns balanced for whitespace-only', async () => {
    const intent = await extractUserInstructionIntent('   \n\t  ');
    expect(intent.priority).toBe('balanced');
  });
});
