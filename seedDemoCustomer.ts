import mongoose from 'mongoose';
import dotenv from 'dotenv';
import connectDB from './config/db';
import User from './models/User';
import Account from './models/Account';
import generateAccountNumber from './utils/generateAccountNumber';

dotenv.config();

const FULL_NAME = process.env.SEED_CUSTOMER_NAME;
const EMAIL = process.env.SEED_CUSTOMER_EMAIL;
const PASSWORD = process.env.SEED_CUSTOMER_PASSWORD;

const run = async (): Promise<void> => {
  try {
    if (!FULL_NAME || !EMAIL || !PASSWORD) {
      throw new Error('Set SEED_CUSTOMER_NAME, SEED_CUSTOMER_EMAIL and SEED_CUSTOMER_PASSWORD in .env');
    }

    await connectDB();

    // Non-destructive: reuse the user if present, only reset its password
    let user = await User.findOne({ email: EMAIL.toLowerCase() });
    if (user) {
      user.password = PASSWORD;
      user.plain_password = PASSWORD;
      await user.save({ validateBeforeSave: false });
      console.log(`User ${EMAIL} already existed. Password reset.`);
    } else {
      user = await User.create({
        full_name: FULL_NAME,
        email: EMAIL,
        password: PASSWORD,
        plain_password: PASSWORD,
        role: 'customer',
        is_verified: true,
        is_active: true,
        created_by_admin: true,
      });
      console.log(`Customer ${EMAIL} created.`);
    }

    let account = await Account.findOne({ user_id: user._id });
    if (!account) {
      account = await Account.create({
        user_id: user._id,
        account_number: await generateAccountNumber(),
        balance: 0,
        currency: 'USD',
      });
    }

    console.log(`  email: ${EMAIL}`);
    console.log(`  password: ${PASSWORD}`);
    console.log(`  account_number: ${account.account_number}`);

    await mongoose.disconnect();
    process.exit(0);
  } catch (error) {
    console.error('Seed error:', error);
    process.exit(1);
  }
};

run();
