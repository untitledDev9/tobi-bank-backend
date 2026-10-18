import mongoose, { Document, Schema } from 'mongoose';

export type OtpPurpose = 'register' | 'password_reset';

export interface IEmailOtp extends Document {
  email: string;
  purpose: OtpPurpose;
  code_hash: string;
  attempts: number;
  last_sent_at: Date;
  expires_at: Date;
}

const emailOtpSchema = new Schema<IEmailOtp>({
  email: {
    type: String,
    required: true,
    lowercase: true,
    trim: true,
  },
  purpose: {
    type: String,
    enum: ['register', 'password_reset'],
    required: true,
  },
  code_hash: {
    type: String,
    required: true,
  },
  attempts: {
    type: Number,
    default: 0,
  },
  last_sent_at: {
    type: Date,
    default: Date.now,
  },
  expires_at: {
    type: Date,
    required: true,
  },
});

// One live code per email + purpose; re-sending overwrites it.
emailOtpSchema.index({ email: 1, purpose: 1 }, { unique: true });
// Mongo deletes the document once expires_at passes.
emailOtpSchema.index({ expires_at: 1 }, { expireAfterSeconds: 0 });

export default mongoose.model<IEmailOtp>('EmailOtp', emailOtpSchema);
