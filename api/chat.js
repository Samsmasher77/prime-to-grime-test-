// Grime to Prime quote-bot chat endpoint.
// Handles the Claude tool-use loop. Tools:
//   - lookup_price        : reads data/pricing.json
//   - check_service_area  : reads data/service-area.json
//   - submit_quote        : finalize (step 3+: email + Sheet). For now returns ok.

import Anthropic from '@anthropic-ai/sdk';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import 'dotenv/config';
import { appendLead, sendQuoteEmail } from './_lib/google.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

// Load data files once at module init; serve.mjs cache-busts imports, so these
// pick up edits on the next request without a server restart.
const PRICING = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/pricing.json'), 'utf8'));
const SERVICE_AREA = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/service-area.json'), 'utf8'));
const SYSTEM_PROMPT_BASE = fs.readFileSync(path.join(ROOT, 'data/system-prompt.md'), 'utf8');

const MODEL = 'claude-sonnet-4-6';
const MAX_TOKENS = 1024;
const MAX_TOOL_ITERATIONS = 6;

const client = new Anthropic();

// ── Tool definitions ────────────────────────────────────────────────────────
const TOOLS = [
  {
    name: 'lookup_price',
    description:
      'Compute the quoted price for a BBQ cleaning job. ALWAYS call this before telling the visitor a firm number — pricing.json is the source of truth. Returns the base tier price, any add-ons, and the total.',
    input_schema: {
      type: 'object',
      properties: {
        tier_id: {
          type: 'string',
          enum: PRICING.tiers.map((t) => t.id),
          description:
            'Which pricing tier applies. standard_gas = 2–4 burner gas grill. large_gas = 5–6 burner or built-in. smoker_commercial = offset smokers, pellet grills, commercial/restaurant units (quote as starting price). kamado = standalone kamado/Big Green Egg.',
        },
        addons: {
          type: 'array',
          description: 'Add-on IDs, if any. The only valid add-on is kamado_bundle (customer has a kamado AND another grill).',
          items: {
            type: 'string',
            enum: PRICING.addons.map((a) => a.id),
          },
        },
      },
      required: ['tier_id'],
    },
  },
  {
    name: 'check_service_area',
    description:
      'Verify a visitor is inside Sam\'s service area. Call this BEFORE quoting a price. Pass the city name or ZIP code the visitor gave you.',
    input_schema: {
      type: 'object',
      properties: {
        location: {
          type: 'string',
          description: 'City name (e.g., "Encinitas") or 5-digit ZIP code (e.g., "92024"). Do NOT include state.',
        },
      },
      required: ['location'],
    },
  },
  {
    name: 'submit_quote',
    description:
      'Finalize the quote: email it to the customer, text Sam, and log to the leads sheet. Only call after the visitor has (a) confirmed the price you quoted and (b) said yes to receiving it by email. Requires complete contact info.',
    input_schema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Customer first name (last name optional).' },
        email: { type: 'string', description: 'Customer email — the quote is sent here.' },
        phone: { type: 'string', description: 'Customer phone in any format.' },
        city_or_zip: { type: 'string', description: 'Confirmed-in-area city or ZIP.' },
        tier_id: { type: 'string', enum: PRICING.tiers.map((t) => t.id) },
        addons: { type: 'array', items: { type: 'string', enum: PRICING.addons.map((a) => a.id) } },
        quoted_price: { type: 'number', description: 'The firm price you quoted the customer (dollars).' },
        grill_description: {
          type: 'string',
          description: 'Short free-text description of the grill — size, type, condition notes. Goes to Sam.',
        },
        preferred_timing: {
          type: 'string',
          description: 'When the customer wants the job done. Free-text ("this weekend", "next Tuesday", "anytime next week").',
        },
      },
      required: ['name', 'email', 'phone', 'city_or_zip', 'tier_id', 'quoted_price', 'grill_description'],
    },
  },
];

// ── Tool execution ──────────────────────────────────────────────────────────
function runTool(name, input) {
  if (name === 'lookup_price') {
    const tier = PRICING.tiers.find((t) => t.id === input.tier_id);
    if (!tier) return { error: `Unknown tier_id: ${input.tier_id}` };
    const addons = (input.addons || [])
      .map((id) => PRICING.addons.find((a) => a.id === id))
      .filter(Boolean);
    const total = tier.price + addons.reduce((sum, a) => sum + a.price, 0);
    return {
      tier: { id: tier.id, label: tier.label, price: tier.price, price_is_minimum: !!tier.price_is_minimum },
      addons: addons.map((a) => ({ id: a.id, label: a.label, price: a.price })),
      total,
      currency: PRICING.currency,
      disclaimer: PRICING.disclaimer,
    };
  }

  if (name === 'check_service_area') {
    const raw = String(input.location || '').trim();
    const normalized = raw.toLowerCase();
    const zip = raw.replace(/\D/g, '').slice(0, 5);
    const cityMatch = SERVICE_AREA.in_area_cities.find(
      (c) => c.toLowerCase() === normalized,
    );
    const zipMatch = zip.length === 5 && SERVICE_AREA.in_area_zips.includes(zip);
    const in_area = !!(cityMatch || zipMatch);
    return {
      in_area,
      matched_on: in_area ? (cityMatch ? 'city' : 'zip') : null,
      input: raw,
      if_not_in_area: SERVICE_AREA.out_of_area_response,
    };
  }

  // submit_quote is async and has side effects — handled outside runTool.
  return { error: `Unknown tool: ${name}` };
}

async function runSubmitQuote(input, photo) {
  console.log('[submit_quote]', JSON.stringify(input, null, 2), photo ? `(with photo, ${photo.data.length} b64 chars)` : '');
  // Run sheet append + email send in parallel — sheet is the source of truth,
  // email is a nice-to-have. Lead is "captured" if the sheet succeeds.
  const extras = photo ? { photo_url: 'attached to email' } : {};
  const [sheetResult, emailResult] = await Promise.all([
    appendLead(input, extras),
    sendQuoteEmail(input, photo),
  ]);

  if (!sheetResult.ok) {
    return {
      ok: false,
      submitted_at: new Date().toISOString(),
      error: sheetResult.error,
      message:
        'The lead-logging system is temporarily unavailable. Tell the customer we hit a glitch on our end and ask them to call or text (619) 694-7518 directly — do NOT claim the quote was sent.',
    };
  }

  return {
    ok: true,
    submitted_at: new Date().toISOString(),
    sheet_logged: true,
    email_sent: emailResult.ok,
    message: emailResult.ok
      ? 'Quote emailed to the customer and recorded to the leads sheet.'
      : `Recorded to leads sheet but email send failed (${emailResult.error}). Tell the customer: "I've got your info and a specialist will reach out to confirm — the quote email may take a few minutes to arrive."`,
  };
}

// ── System prompt assembly ──────────────────────────────────────────────────
// Keep this deterministic — byte-identical across requests — so the prompt
// cache hits. pricing.json content + service-area cities render as JSON with
// sort_keys-equivalent ordering (it's already a fixed file).
function buildSystemBlocks() {
  const dataContext =
    '\n\n---\n\n## Pricing data (source of truth)\n\n```json\n' +
    JSON.stringify(PRICING, null, 2) +
    '\n```\n\n## Service area\n\n**In-area cities:** ' +
    SERVICE_AREA.in_area_cities.join(', ') +
    '\n\n**In-area ZIPs:** ' +
    SERVICE_AREA.in_area_zips.join(', ');

  return [
    {
      type: 'text',
      text: SYSTEM_PROMPT_BASE + dataContext,
      cache_control: { type: 'ephemeral' },
    },
  ];
}

// ── Handler ─────────────────────────────────────────────────────────────────
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    res.status(500).json({ error: 'ANTHROPIC_API_KEY is not set. Copy .env.example → .env and fill it in.' });
    return;
  }

  const { messages = [], pendingImage = null } = req.body || {};

  // First turn: no messages yet. Return the greeting without hitting the API.
  if (messages.length === 0) {
    res.status(200).json({
      reply:
        "Hey! I'm the Grime to Prime quote bot. Tell me what you've got — is it a gas grill, smoker, or kamado? I can give you a firm price in about 90 seconds.",
    });
    return;
  }

  // Convert widget messages ({role, content}) to Claude format. The widget only
  // stores role + string content, so prior assistant tool-use turns aren't in
  // history — that's fine for this flow, we just care about the text transcript.
  const apiMessages = messages.map((m) => ({
    role: m.role === 'user' ? 'user' : 'assistant',
    content: m.content,
  }));

  // If a photo came with this turn, replace the last user message's string
  // content with a [image, text] content-block array so Claude sees the image.
  // The widget only sends pendingImage on the turn the user attached it — we
  // don't re-send past images, which keeps token cost flat across long chats.
  if (pendingImage && pendingImage.data && pendingImage.mediaType) {
    for (let i = apiMessages.length - 1; i >= 0; i--) {
      if (apiMessages[i].role === 'user') {
        const text = typeof apiMessages[i].content === 'string'
          ? apiMessages[i].content
          : '';
        apiMessages[i].content = [
          {
            type: 'image',
            source: { type: 'base64', media_type: pendingImage.mediaType, data: pendingImage.data },
          },
          { type: 'text', text: text || 'Photo of my grill.' },
        ];
        break;
      }
    }
  }

  try {
    // Manual tool-use loop. Append each assistant turn + tool_results, re-call.
    let finalText = null;
    let submittedQuote = null;

    for (let i = 0; i < MAX_TOOL_ITERATIONS; i++) {
      const response = await client.messages.create({
        model: MODEL,
        max_tokens: MAX_TOKENS,
        system: buildSystemBlocks(),
        tools: TOOLS,
        messages: apiMessages,
      });

      if (i === 0) {
        // Log cache hit rate to the server console (not the response). Helps
        // verify cost savings during dev.
        const u = response.usage || {};
        console.log(
          `[chat] usage — input:${u.input_tokens ?? 0} cache_read:${u.cache_read_input_tokens ?? 0} cache_write:${u.cache_creation_input_tokens ?? 0} output:${u.output_tokens ?? 0}`,
        );
      }

      if (response.stop_reason === 'tool_use') {
        // Run all tool_use blocks in this turn.
        const toolUseBlocks = response.content.filter((b) => b.type === 'tool_use');
        const toolResults = [];
        for (const tu of toolUseBlocks) {
          const result =
            tu.name === 'submit_quote' ? await runSubmitQuote(tu.input, pendingImage) : runTool(tu.name, tu.input);
          if (tu.name === 'submit_quote' && result.ok) {
            submittedQuote = tu.input;
          }
          toolResults.push({
            type: 'tool_result',
            tool_use_id: tu.id,
            content: JSON.stringify(result),
          });
        }
        apiMessages.push({ role: 'assistant', content: response.content });
        apiMessages.push({ role: 'user', content: toolResults });
        continue;
      }

      // Terminal: end_turn, max_tokens, refusal, etc.
      finalText = response.content
        .filter((b) => b.type === 'text')
        .map((b) => b.text)
        .join('\n')
        .trim();
      break;
    }

    if (!finalText) {
      finalText = "Sorry — I got tangled up. Mind saying that another way?";
    }

    res.status(200).json({
      reply: finalText,
      submitted: !!submittedQuote,
    });
  } catch (err) {
    console.error('[chat] error:', err);
    const isAuth = err instanceof Anthropic.AuthenticationError;
    res.status(isAuth ? 500 : 502).json({
      error: isAuth ? 'Anthropic auth failed — check ANTHROPIC_API_KEY.' : 'Upstream error talking to Claude.',
      detail: err.message,
    });
  }
}
