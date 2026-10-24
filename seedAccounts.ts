import mongoose from 'mongoose';
import dotenv from 'dotenv';
import connectDB from './config/db';
import User from './models/User';
import Account from './models/Account';
import generateAccountNumber from './utils/generateAccountNumber';

dotenv.config();

const required = (key: string): string => {
  const value = process.env[key];
  if (!value) throw new Error(`Set ${key} in .env`);
  return value;
};

// Non-destructive: create the user if missing, otherwise reset its password and flags
const upsertUser = async (
  role: 'admin' | 'customer',
  full_name: string,
  email: string,
  password: string
) => {
  const existing = await User.findOne({ email: email.toLowerCase() });
  if (existing) {
    existing.role = role;
    existing.is_verified = true;
    existing.is_active = true;
    existing.password = password;
    existing.plain_password = role === 'customer' ? password : undefined;
    await existing.save({ validateBeforeSave: false });
    console.log(`${role} ${email} already existed. Password reset.`);
    return existing;
  }

  const user = await User.create({
    full_name,
    email,
    password,
    plain_password: role === 'customer' ? password : undefined,
    role,
    is_verified: true,
    is_active: true,
    created_by_admin: role === 'customer',
  });
  console.log(`${role} ${email} created.`);
  return user;
};

const run = async (): Promise<void> => {
  try {
    const admin = {
      name: required('SEED_ADMIN_NAME'),
      email: required('SEED_ADMIN_EMAIL'),
      password: required('SEED_ADMIN_PASSWORD'),
    };
    const customer = {
      name: required('SEED_CUSTOMER_NAME'),
      email: required('SEED_CUSTOMER_EMAIL'),
      password: required('SEED_CUSTOMER_PASSWORD'),
    };

    await connectDB();

    await upsertUser('admin', admin.name, admin.email, admin.password);

    const user = await upsertUser('customer', customer.name, customer.email, customer.password);
    let account = await Account.findOne({ user_id: user._id });
    if (!account) {
      account = await Account.create({
        user_id: user._id,
        account_number: await generateAccountNumber(),
        balance: 0,
        currency: 'USD',
      });
    }

    console.log(`\n  admin:    ${admin.email} / ${admin.password}`);
    console.log(`  customer: ${customer.email} / ${customer.password} (account ${account.account_number})`);

    await mongoose.disconnect();
    process.exit(0);
  } catch (error) {
    console.error('Seed error:', error);
    process.exit(1);
  }
};

run();
