// One-time OAuth bootstrap for the Grime to Prime quote bot.
// Walks you through the Google OAuth consent flow, captures the authorization
// code on a local callback server, exchanges it for a refresh token, and prints
// the env vars you paste into .env (local) and Vercel (production).
//
// Prereq: you created an OAuth 2.0 "Desktop app" credential in Google Cloud
// Console and downloaded the JSON as scripts/credentials.json.
//
// Run:  node scripts/google-oauth-bootstrap.mjs

import fs from 'fs';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import { google } from 'googleapis';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CREDS_PATH = path.join(__dirname, 'credentials.json');
const PORT = 53682;
const REDIRECT_URI = `http://localhost:${PORT}/oauth/callback`;

// Scopes: Sheets (read+write) + Gmail send. Gmail is for step 4; we request it
// now so Sam doesn't have to re-authorize later.
const SCOPES = [
  'https://www.googleapis.com/auth/spreadsheets',
  'https://www.googleapis.com/auth/gmail.send',
];

function die(msg) {
  console.error('\n❌ ' + msg + '\n');
  process.exit(1);
}

if (!fs.existsSync(CREDS_PATH)) {
  die(
    `Couldn't find credentials.json at ${CREDS_PATH}.\n` +
      `Download OAuth client credentials (Desktop app) from Google Cloud Console\n` +
      `and save them to that path, then re-run this script.`,
  );
}

const creds = JSON.parse(fs.readFileSync(CREDS_PATH, 'utf8'));
// Google ships these as either {installed: {...}} or {web: {...}} — normalize.
const envelope = creds.installed || creds.web;
if (!envelope) die('credentials.json is missing the "installed" or "web" block. Re-download as a Desktop app.');

const { client_id: clientId, client_secret: clientSecret } = envelope;
const oauth2 = new google.auth.OAuth2(clientId, clientSecret, REDIRECT_URI);

const authUrl = oauth2.generateAuthUrl({
  access_type: 'offline',
  prompt: 'consent', // force consent screen so a refresh_token is always returned
  scope: SCOPES,
});

console.log('\n───────────────────────────────────────────────────────');
console.log('  Grime to Prime — Google OAuth bootstrap');
console.log('───────────────────────────────────────────────────────');
console.log('\n1. Opening Google consent screen in your browser.');
console.log('2. Sign in as  grimetoprime12@gmail.com  (the account that owns the leads sheet).');
console.log('3. Click "Continue" past the unverified-app warning (this is your own app).');
console.log('4. Approve the Sheets + Gmail scopes.');
console.log('\nIf the browser does not open automatically, paste this URL:\n');
console.log(authUrl + '\n');

const server = http.createServer(async (req, res) => {
  if (!req.url?.startsWith('/oauth/callback')) {
    res.writeHead(404);
    res.end();
    return;
  }
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const code = url.searchParams.get('code');
  const error = url.searchParams.get('error');

  if (error) {
    res.writeHead(400, { 'Content-Type': 'text/html' });
    res.end(`<h1>Auth failed</h1><p>${error}</p>`);
    server.close();
    die(`OAuth error: ${error}`);
    return;
  }

  try {
    const { tokens } = await oauth2.getToken(code);
    if (!tokens.refresh_token) {
      throw new Error(
        'No refresh_token returned. Revoke previous access at https://myaccount.google.com/permissions and re-run.',
      );
    }

    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(`
      <html><body style="font-family:sans-serif; padding:40px; background:#111; color:#F0EAD6;">
        <h1 style="color:#E8872A;">✅ Authorized</h1>
        <p>You can close this tab and return to your terminal.</p>
      </body></html>
    `);

    console.log('\n✅ Got a refresh token. Paste the following into your .env (local)');
    console.log('   AND into the Vercel project\'s Environment Variables dashboard:\n');
    console.log('───────────────────────────────────────────────────────');
    console.log(`GOOGLE_CLIENT_ID=${clientId}`);
    console.log(`GOOGLE_CLIENT_SECRET=${clientSecret}`);
    console.log(`GOOGLE_REFRESH_TOKEN=${tokens.refresh_token}`);
    console.log('───────────────────────────────────────────────────────\n');
    console.log('You still need to paste your sheet ID:');
    console.log('   LEADS_SHEET_ID=<the ID in your Google Sheet URL>\n');
    console.log('The sheet URL looks like:');
    console.log('   https://docs.google.com/spreadsheets/d/THIS_PART_IS_THE_ID/edit\n');

    server.close();
    process.exit(0);
  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'text/html' });
    res.end(`<h1>Token exchange failed</h1><pre>${err.message}</pre>`);
    server.close();
    die(err.message);
  }
});

server.listen(PORT, async () => {
  try {
    const open = (await import('child_process')).exec;
    const cmd = process.platform === 'win32' ? 'start ""' : process.platform === 'darwin' ? 'open' : 'xdg-open';
    open(`${cmd} "${authUrl}"`);
  } catch {
    // open failed — user has the URL printed above
  }
});
