// Diagnostic: fetch metadata + recent rows from the leads sheet the OAuth token has access to.
import 'dotenv/config';
import { sheetsClient } from '../api/_lib/google.js';

const spreadsheetId = process.env.LEADS_SHEET_ID;
const sheets = sheetsClient();

const meta = await sheets.spreadsheets.get({ spreadsheetId });
console.log('Sheet title :', meta.data.properties.title);
console.log('Sheet URL   : https://docs.google.com/spreadsheets/d/' + spreadsheetId + '/edit');
console.log('Tabs        :', meta.data.sheets.map((s) => s.properties.title).join(', '));
console.log('');

const rows = await sheets.spreadsheets.values.get({
  spreadsheetId,
  range: 'Leads!A1:L',
});
const data = rows.data.values || [];
console.log(`Leads tab has ${data.length} row(s):`);
data.forEach((row, i) => {
  const preview = row.map((c) => (c || '').toString().slice(0, 20)).join(' | ');
  console.log(`  ${i === 0 ? 'HEADER' : 'row ' + i}: ${preview}`);
});
