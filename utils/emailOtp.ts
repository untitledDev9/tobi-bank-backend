import crypto from 'crypto';
import EmailOtp, { OtpPurpose } from '../models/EmailOtp';

const OTP_TTL_MS = 10 * 60 * 1000;
const RESEND_COOLDOWN_MS = 30 * 1000;
const MAX_ATTEMPTS = 5;

export type OtpCheck = 'ok' | 'invalid' | 'expired' | 'locked';

// Codes are stored as an HMAC bound to the email and purpose, never in plain text.
const hashCode = (email: string, purpose: OtpPurpose, code: string): Buffer =>
  crypto
    .createHmac('sha256', process.env.JWT_SECRET as string)
    .update(`${purpose}:${email}:${code}`)
    .digest();

// Creates (or replaces) the code for this email + purpose and returns it so the
// caller can email it. Returns null while the resend cooldown is still running.
export const issueOtp = async (email: string, purpose: OtpPurpose): Promise<string | null> => {
  const existing = await EmailOtp.findOne({ email, purpose });
  if (existing && Date.now() - existing.last_sent_at.getTime() < RESEND_COOLDOWN_MS) {
    return null;
  }

  const code = crypto.randomInt(100000, 1000000).toString();
  await EmailOtp.findOneAndUpdate(
    { email, purpose },
    {
      code_hash: hashCode(email, purpose, code).toString('hex'),
      attempts: 0,
      last_sent_at: new Date(),
      expires_at: new Date(Date.now() + OTP_TTL_MS),
    },
    { upsert: true, setDefaultsOnInsert: true }
  );

  return code;
};

// Every call spends one attempt (atomically), so parallel guesses can't beat the limit.
// A correct code is not consumed here; call clearOtp once the action has succeeded.
export const checkOtp = async (email: string, purpose: OtpPurpose, code: string): Promise<OtpCheck> => {
  const doc = await EmailOtp.findOneAndUpdate(
    { email, purpose, expires_at: { $gt: new Date() }, attempts: { $lt: MAX_ATTEMPTS } },
    { $inc: { attempts: 1 } },
    { new: true }
  );

  if (!doc) {
    const stale = await EmailOtp.findOne({ email, purpose, expires_at: { $gt: new Date() } });
    return stale ? 'locked' : 'expired';
  }

  const expected = Buffer.from(doc.code_hash, 'hex');
  const actual = hashCode(email, purpose, code);
  const match = expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
  return match ? 'ok' : 'invalid';
};

export const clearOtp = async (email: string, purpose: OtpPurpose): Promise<void> => {
  await EmailOtp.deleteOne({ email, purpose });
};

export const otpErrorMessage = (result: Exclude<OtpCheck, 'ok'>): string => {
  switch (result) {
    case 'invalid':
      return 'Invalid verification code. Please try again.';
    case 'locked':
      return 'Too many incorrect attempts. Please request a new code.';
    default:
      return 'Verification code expired. Please request a new one.';
  }
};
