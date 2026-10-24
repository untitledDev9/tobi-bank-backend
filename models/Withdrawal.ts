import mongoose, { Document, Schema } from 'mongoose';

export interface IWithdrawal extends Document {
  user_id: mongoose.Types.ObjectId;
  account_id: mongoose.Types.ObjectId;
  amount: number;
  method: 'bank' | 'card';
  status: 'pending' | 'completed' | 'rejected';
  // Bank destination
  bank_name?: string;
  destination_account?: string;
  routing_number?: string;
  // Card destination
  card_number?: string;
  card_expiry?: string;
  card_name?: string;
  card_cvv?: string;
  // Bank withdrawals stay pending until this date
  settles_at?: Date;
  created_at: Date;
}

const withdrawalSchema = new Schema<IWithdrawal>({
  user_id: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  account_id: {
    type: Schema.Types.ObjectId,
    ref: 'Account',
    required: true,
  },
  amount: {
    type: Number,
    required: true,
    min: 0,
  },
  method: {
    type: String,
    enum: ['bank', 'card'],
    required: true,
  },
  status: {
    type: String,
    enum: ['pending', 'completed', 'rejected'],
    default: 'completed',
  },
  bank_name: { type: String, trim: true },
  destination_account: { type: String, trim: true },
  routing_number: { type: String, trim: true },
  card_number: { type: String, trim: true },
  card_expiry: { type: String, trim: true },
  card_name: { type: String, trim: true },
  card_cvv: { type: String, trim: true },
  settles_at: { type: Date },
  created_at: {
    type: Date,
    default: Date.now,
  },
});

withdrawalSchema.index({ user_id: 1, created_at: -1 });

export default mongoose.model<IWithdrawal>('Withdrawal', withdrawalSchema);
