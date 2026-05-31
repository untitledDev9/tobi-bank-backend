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
    await User.create({
      full_name: 'Admin User',
      email: 'nice@nice.com',
      password: '!Nice7070',
      role: 'admin',
      is_verified: true,
      is_active: true,
    });
    console.log('Admin created: nice@nice.com / !Nice7070');

    console.log('\nSeed complete! Admin account ready.');
    console.log('Use the admin panel to create customer accounts.');

    process.exit(0);
  } catch (error) {
    console.error('Seed error:', error);
    process.exit(1);
  }
};

seed();
