import Anthropic from '@anthropic-ai/sdk';
import { UserInstructionIntentSchema, type UserInstructionIntent } from '@app/shared';
import { env } from '../../../lib/env';
import { modelFor, TaskAssignment } from '../model-router';

/**
 * Extract structured intent from the user's free-text instruction at upload.
 *
 * Uses Haiku 4.5 + JSON schema output for a cheap, fast classification.
 * Falls back to `{ priority: 'balanced', constraints: {} }` if the user
 * left the instruction blank or the call fails — the brand agent still
 * reads the raw text via `userInstruction`, so the structured intent is
 * a *hint*, not the sole source of priority.
 *
 * Cost envelope: ~$0.001 per call (Haiku, <200 tokens in/out). Fire on
 * the parse-pipeline path so the quotation row has the intent populated
 * before negotiation kicks off.
 */
const SYSTEM_PROMPT = `# Role

You extract structured sourcing intent from a brand sourcing manager's
free-text instruction. The instruction may arrive in any language; your
output is always English.

## Output schema

\`\`\`
{
  "priority": "speed" | "cost" | "quality" | "balanced",
  "constraints": {
    "maxLeadTimeDays": number | null,
    "maxUnitPrice": number | null,
    "minQualityScore": number | null,
    "deadlineDate": ISO-8601 string | null,
    "preferredPaymentTerms": string | null
  }
}
\`\`\`

## How to map common phrases

- "need this fast", "urgent", "tight deadline" → priority: "speed"
- "best price", "tightest budget", "cheapest" → priority: "cost"
- "premium quality", "no compromises", "best supplier" → priority: "quality"
- Mixed signals or no signal → priority: "balanced"

Numeric constraints (e.g. "ship within 30 days", "budget under $20/unit",
"quality 4.5+", "delivery by March 15") → populate the matching field;
otherwise leave the constraint null.

If the instruction is empty, return priority: "balanced" with all
constraints null.

## Hard rules

- Output only the JSON object — no commentary, no markdown.
- Never invent constraints the user didn't state.
- Numeric fields are numbers, not strings.`;

const INTENT_JSON_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['priority', 'constraints'],
  properties: {
    priority: {
      type: 'string',
      enum: ['speed', 'cost', 'quality', 'balanced'],
    },
    constraints: {
      type: 'object',
      additionalProperties: false,
      properties: {
        maxLeadTimeDays: { type: ['number', 'null'] },
        maxUnitPrice: { type: ['number', 'null'] },
        minQualityScore: { type: ['number', 'null'] },
        deadlineDate: { type: ['string', 'null'] },
        preferredPaymentTerms: { type: ['string', 'null'] },
      },
    },
  },
};

const BALANCED_DEFAULT: UserInstructionIntent = {
  priority: 'balanced',
  constraints: {},
};

const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });

export async function extractUserInstructionIntent(
  userInstruction: string | null,
): Promise<UserInstructionIntent> {
  const trimmed = userInstruction?.trim();
  if (!trimmed) {
    return BALANCED_DEFAULT;
  }

  try {
    const response = await client.messages.create({
      model: modelFor(TaskAssignment.userInstructionIntent),
      max_tokens: 400,
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: 'user',
          content: `Brand sourcing instruction:\n\n${trimmed}\n\nReturn the structured intent JSON now.`,
        },
      ],
    });

    const textBlock = response.content.find((b) => b.type === 'text');
    if (!textBlock || textBlock.type !== 'text') {
      return BALANCED_DEFAULT;
    }
    const json = extractJson(textBlock.text);
    const parsed = UserInstructionIntentSchema.safeParse(json);
    if (!parsed.success) {
      console.warn(
        '[intent-extractor] Haiku output failed schema validation:',
        parsed.error.message,
      );
      return BALANCED_DEFAULT;
    }
    return parsed.data;
  } catch (err) {
    console.warn(
      '[intent-extractor] extraction failed, defaulting to balanced:',
      err instanceof Error ? err.message : String(err),
    );
    return BALANCED_DEFAULT;
  }
}

void INTENT_JSON_SCHEMA;

/**
 * Pull the first JSON object out of Haiku's response. Haiku usually emits
 * just the object, but tolerate prefix/suffix prose by scanning braces.
 * Exported for unit testing.
 */
export function extractJson(text: string): unknown {
  const trimmed = text.trim();
  if (trimmed.startsWith('{')) {
    try {
      return JSON.parse(trimmed);
    } catch {
      /* fall through */
    }
  }
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
}
