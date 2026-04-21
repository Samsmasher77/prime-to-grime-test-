// One-off smoke test: render + send the quote email to a real address.
import 'dotenv/config';
import { sendQuoteEmail } from '../api/_lib/google.js';

const to = process.argv[2];
if (!to) {
  console.error('Usage: node scripts/test-email-send.mjs <recipient-email>');
  process.exit(1);
}

const r = await sendQuoteEmail({
  name: 'Sam Test',
  email: to,
  phone: '760-555-0000',
  city_or_zip: 'Encinitas',
  tier_id: 'large_gas',
  addons: [],
  quoted_price: 200,
  grill_description: '5-burner built-in, hasn\'t been cleaned in 6 months',
  preferred_timing: 'this weekend',
});

console.log('Result:', JSON.stringify(r, null, 2));
process.exit(r.ok ? 0 : 1);
