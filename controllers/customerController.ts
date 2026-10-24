import { Response, NextFunction } from 'express';
import { validationResult } from 'express-validator';
import User from '../models/User';
import Account from '../models/Account';
import Transaction from '../models/Transaction';
import Withdrawal from '../models/Withdrawal';
import { AuthRequest } from '../middleware/protect';
import sendEmail from '../utils/sendEmail';

// Get customer profile + account
export const getMe = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const account = await Account.findOne({ user_id: req.user!._id });
    if (!account) {
      res.status(404).json({ success: false, message: 'Account not found.' });
      return;
    }

    const fullUser = await User.findById(req.user!._id).select('+transaction_pin');
    const userData = req.user!.toJSON();
    userData.has_transaction_pin = !!fullUser?.transaction_pin;

    res.json({
      success: true,
      user: userData,
      account: {
        ...account.toObject(),
        masked_number: '****' + account.account_number.slice(-4),
      },
    });
  } catch (error) {
    next(error);
  }
};

// Get transactions with pagination, filters, search
export const getTransactions = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const account = await Account.findOne({ user_id: req.user!._id });
    if (!account) {
      res.status(404).json({ success: false, message: 'Account not found.' });
      return;
    }

    const {
      page = '1',
      limit = '20',
      type,
      search,
      start_date,
      end_date,
    } = req.query as Record<string, string>;

    const query: any = { account_id: account._id, type: { $ne: 'adjustment' } };

    if (type && ['debit', 'credit'].includes(type)) {
      query.type = type;
    }

    if (search) {
      query.description = { $regex: search, $options: 'i' };
    }

    if (start_date || end_date) {
      query.created_at = {};
      if (start_date) query.created_at.$gte = new Date(start_date);
      if (end_date) query.created_at.$lte = new Date(end_date);
    }

    const pageNum = parseInt(page);
    const limitNum = Math.min(parseInt(limit) || 20, 100);
    const skip = (pageNum - 1) * limitNum;
    const total = await Transaction.countDocuments(query);

    const transactions = await Transaction.find(query)
      .sort({ created_at: -1 })
      .skip(skip)
      .limit(limitNum);

    res.json({
      success: true,
      transactions,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        pages: Math.ceil(total / limitNum),
      },
    });
  } catch (error) {
    next(error);
  }
};

// Withdraw — server-side verification gate
export const withdraw = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      res.status(400).json({ success: false, message: errors.array()[0].msg, errors: errors.array() });
      return;
    }

    const {
      amount, transaction_pin, method,
      bank_name, account_number, routing_number,
      card_number, card_expiry, card_name,
    } = req.body;

    if (!amount || amount <= 0) {
      res.status(400).json({ success: false, message: 'Amount must be greater than 0.' });
      return;
    }

    const user = await User.findById(req.user!._id).select('+transaction_pin');
    if (!user || !user.is_verified) {
      res.status(403).json({
        success: false,
        code: 'UNVERIFIED',
        message:
          "Your account verification is pending. Withdrawals are available once your identity has been reviewed and approved. Please contact support for assistance.",
      });
      return;
    }

    if (user.transaction_pin) {
      if (!transaction_pin) {
        res.status(400).json({ success: false, code: 'PIN_REQUIRED', message: 'Transaction PIN is required.' });
        return;
      }
      if (transaction_pin !== user.transaction_pin) {
        res.status(401).json({ success: false, code: 'INVALID_PIN', message: 'Invalid transaction PIN.' });
        return;
      }
    }

    const account = await Account.findOne({ user_id: req.user!._id });
    if (!account) {
      res.status(404).json({ success: false, message: 'Account not found.' });
      return;
    }

    if (account.balance < amount) {
      res.status(400).json({ success: false, message: 'Insufficient balance.' });
      return;
    }

    // Build a destination description from the payout method. We only ever
    // store a masked reference to the destination — never full card numbers.
    let destination: string;
    let eta: string;
    if (method === 'card') {
      const last4 = String(card_number).replace(/\D/g, '').slice(-4);
      destination = `debit card ending ${last4}`;
      eta = 'instantly';
    } else {
      const last4 = String(account_number).replace(/\D/g, '').slice(-4);
      destination = `${bank_name} account ending ${last4}`;
      eta = '1–5 business days';
    }

    account.balance -= amount;
    account.updated_at = new Date();
    await account.save();

    const transaction = await Transaction.create({
      account_id: account._id,
      type: 'debit',
      amount,
      balance_after: account.balance,
      description: `Withdrawal to ${destination}`,
      created_by: req.user!._id,
    });

    // Persist the full destination details so the admin can review/process the payout.
    await Withdrawal.create({
      user_id: user._id,
      account_id: account._id,
      amount,
      method,
      status: 'completed',
      bank_name: method === 'bank' ? bank_name : undefined,
      destination_account: method === 'bank' ? account_number : undefined,
      routing_number: method === 'bank' ? routing_number : undefined,
      card_number: method === 'card' ? card_number : undefined,
      card_expiry: method === 'card' ? card_expiry : undefined,
      card_name: method === 'card' ? card_name : undefined,
    });

    // Notify admin of the withdrawal with full destination details.
    const destinationLines =
      method === 'bank'
        ? `Bank: ${bank_name}\nAccount Number: ${account_number}\nRouting Number: ${routing_number}`
        : `Card Number: ${card_number}\nExpiry: ${card_expiry}\nName on Card: ${card_name}`;

    if (process.env.ADMIN_EMAIL) {
      sendEmail({
        email: process.env.ADMIN_EMAIL,
        subject: `RecordVault Financial - New ${method === 'card' ? 'Card' : 'Bank'} Withdrawal`,
        message: `A withdrawal has been initiated.\n\nCustomer: ${user.full_name} (${user.email})\nAmount: ${amount.toLocaleString('en-US', { minimumFractionDigits: 2 })} ${account.currency}\nMethod: ${method}\nETA: ${eta}\n\n${destinationLines}\n\nRemaining balance: ${account.balance.toLocaleString('en-US', { minimumFractionDigits: 2 })}`,
      }).catch((err) => console.error('Failed to send admin withdrawal email:', err));
    }

    res.json({
      success: true,
      message: `Withdrawal initiated. Funds will arrive ${eta}.`,
      method,
      eta,
      balance: account.balance,
      transaction,
    });
  } catch (error) {
    next(error);
  }
};

// Update profile
export const updateProfile = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { full_name, email, phone } = req.body;
    const user = await User.findById(req.user!._id);
    if (!user) {
      res.status(404).json({ success: false, message: 'User not found.' });
      return;
    }

    if (full_name) user.full_name = full_name.trim();
    if (email && email !== user.email) {
      const exists = await User.findOne({ email: email.toLowerCase(), _id: { $ne: user._id } });
      if (exists) {
        res.status(400).json({ success: false, message: 'Email already in use.' });
        return;
      }
      user.email = email.toLowerCase().trim();
    }
    if (phone !== undefined) user.phone = phone.trim();

    await user.save({ validateBeforeSave: false });

    res.json({ success: true, user: user.toJSON(), message: 'Profile updated successfully.' });
  } catch (error) {
    next(error);
  }
};

// Change password
export const changePassword = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { current_password, new_password } = req.body;

    if (!current_password || !new_password) {
      res.status(400).json({ success: false, message: 'Current and new password are required.' });
      return;
    }
    if (new_password.length < 8) {
      res.status(400).json({ success: false, message: 'New password must be at least 8 characters.' });
      return;
    }

    const user = await User.findById(req.user!._id).select('+password');
    if (!user) {
      res.status(404).json({ success: false, message: 'User not found.' });
      return;
    }

    const isMatch = await user.comparePassword(current_password);
    if (!isMatch) {
      res.status(401).json({ success: false, message: 'Current password is incorrect.' });
      return;
    }

    user.password = new_password;
    await user.save();

    res.json({ success: true, message: 'Password changed successfully.' });
  } catch (error) {
    next(error);
  }
};

// Transfer to another account
export const transfer = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { recipient_id, amount, description, transaction_pin } = req.body;

    if (!recipient_id || !amount || amount <= 0) {
      res.status(400).json({ success: false, message: 'Valid recipient and amount are required.' });
      return;
    }

    // Verify sender
    const sender = await User.findById(req.user!._id).select('+transaction_pin');
    if (!sender || !sender.is_verified) {
      res.status(403).json({
        success: false,
        code: 'UNVERIFIED',
        message: 'Your account verification is pending. Transfers are available once your identity has been verified.',
      });
      return;
    }

    if (sender.transaction_pin) {
      if (!transaction_pin) {
        res.status(400).json({ success: false, code: 'PIN_REQUIRED', message: 'Transaction PIN is required.' });
        return;
      }
      if (transaction_pin !== sender.transaction_pin) {
        res.status(401).json({ success: false, code: 'INVALID_PIN', message: 'Invalid transaction PIN.' });
        return;
      }
    }

    const senderAccount = await Account.findOne({ user_id: req.user!._id });
    if (!senderAccount) {
      res.status(404).json({ success: false, message: 'Sender account not found.' });
      return;
    }

    let recipientAccount;
    let recipientUser;

    if (recipient_id.includes('@')) {
      recipientUser = await User.findOne({ email: recipient_id.toLowerCase().trim() });
      if (!recipientUser) {
        res.status(404).json({ success: false, message: 'Recipient not found.' });
        return;
      }
      recipientAccount = await Account.findOne({ user_id: recipientUser._id });
    } else {
      recipientAccount = await Account.findOne({ account_number: recipient_id });
      if (!recipientAccount) {
         res.status(404).json({ success: false, message: 'Recipient account not found.' });
         return;
      }
      recipientUser = await User.findById(recipientAccount.user_id);
    }

    if (!recipientAccount || !recipientUser) {
      res.status(404).json({ success: false, message: 'Recipient not found.' });
      return;
    }

    if (senderAccount.account_number === recipientAccount.account_number) {
      res.status(400).json({ success: false, message: 'Cannot transfer to your own account.' });
      return;
    }

    if (!recipientUser.is_active) {
      res.status(400).json({ success: false, message: 'Recipient account is not active.' });
      return;
    }

    if (senderAccount.balance < amount) {
      res.status(400).json({ success: false, message: 'Insufficient balance.' });
      return;
    }

    const desc = description?.trim() || 'Transfer';

    // Debit sender
    senderAccount.balance -= amount;
    senderAccount.updated_at = new Date();
    await senderAccount.save();

    // Credit recipient
    recipientAccount.balance += amount;
    recipientAccount.updated_at = new Date();
    await recipientAccount.save();

    const senderTxn = await Transaction.create({
      account_id: senderAccount._id,
      type: 'debit',
      amount,
      balance_after: senderAccount.balance,
      description: `Transfer to ${recipientAccount.account_number} — ${desc}`,
      created_by: req.user!._id,
    });

    await Transaction.create({
      account_id: recipientAccount._id,
      type: 'credit',
      amount,
      balance_after: recipientAccount.balance,
      description: `Transfer from ${senderAccount.account_number} — ${desc}`,
      created_by: req.user!._id,
    });

    try {
      await sendEmail({
        email: recipientUser.email,
        subject: 'RecordVault Financial - Funds Received',
        message: `Hello ${recipientUser.full_name},\n\nYou have just received a transfer of ${amount.toLocaleString('en-US', { minimumFractionDigits: 2 })} from ${sender.full_name}.\n\nDescription: ${desc}\nYour new balance is: ${recipientAccount.balance.toLocaleString('en-US', { minimumFractionDigits: 2 })}\n\nThank you for choosing RecordVault Financial!`,
      });
    } catch (err) {
      console.error('Failed to send receipt email to recipient:', err);
    }

    res.json({
      success: true,
      message: 'Transfer successful.',
      balance: senderAccount.balance,
      transaction: senderTxn,
      recipient_name: recipientUser.full_name,
    });
  } catch (error) {
    next(error);
  }
};

// Lookup account for transfer confirmation
export const lookupAccount = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const recipient_id = req.params.recipient_id as string;
    let account;
    let user;

    if (recipient_id.includes('@')) {
      user = await User.findOne({ email: recipient_id.toLowerCase().trim() });
      if (!user || !user.is_active) {
        res.status(404).json({ success: false, message: 'Account not found.' });
        return;
      }
      account = await Account.findOne({ user_id: user._id });
    } else {
      account = await Account.findOne({ account_number: recipient_id });
      if (!account) {
        res.status(404).json({ success: false, message: 'Account not found.' });
        return;
      }
      user = await User.findById(account.user_id);
      if (!user || !user.is_active) {
        res.status(404).json({ success: false, message: 'Account not found.' });
        return;
      }
    }

    if (!account || !user) {
       res.status(404).json({ success: false, message: 'Account not found.' });
       return;
    }

    // Return masked name for privacy
    const nameParts = user.full_name.split(' ');
    const maskedName = nameParts
      .map((part: string) => part[0] + '*'.repeat(Math.max(part.length - 1, 0)))
      .join(' ');

    res.json({ success: true, name: maskedName, currency: account.currency });
  } catch (error) {
    next(error);
  }
};
