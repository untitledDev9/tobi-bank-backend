import mongoose from 'mongoose';
import User from '../models/User';
import Account from '../models/Account';
import Transaction from '../models/Transaction';
import Withdrawal from '../models/Withdrawal';

const SWEEP_INTERVAL_MS = 5 * 60 * 1000;

// A held bank withdrawal already left the balance; settling just marks it paid out
const settleWithdrawal = async (
  txnId: mongoose.Types.ObjectId,
  withdrawalId: mongoose.Types.ObjectId
): Promise<boolean> => {
  const session = await mongoose.startSession();
  try {
    let settled = false;
    await session.withTransaction(async () => {
      settled = false;
      const now = new Date();
      const claimed = await Transaction.findOneAndUpdate(
        { _id: txnId, status: 'pending' },
        { $set: { status: 'completed', settled_at: now } },
        { session }
      );
      if (!claimed) return;
      settled = true;
      await Withdrawal.updateOne({ _id: withdrawalId, status: 'pending' }, { $set: { status: 'completed' } }, { session });
    });
    return settled;
  } finally {
    await session.endSession();
  }
};

// Settles one held transfer (identified by either side's pending transaction): the recipient's
// balance is credited and both sides flip from pending to completed. If the money can't be
// delivered (recipient removed or deactivated while it was held) it goes back to the sender.
const settleTransfer = async (txnId: mongoose.Types.ObjectId): Promise<boolean> => {
  const seed = await Transaction.findById(txnId).lean();
  if (!seed || seed.status !== 'pending') return false;
  if (seed.withdrawal_id) return settleWithdrawal(seed._id as mongoose.Types.ObjectId, seed.withdrawal_id);

  const other = seed.linked_transaction_id ? await Transaction.findById(seed.linked_transaction_id).lean() : null;
  const pair = [seed, other].filter(Boolean) as (typeof seed)[];
  const credit = pair.find((t) => t.type === 'credit');
  const debit = pair.find((t) => t.type === 'debit');
  // Always claim the credit when there is one, so two sweeps can never both pay out
  const claimTarget = credit ?? debit;
  if (!claimTarget) return false;

  const session = await mongoose.startSession();
  try {
    let settled = false;
    await session.withTransaction(async () => {
      settled = false;
      const now = new Date();

      const claimed = await Transaction.findOneAndUpdate(
        { _id: claimTarget._id, status: 'pending' },
        { $set: { status: 'completed', settled_at: now } },
        { session }
      );
      if (!claimed) return;
      settled = true;

      const recipientAccount = credit ? await Account.findById(credit.account_id).session(session) : null;
      const recipient = recipientAccount ? await User.findById(recipientAccount.user_id).session(session) : null;

      if (credit && recipientAccount && recipient?.is_active) {
        const updated = await Account.findOneAndUpdate(
          { _id: recipientAccount._id },
          { $inc: { balance: credit.amount }, $set: { updated_at: now } },
          { returnDocument: 'after', session }
        );
        await Transaction.updateOne({ _id: credit._id }, { $set: { balance_after: updated!.balance } }, { session });
        if (debit) {
          await Transaction.updateOne(
            { _id: debit._id },
            { $set: { status: 'completed', settled_at: now } },
            { session }
          );
        }
        return;
      }

      // Undeliverable: mark the transfer failed and give the sender their money back
      if (credit) {
        await Transaction.updateOne({ _id: credit._id }, { $set: { status: 'failed' } }, { session });
      }
      if (debit) {
        await Transaction.updateOne({ _id: debit._id }, { $set: { status: 'failed', settled_at: now } }, { session });
        const senderAccount = await Account.findOneAndUpdate(
          { _id: debit.account_id },
          { $inc: { balance: debit.amount }, $set: { updated_at: now } },
          { returnDocument: 'after', session }
        );
        if (senderAccount) {
          await Transaction.create(
            [
              {
                account_id: senderAccount._id,
                type: 'credit',
                amount: debit.amount,
                balance_after: senderAccount.balance,
                description: `Reversal — ${debit.description}`,
                counterparty_name: debit.counterparty_name,
                counterparty_account: debit.counterparty_account,
                linked_transaction_id: debit._id,
                created_by: null,
              },
            ],
            { session }
          );
        }
      }
    });
    return settled;
  } finally {
    await session.endSession();
  }
};

// Settles every held transfer that has come due, optionally only those touching one account
export const settleDueTransfers = async (accountId?: mongoose.Types.ObjectId): Promise<number> => {
  const query: Record<string, unknown> = { status: 'pending', settles_at: { $lte: new Date() } };
  if (accountId) query.account_id = accountId;

  const due = await Transaction.find(query).select('_id').lean();
  let count = 0;
  for (const { _id } of due) {
    if (await settleTransfer(_id as mongoose.Types.ObjectId)) count++;
  }
  return count;
};

const sweep = async (): Promise<void> => {
  try {
    const count = await settleDueTransfers();
    if (count > 0) console.log(`Settled ${count} held transfer(s).`);
  } catch (error) {
    console.error('Transfer settlement failed:', error);
  }
};

// Runs once on startup (catches anything that came due while the server was down), then on an interval
export const startSettlementJob = (): void => {
  if (mongoose.connection.readyState === 1) sweep();
  else mongoose.connection.once('connected', sweep);
  setInterval(sweep, SWEEP_INTERVAL_MS).unref();
};
