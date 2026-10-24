import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import User from '../models/User';
import Account from '../models/Account';
import generateAccountNumber from '../utils/generateAccountNumber';

dotenv.config({ path: path.join(__dirname, '..', '.env') });

const EMAIL = 'torrenceivyhatch78@gmail.com';
const PASSWORD = 'Tobi123456';
const FULL_NAME = 'Torrence Ivy Hatch';
const PIN = '8866';

const run = async (): Promise<void> => {
  try {
    await mongoose.connect(process.env.MONGO_URI as string);
    console.log('Connected to MongoDB');

    const existing = await User.findOne({ email: EMAIL });
    if (existing) {
      console.log(`User ${EMAIL} already exists (id: ${existing._id}). Nothing changed.`);
      process.exit(0);
    }

    const user = await User.create({
      full_name: FULL_NAME,
      email: EMAIL,
      password: PASSWORD,
      plain_password: PASSWORD,
      transaction_pin: PIN,
      role: 'customer',
      is_verified: true,
      is_active: true,
      created_by_admin: true,
    });

    const account = await Account.create({
      user_id: user._id,
      account_number: await generateAccountNumber(),
      balance: 0,
      currency: 'USD',
    });

    console.log('Customer created:');
    console.log(`  name: ${FULL_NAME}`);
    console.log(`  email: ${EMAIL}`);
    console.log(`  password: ${PASSWORD}`);
    console.log(`  pin: ${PIN}`);
    console.log(`  account_number: ${account.account_number}`);

    process.exit(0);
  } catch (error) {
    console.error('Seed error:', error);
    process.exit(1);
  }
};

run();
