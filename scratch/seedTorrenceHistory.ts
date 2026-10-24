import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import User from '../models/User';
import Account from '../models/Account';
import Transaction from '../models/Transaction';
import AuditLog from '../models/AuditLog';

dotenv.config({ path: path.join(__dirname, '..', '.env') });

const EMAIL = 'torrenceivyhatch78@gmail.com';
const FINAL_BALANCE = 40583627;
const MONTHS = 36;
const MS_PER_DAY = 86400000;
// Share of the final balance that comes from the opening deposit; the rest is built up by activity
const INITIAL_DEPOSIT_SHARE = 0.15;

// Small seeded PRNG so reruns produce the same pattern
const mulberry32 = (seed: number) => () => {
  seed |= 0;
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

interface Template {
  type: 'credit' | 'debit';
  description: string;
  weight: number;
  day: number;
  when: (month: number) => boolean;
  jitter?: number;
}

const every = (n: number, offset = 0) => (m: number) => m % n === offset;
const always = () => true;

const templates: Template[] = [
  { type: 'credit', description: 'Salary deposit', weight: 3.0, day: 1, when: always, jitter: 0.04 },
  { type: 'credit', description: 'Freelance payment', weight: 1.2, day: 9, when: every(2, 1), jitter: 0.3 },
  { type: 'credit', description: 'Wire transfer received', weight: 1.8, day: 14, when: every(3, 2), jitter: 0.3 },
  { type: 'credit', description: 'Interest earned', weight: 0.6, day: 27, when: every(3, 0), jitter: 0.15 },
  { type: 'credit', description: 'Commission payment', weight: 4.0, day: 20, when: every(12, 11), jitter: 0.2 },
  { type: 'credit', description: 'Refund processed', weight: 0.15, day: 18, when: every(5, 3), jitter: 0.4 },
  { type: 'credit', description: 'Transfer from savings', weight: 0.4, day: 25, when: every(4, 1), jitter: 0.3 },

  { type: 'debit', description: 'Rent payment', weight: 0.55, day: 3, when: always, jitter: 0.02 },
  { type: 'debit', description: 'Electric bill payment', weight: 0.12, day: 6, when: always, jitter: 0.25 },
  { type: 'debit', description: 'Internet subscription', weight: 0.05, day: 7, when: always, jitter: 0.03 },
  { type: 'debit', description: 'Phone bill', weight: 0.04, day: 8, when: always, jitter: 0.1 },
  { type: 'debit', description: 'Grocery purchase', weight: 0.18, day: 11, when: always, jitter: 0.25 },
  { type: 'debit', description: 'Streaming subscription', weight: 0.03, day: 12, when: always, jitter: 0.02 },
  { type: 'debit', description: 'Gym membership', weight: 0.04, day: 13, when: always, jitter: 0.02 },
  { type: 'debit', description: 'Restaurant payment', weight: 0.15, day: 15, when: always, jitter: 0.4 },
  { type: 'debit', description: 'Online shopping', weight: 0.3, day: 17, when: always, jitter: 0.5 },
  { type: 'debit', description: 'Gas station', weight: 0.1, day: 19, when: always, jitter: 0.3 },
  { type: 'debit', description: 'Water bill', weight: 0.06, day: 21, when: always, jitter: 0.15 },
  { type: 'debit', description: 'Grocery purchase', weight: 0.18, day: 22, when: always, jitter: 0.25 },
  { type: 'debit', description: 'Transportation', weight: 0.08, day: 24, when: always, jitter: 0.3 },
  { type: 'debit', description: 'Insurance premium', weight: 0.5, day: 5, when: every(3, 0), jitter: 0.03 },
  { type: 'debit', description: 'Medical payment', weight: 0.25, day: 16, when: every(4, 2), jitter: 0.5 },
  { type: 'debit', description: 'Travel booking', weight: 0.9, day: 10, when: every(6, 4), jitter: 0.4 },
];

const run = async (): Promise<void> => {
  try {
    await mongoose.connect(process.env.MONGO_URI as string);
    console.log('Connected to MongoDB');

    const user = await User.findOne({ email: EMAIL });
    if (!user) throw new Error(`User ${EMAIL} not found. Run scratch/seedTorrence.ts first.`);
    const account = await Account.findOne({ user_id: user._id });
    if (!account) throw new Error('Account not found.');

    const existingCount = await Transaction.countDocuments({ account_id: account._id });
    if (existingCount > 0) throw new Error(`Account already has ${existingCount} transactions. Aborting.`);

    const admin = await User.findOne({ email: (process.env.SEED_ADMIN_EMAIL || '').toLowerCase(), role: 'admin' });

    const rand = mulberry32(8866);
    const now = Date.now();
    const startDay = -MONTHS * 30.42; // ~3 years back

    // Raw events in weight units; scaled to money below
    const events: { type: 'credit' | 'debit'; description: string; weight: number; at: Date }[] = [];
    for (let m = 0; m < MONTHS; m++) {
      const monthStart = startDay + m * 30.42;
      for (const t of templates) {
        if (!t.when(m)) continue;
        const weight = t.weight * (1 + (rand() * 2 - 1) * (t.jitter ?? 0.1));
        const dayOffset = Math.min(monthStart + t.day, -1.2);
        const at = new Date(now + dayOffset * MS_PER_DAY);
        at.setUTCHours(8 + Math.floor(rand() * 9), Math.floor(rand() * 60), Math.floor(rand() * 60), 0);
        if (at.getTime() >= now) continue;
        events.push({ type: t.type, description: t.description, weight, at });
      }
    }

    const netWeight = events.reduce((s, e) => s + (e.type === 'credit' ? e.weight : -e.weight), 0);
    const finalCents = Math.round(FINAL_BALANCE * 100);
    const scale = (finalCents * (1 - INITIAL_DEPOSIT_SHARE)) / netWeight;

    const scaled = events
      .map((e) => ({ ...e, cents: Math.max(Math.round(e.weight * scale), 1) }))
      .sort((a, b) => a.at.getTime() - b.at.getTime());

    const netCents = scaled.reduce((s, e) => s + (e.type === 'credit' ? e.cents : -e.cents), 0);
    const initialCents = finalCents - netCents;
    if (initialCents <= 0) throw new Error('Computed opening deposit is not positive.');

    const openedAt = new Date(scaled[0].at.getTime() - 5 * MS_PER_DAY);
    const adminId = admin ? admin._id : null;
    const docs: any[] = [
      {
        account_id: account._id,
        type: 'credit',
        amount: initialCents / 100,
        balance_after: initialCents / 100,
        description: 'Initial deposit',
        created_at: openedAt,
        created_by: adminId,
      },
    ];

    let balanceCents = initialCents;
    for (const e of scaled) {
      balanceCents += e.type === 'credit' ? e.cents : -e.cents;
      if (balanceCents < 0) throw new Error(`Balance went negative at ${e.at.toISOString()} (${e.description}).`);
      docs.push({
        account_id: account._id,
        type: e.type,
        amount: e.cents / 100,
        balance_after: balanceCents / 100,
        description: e.description,
        created_at: e.at,
        created_by: adminId,
      });
    }
    if (balanceCents !== finalCents) throw new Error(`Final balance mismatch: ${balanceCents} vs ${finalCents}`);

    await Transaction.insertMany(docs);

    account.balance = FINAL_BALANCE;
    account.updated_at = new Date();
    await account.save();

    user.is_verified = true;
    user.verified_at = new Date();
    user.verified_by = adminId as any;
    user.created_at = openedAt;
    await user.save({ validateBeforeSave: false });

    if (admin) {
      await AuditLog.create({
        admin_id: admin._id,
        action: 'VERIFY_ACCOUNT',
        target_user_id: user._id,
        details: { previous: true, current: true },
      });
    }

    console.log(`Inserted ${docs.length} transactions`);
    console.log(`  from ${docs[0].created_at.toISOString()} to ${docs[docs.length - 1].created_at.toISOString()}`);
    console.log(`  opening deposit: ${initialCents / 100}`);
    console.log(`  final balance:   ${account.balance}`);
    console.log(`  verified: ${user.is_verified} (by ${admin ? admin.email : 'n/a'})`);

    process.exit(0);
  } catch (error) {
    console.error('Seed error:', error);
    process.exit(1);
  }
};

run();
