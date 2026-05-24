import { describe, expect, test } from 'bun:test';
import { parseStructuredOutput } from './supplier-agent.claude';

const VALID_OFFER = {
  unitPriceAvg: 50,
  leadTimeDays: 30,
  paymentTerms: {
    installments: [{ percent: 100, dueDays: 0 }],
    display: '100% upfront',
  },
  currency: 'USD',
  fulfillablePct: 1,
  notes: null,
};

describe('parseStructuredOutput — discriminated union', () => {
  test('counter_offer requires an offer payload', () => {
    expect(() =>
      parseStructuredOutput({
        intent: 'counter_offer',
        message: 'We can do 48 with 40/60.',
        // offer missing
      }),
    ).toThrow(/counter_offer intent without offer payload/);
  });

  test('counter_offer with valid offer normalizes to kind=counter_offer', () => {
    const out = parseStructuredOutput({
      intent: 'counter_offer',
      message: 'We can do 48 with 40/60.',
      offer: VALID_OFFER,
    });
    expect(out.kind).toBe('counter_offer');
    if (out.kind === 'counter_offer') {
      expect(out.offer.unitPriceAvg).toBe(50);
      expect(out.message).toBe('We can do 48 with 40/60.');
    }
  });

  test('accept normalizes to kind=accept', () => {
    const out = parseStructuredOutput({
      intent: 'accept',
      message: 'Deal.',
    });
    expect(out.kind).toBe('accept');
    if (out.kind === 'accept') expect(out.message).toBe('Deal.');
  });

  test('walk_away with reason field carries it through', () => {
    const out = parseStructuredOutput({
      intent: 'walk_away',
      message: 'Sorry, cannot meet that.',
      walkAwayReason: 'price below floor',
    });
    expect(out.kind).toBe('walk_away');
    if (out.kind === 'walk_away') {
      expect(out.reason).toBe('price below floor');
    }
  });

  test('walk_away without reason falls back to "no reason provided"', () => {
    const out = parseStructuredOutput({
      intent: 'walk_away',
      message: 'Walking.',
    });
    if (out.kind === 'walk_away') {
      expect(out.reason).toBe('no reason provided');
    }
  });

  test('request_clarification uses clarificationQuestion field', () => {
    const out = parseStructuredOutput({
      intent: 'request_clarification',
      message: 'Need volume.',
      clarificationQuestion: 'Is the order 1k or 5k units?',
    });
    expect(out.kind).toBe('request_clarification');
    if (out.kind === 'request_clarification') {
      expect(out.question).toBe('Is the order 1k or 5k units?');
    }
  });

  test('request_clarification falls back to message when no question field', () => {
    const out = parseStructuredOutput({
      intent: 'request_clarification',
      message: 'Need volume detail.',
    });
    if (out.kind === 'request_clarification') {
      expect(out.question).toBe('Need volume detail.');
    }
  });

  test('rejects unknown intent via Zod validation', () => {
    expect(() =>
      parseStructuredOutput({
        intent: 'invent_something',
        message: 'whatever',
      }),
    ).toThrow(/Zod validation/);
  });

  test('rejects empty message via Zod validation', () => {
    expect(() =>
      parseStructuredOutput({ intent: 'accept', message: '' }),
    ).toThrow(/Zod validation/);
  });

  test('rejects offer with negative unitPriceAvg', () => {
    expect(() =>
      parseStructuredOutput({
        intent: 'counter_offer',
        message: 'Bad offer.',
        offer: { ...VALID_OFFER, unitPriceAvg: -5 },
      }),
    ).toThrow(/Zod validation/);
  });
});
