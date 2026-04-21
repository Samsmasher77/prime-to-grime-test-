// One-off smoke test: append a row to the leads sheet to verify credentials + share access.
import 'dotenv/config';
import { appendLead } from '../api/_lib/google.js';

const r = await appendLead(
  {
    name: 'Test Customer (delete me)',
    email: 'test@example.com',
    phone: '760-555-0000',
    city_or_zip: 'Encinitas',
    tier_id: 'standard_gas',
    quoted_price: 160,
    grill_description: 'Sheet integration smoke test — safe to delete this row',
    preferred_timing: 'n/a',
  },
  { status: 'test' },
);

console.log('Result:', JSON.stringify(r, null, 2));
process.exit(r.ok ? 0 : 1);
