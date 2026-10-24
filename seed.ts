import mongoose from 'mongoose';
import dotenv from 'dotenv';
import User from './models/User';
import Account from './models/Account';
import AuditLog from './models/AuditLog';

dotenv.config();

const seed = async (): Promise<void> => {
  try {
    await mongoose.connect(process.env.MONGO_URI as string);
    console.log('Connected to MongoDB');

    // Clear users, accounts, and audit logs — keep transaction history
    await User.deleteMany({});
    await Account.deleteMany({});
    await AuditLog.deleteMany({});
    console.log('Cleared users, accounts, and audit logs (transactions preserved)');

    // Create admin only
    const { SEED_ADMIN_NAME, SEED_ADMIN_EMAIL, SEED_ADMIN_PASSWORD } = process.env;
    if (!SEED_ADMIN_NAME || !SEED_ADMIN_EMAIL || !SEED_ADMIN_PASSWORD) {
      throw new Error('Set SEED_ADMIN_NAME, SEED_ADMIN_EMAIL and SEED_ADMIN_PASSWORD in .env');
    }
    await User.create({
      full_name: SEED_ADMIN_NAME,
      email: SEED_ADMIN_EMAIL,
      password: SEED_ADMIN_PASSWORD,
      role: 'admin',
      is_verified: true,
      is_active: true,
    });
    console.log(`Admin created: ${SEED_ADMIN_EMAIL} / ${SEED_ADMIN_PASSWORD}`);

    console.log('\nSeed complete! Admin account ready.');
    console.log('Use the admin panel to create customer accounts.');

    process.exit(0);
  } catch (error) {
    console.error('Seed error:', error);
    process.exit(1);
  }
};

seed();
