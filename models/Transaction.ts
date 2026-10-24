import mongoose, { Document, Schema } from 'mongoose';

export interface ITransaction extends Document {
  account_id: mongoose.Types.ObjectId;
  type: 'debit' | 'credit' | 'adjustment';
  amount: number;
  balance_after: number;
  description: string;
  created_at: Date;
  created_by: mongoose.Types.ObjectId | null;
  // Held transfers stay 'pending' until settles_at; everything else is 'completed'
  status: 'pending' | 'completed' | 'failed';
  settles_at?: Date;
  settled_at?: Date;
  // The other side of a transfer (sender's debit <-> recipient's credit)
  linked_transaction_id?: mongoose.Types.ObjectId;
  kind?: 'transfer' | 'withdrawal';
  // Set on a held bank withdrawal; settling it completes the Withdrawal record too
  withdrawal_id?: mongoose.Types.ObjectId;
  counterparty_name?: string;
  counterparty_account?: string;
  note?: string;
}

const transactionSchema = new Schema<ITransaction>({
  account_id: {
    type: Schema.Types.ObjectId,
    ref: 'Account',
    required: true,
  },
  type: {
    type: String,
    enum: ['debit', 'credit', 'adjustment'],
    required: true,
  },
  amount: {
    type: Number,
    required: true,
    min: 0,
  },
  balance_after: {
    type: Number,
    required: true,
  },
  description: {
    type: String,
    default: '',
  },
  created_at: {
    type: Date,
    default: Date.now,
  },
  created_by: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    default: null,
  },
  status: {
    type: String,
    enum: ['pending', 'completed', 'failed'],
    default: 'completed',
  },
  settles_at: { type: Date },
  settled_at: { type: Date },
  linked_transaction_id: { type: Schema.Types.ObjectId, ref: 'Transaction' },
  kind: { type: String, enum: ['transfer', 'withdrawal'] },
  withdrawal_id: { type: Schema.Types.ObjectId, ref: 'Withdrawal' },
  counterparty_name: { type: String, trim: true },
  counterparty_account: { type: String, trim: true },
  note: { type: String, trim: true },
});

// Per-account history (newest first) and the admin dashboard's global recent list.
transactionSchema.index({ account_id: 1, created_at: -1 });
transactionSchema.index({ created_at: -1 });
// Settlement sweep: pending credits that have come due.
transactionSchema.index({ status: 1, settles_at: 1 });

export default mongoose.model<ITransaction>('Transaction', transactionSchema);
