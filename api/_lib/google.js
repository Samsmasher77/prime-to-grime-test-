// Shared Google API helpers for the quote bot.
// Uses a refresh token (generated once by scripts/google-oauth-bootstrap.mjs)
// to mint short-lived access tokens on demand — no interactive auth in prod.
//
// Env vars required (.env locally, Vercel env in prod):
//   GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN, LEADS_SHEET_ID
//   QUOTE_FROM_EMAIL (address emails send from, e.g. grimetoprime12@gmail.com)
//   QUOTE_NOTIFY_EMAIL (optional: where to send internal lead pings)

import { google } from 'googleapis';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');
const EMAIL_TEMPLATE = fs.readFileSync(path.join(ROOT, 'data/email-template.html'), 'utf8');
const PRICING = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/pricing.json'), 'utf8'));

const SHEET_TAB = 'Leads';
const SHEET_HEADERS = [
  'timestamp',
  'name',
  'email',
  'phone',
  'city_or_zip',
  'tier_id',
  'addons',
  'quoted_price',
  'grill_description',
  'preferred_timing',
  'photo_url',
  'status',
];

function requireEnv(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

function oauthClient() {
  const client = new google.auth.OAuth2(
    requireEnv('GOOGLE_CLIENT_ID'),
    requireEnv('GOOGLE_CLIENT_SECRET'),
    'http://localhost:53682/oauth/callback',
  );
  client.setCredentials({ refresh_token: requireEnv('GOOGLE_REFRESH_TOKEN') });
  return client;
}

export function sheetsClient() {
  return google.sheets({ version: 'v4', auth: oauthClient() });
}

export function gmailClient() {
  return google.gmail({ version: 'v1', auth: oauthClient() });
}

// Make sure the "Leads" tab exists and has the header row.
// Idempotent — safe to call on every append.
async function ensureSheet(sheets, spreadsheetId) {
  const meta = await sheets.spreadsheets.get({ spreadsheetId });
  const hasTab = meta.data.sheets.some((s) => s.properties.title === SHEET_TAB);
  if (!hasTab) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: { requests: [{ addSheet: { properties: { title: SHEET_TAB } } }] },
    });
  }
  // Check if header row exists; if not, write it.
  const first = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${SHEET_TAB}!A1:L1`,
  });
  const currentHeaders = first.data.values?.[0] || [];
  if (currentHeaders.length === 0 || currentHeaders[0] !== 'timestamp') {
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `${SHEET_TAB}!A1`,
      valueInputOption: 'RAW',
      requestBody: { values: [SHEET_HEADERS] },
    });
  }
}

/**
 * Append one lead row to the Grime to Prime leads sheet.
 * Takes the submit_quote tool payload plus optional extras and writes a row.
 * Never throws — logs and returns {ok:false} so the conversation can still confirm to the visitor.
 */
export async function appendLead(payload, extras = {}) {
  try {
    const sheets = sheetsClient();
    const spreadsheetId = requireEnv('LEADS_SHEET_ID');
    await ensureSheet(sheets, spreadsheetId);

    const row = [
      new Date().toISOString(),
      payload.name || '',
      payload.email || '',
      payload.phone || '',
      payload.city_or_zip || '',
      payload.tier_id || '',
      (payload.addons || []).join(', '),
      payload.quoted_price ?? '',
      payload.grill_description || '',
      payload.preferred_timing || '',
      extras.photo_url || '',
      extras.status || 'new',
    ];

    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: `${SHEET_TAB}!A:L`,
      valueInputOption: 'RAW',
      insertDataOption: 'INSERT_ROWS',
      requestBody: { values: [row] },
    });

    return { ok: true };
  } catch (err) {
    console.error('[appendLead] failed:', err.message);
    return { ok: false, error: err.message };
  }
}

// ── Email ──────────────────────────────────────────────────────────────────

function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function renderQuoteEmail(payload) {
  const tier = PRICING.tiers.find((t) => t.id === payload.tier_id);
  const tierLabel = tier ? tier.label + (tier.description ? ' — ' + tier.description : '') : payload.tier_id;

  const addonIds = payload.addons || [];
  let addonsBlock = '';
  if (addonIds.length) {
    const addonLines = addonIds
      .map((id) => {
        const a = PRICING.addons.find((x) => x.id === id);
        return a
          ? `<div style="margin-top:4px; font-size:13px; color:#C8C0AD;">+ ${escapeHtml(a.label)} — $${a.price}</div>`
          : '';
      })
      .filter(Boolean)
      .join('');
    addonsBlock = addonLines;
  }

  const firstName = (payload.name || '').split(/\s+/)[0] || 'there';

  return EMAIL_TEMPLATE
    .replace('{{NAME_FIRST}}', escapeHtml(firstName))
    .replace('{{QUOTED_PRICE}}', escapeHtml(payload.quoted_price))
    .replace('{{TIER_LABEL}}', escapeHtml(tierLabel))
    .replace('{{ADDONS_BLOCK}}', addonsBlock)
    .replace('{{GRILL_DESCRIPTION}}', escapeHtml(payload.grill_description || '—'))
    .replace('{{CITY_OR_ZIP}}', escapeHtml(payload.city_or_zip || '—'))
    .replace('{{PREFERRED_TIMING}}', escapeHtml(payload.preferred_timing || '—'));
}

function buildMimeMessage({ to, from, subject, html, cc, attachment }) {
  // RFC 2822 with UTF-8 headers encoded via RFC 2047 "B" (base64).
  const b = (s) => `=?UTF-8?B?${Buffer.from(s, 'utf8').toString('base64')}?=`;

  let bodyHeaders;
  let body;

  if (attachment && attachment.data) {
    // multipart/mixed: HTML body + image attachment
    const boundary = '----grime_boundary_' + Math.random().toString(36).slice(2) + Date.now().toString(36);
    const mediaType = attachment.mediaType || 'image/jpeg';
    const filename = attachment.filename || 'grill-photo.jpg';
    // Wrap base64 at 76 chars per RFC 2045.
    const encoded = attachment.data.replace(/(.{76})/g, '$1\r\n');

    bodyHeaders = [`Content-Type: multipart/mixed; boundary="${boundary}"`];

    const parts = [
      `--${boundary}`,
      'Content-Type: text/html; charset=UTF-8',
      'Content-Transfer-Encoding: 7bit',
      '',
      html,
      '',
      `--${boundary}`,
      `Content-Type: ${mediaType}; name="${filename}"`,
      `Content-Disposition: attachment; filename="${filename}"`,
      'Content-Transfer-Encoding: base64',
      '',
      encoded,
      '',
      `--${boundary}--`,
    ];
    body = parts.join('\r\n');
  } else {
    bodyHeaders = [
      'Content-Type: text/html; charset=UTF-8',
      'Content-Transfer-Encoding: 7bit',
    ];
    body = html;
  }

  const headers = [
    `From: ${from}`,
    `To: ${to}`,
    cc ? `Cc: ${cc}` : null,
    `Subject: ${b(subject)}`,
    'MIME-Version: 1.0',
    ...bodyHeaders,
  ].filter(Boolean);
  const raw = headers.join('\r\n') + '\r\n\r\n' + body;
  // Gmail wants base64url (no padding) of the full MIME message.
  return Buffer.from(raw, 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * Send the branded quote email to the customer (and optionally CC the internal notify address).
 * Returns {ok: true, messageId} on success or {ok: false, error} on failure — never throws.
 */
export async function sendQuoteEmail(payload, photo) {
  try {
    const from = requireEnv('QUOTE_FROM_EMAIL');
    const notify = process.env.QUOTE_NOTIFY_EMAIL && process.env.QUOTE_NOTIFY_EMAIL !== from
      ? process.env.QUOTE_NOTIFY_EMAIL
      : null;

    if (!payload.email) return { ok: false, error: 'No customer email on payload' };

    const html = renderQuoteEmail(payload);
    const subject = `Your Grime to Prime Quote — $${payload.quoted_price}`;

    const attachment = photo && photo.data
      ? {
          data: photo.data,
          mediaType: photo.mediaType || 'image/jpeg',
          filename: photo.filename || `grill-${Date.now()}.jpg`,
        }
      : null;

    const gmail = gmailClient();
    const raw = buildMimeMessage({
      to: payload.email,
      from: `Grime to Prime <${from}>`,
      subject,
      html,
      cc: notify,
      attachment,
    });

    const result = await gmail.users.messages.send({
      userId: 'me',
      requestBody: { raw },
    });

    return { ok: true, messageId: result.data.id };
  } catch (err) {
    console.error('[sendQuoteEmail] failed:', err.message);
    return { ok: false, error: err.message };
  }
}
