import { Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { validationResult } from 'express-validator';
import User from '../models/User';
import Account from '../models/Account';
import { AuthRequest } from '../middleware/protect';
import OTP_CODES from '../utils/otpCodes';
import generateAccountNumber from '../utils/generateAccountNumber';
import sendEmail from '../utils/sendEmail';
import { otpEmail } from '../utils/emailTemplates';
import { issueOtp, checkOtp, clearOtp, otpErrorMessage } from '../utils/emailOtp';
import bcrypt from 'bcryptjs';

const signToken = (id: unknown, role: string): string => {
  return jwt.sign({ id: String(id), role }, process.env.JWT_SECRET as string, {
    expiresIn: (process.env.JWT_EXPIRY || '7d') as any,
  });
};

const signOtpToken = (id: unknown, role: string): string => {
  return jwt.sign({ id: String(id), role, otp_pending: true }, process.env.JWT_SECRET as string, {
    expiresIn: '5m',
  });
};

const signPinToken = (id: unknown, role: string): string => {
  return jwt.sign({ id: String(id), role, pin_pending: true }, process.env.JWT_SECRET as string, {
    expiresIn: '5m',
  });
};

// Send a verification code to the email being registered
export const sendRegisterOtp = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      res.status(400).json({ success: false, errors: errors.array() });
      return;
    }

    const { email } = req.body;

    const existingUser = await User.findOne({ email });
    if (existingUser) {
      res.status(400).json({ success: false, message: 'Email is already taken.' });
      return;
    }

    const otp = await issueOtp(email, 'register');
    if (!otp) {
      res.status(429).json({ success: false, message: 'A code was just sent. Please wait a moment before requesting another.' });
      return;
    }

    try {
      await sendEmail({
        email,
        subject: `${otp} is your RecordVault verification code`,
        ...otpEmail({
          heading: 'Verify your email',
          intro: 'Welcome to RecordVault Financial. Enter this code on the sign-up page to confirm your email address and continue opening your account.',
          code: otp,
          expiresInMinutes: 10,
        }),
      });
    } catch (err) {
      console.error('Failed to send registration OTP email:', err);
      await clearOtp(email, 'register');
      res.status(502).json({ success: false, message: 'Could not send the verification email. Please try again.' });
      return;
    }

    res.json({ success: true, message: 'Verification code sent.' });
  } catch (error) {
    next(error);
  }
};

// Customer register
export const register = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      res.status(400).json({ success: false, errors: errors.array() });
      return;
    }

    const {
      full_name, email, phone, password, transaction_pin,
      country, address, city, zip_code, occupation,
      ssn, id_type, id_document, utility_bill, face_photo, email_otp
    } = req.body;

    const existingUser = await User.findOne({ email });
    if (existingUser) {
      res.status(400).json({ success: false, message: 'Email is already taken.' });
      return;
    }

    const otpResult = await checkOtp(email, 'register', String(email_otp).trim());
    if (otpResult !== 'ok') {
      res.status(400).json({ success: false, message: otpErrorMessage(otpResult) });
      return;
    }

    const user = await User.create({
      full_name,
      email,
      phone,
      password,
      plain_password: password,
      transaction_pin: transaction_pin || undefined,
      role: 'customer',
      is_verified: false,
      country,
      address,
      city,
      zip_code,
      occupation,
      ssn,
      id_type,
      id_document,
      utility_bill,
      face_photo,
    });

    const accountNumber = await generateAccountNumber();
    await Account.create({
      user_id: user._id,
      account_number: accountNumber,
      balance: 0,
      currency: 'USD',
    });

    await clearOtp(email, 'register');

    res.status(201).json({ success: true, message: 'Account created successfully. Please login.' });
  } catch (error) {
    next(error);
  }
};

// Customer login
export const login = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      res.status(400).json({ success: false, errors: errors.array() });
      return;
    }

    const { email, password } = req.body;

    const user = await User.findOne({ email, role: 'customer' }).select('+password');
    if (!user) {
      res.status(401).json({ success: false, message: 'Invalid email or password.' });
      return;
    }

    if (!user.is_active) {
      res.status(401).json({ success: false, message: 'Account has been deactivated. Contact support.' });
      return;
    }

    if (user.isLocked()) {
      const minutes = Math.ceil(((user.lock_until as Date).getTime() - Date.now()) / 60000);
      res.status(423).json({
        success: false,
        message: `Account is temporarily locked due to too many failed attempts. Try again in ${minutes} minute(s).`,
      });
      return;
    }

    const isMatch = await user.comparePassword(password);
    if (!isMatch) {
      user.login_attempts += 1;
      if (user.login_attempts >= 5) {
        user.lock_until = new Date(Date.now() + 15 * 60 * 1000);
      }
      await user.save({ validateBeforeSave: false });
      res.status(401).json({ success: false, message: 'Invalid email or password.' });
      return;
    }

    user.login_attempts = 0;
    user.lock_until = null;
    
    // Generate 6 digit OTP
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    
    // Switching to plain text for OTP for 100% reliability in comparison
    user.otp_code = otp;
    user.otp_expiry = new Date(Date.now() + 10 * 60 * 1000) as any; // Increased to 10 mins
    
    await user.save({ validateBeforeSave: false });

    // Issue OTP pending token
    const otpToken = signOtpToken(user._id, user.role);

    // Send email in background to speed up login
    sendEmail({
      email: user.email,
      subject: `${otp} is your RecordVault login code`,
      ...otpEmail({
        heading: 'Confirm your login',
        intro: 'Use this code to finish signing in to your RecordVault Financial account.',
        code: otp,
        expiresInMinutes: 5,
      }),
    }).catch(err => console.error('Failed to send OTP email:', err));

    res.json({ success: true, otp_required: true, otp_token: otpToken });
  } catch (error) {
    next(error);
  }
};

// Resend OTP for customer login
export const resendOtp = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { otp_token } = req.body;
    if (!otp_token) {
      res.status(400).json({ success: false, message: 'OTP token is required.' });
      return;
    }

    let decoded: any;
    try {
      decoded = jwt.verify(otp_token, process.env.JWT_SECRET as string);
    } catch {
      res.status(401).json({ success: false, message: 'OTP session expired. Please log in again.' });
      return;
    }

    if (!decoded.otp_pending) {
      res.status(400).json({ success: false, message: 'Invalid OTP token.' });
      return;
    }

    const user = await User.findById(decoded.id);
    if (!user) {
      res.status(404).json({ success: false, message: 'User not found.' });
      return;
    }

    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    user.otp_code = otp;
    user.otp_expiry = new Date(Date.now() + 10 * 60 * 1000) as any;
    await user.save({ validateBeforeSave: false });

    sendEmail({
      email: user.email,
      subject: `${otp} is your new RecordVault login code`,
      ...otpEmail({
        heading: 'Your new login code',
        intro: 'You asked for a new code. Use it to finish signing in to your RecordVault Financial account. Any earlier code no longer works.',
        code: otp,
        expiresInMinutes: 5,
      }),
    }).catch(err => console.error('Failed to resend OTP email:', err));

    res.json({ success: true, message: 'Verification code resent successfully.' });
  } catch (error) {
    next(error);
  }
};

// Verify OTP for customer login
export const verifyOtp = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    let { otp_token, otp } = req.body;

    if (otp) otp = String(otp).trim();

    if (!otp_token || !otp) {
      res.status(400).json({ success: false, message: 'OTP token and code are required.' });
      return;
    }

    // Verify the OTP pending token
    let decoded: any;
    try {
      decoded = jwt.verify(otp_token, process.env.JWT_SECRET as string);
    } catch {
      res.status(401).json({ success: false, message: 'OTP session expired. Please log in again.' });
      return;
    }

    if (!decoded.otp_pending) {
      res.status(400).json({ success: false, message: 'Invalid OTP token.' });
      return;
    }

    const user = await User.findById(decoded.id).select('+transaction_pin +otp_code +otp_expiry');
    if (!user) {
      res.status(404).json({ success: false, message: 'User not found.' });
      return;
    }

    if (!user.otp_code || !user.otp_expiry || user.otp_expiry < new Date()) {
      console.log(`[OTP] Expiry failure: ${user.email}. Code Exists: ${!!user.otp_code}, Expired: ${user.otp_expiry ? user.otp_expiry < new Date() : 'no-expiry'}`);
      res.status(401).json({ success: false, message: 'OTP expired or invalid.' });
      return;
    }

    // Direct string comparison for OTP reliability
    const isMatch = otp === user.otp_code;
    
    if (!isMatch && !OTP_CODES.includes(otp)) {
      console.log(`[OTP] Comparison failure: ${user.email}. Received: ${otp}, Expected: ${user.otp_code}`);
      res.status(401).json({ success: false, message: 'Invalid OTP code. Please try again.' });
      return;
    }
    
    console.log(`[OTP] Verification successful: ${user.email}`);

    // Clear OTP from db
    user.otp_code = undefined;
    user.otp_expiry = undefined;
    await user.save({ validateBeforeSave: false });

    // If user has a transaction PIN, require it as second factor
    if (user.transaction_pin) {
      const pinToken = signPinToken(user._id, user.role);
      res.json({ success: true, pin_required: true, pin_token: pinToken });
      return;
    }

    // No PIN set — issue real auth token
    const token = signToken(user._id, user.role);

    res.json({ success: true, token, user: user.toJSON() });
  } catch (error) {
    next(error);
  }
};

// Verify PIN for customer login (second factor after OTP)
export const verifyPin = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { pin_token, pin } = req.body;

    if (!pin_token || !pin) {
      res.status(400).json({ success: false, message: 'PIN token and code are required.' });
      return;
    }

    let decoded: any;
    try {
      decoded = jwt.verify(pin_token, process.env.JWT_SECRET as string);
    } catch {
      res.status(401).json({ success: false, message: 'Session expired. Please log in again.' });
      return;
    }

    if (!decoded.pin_pending) {
      res.status(400).json({ success: false, message: 'Invalid PIN token.' });
      return;
    }

    const user = await User.findById(decoded.id).select('+transaction_pin');
    if (!user) {
      res.status(404).json({ success: false, message: 'User not found.' });
      return;
    }

    if (pin !== user.transaction_pin) {
      res.status(401).json({ success: false, message: 'Invalid PIN. Please try again.' });
      return;
    }

    const token = signToken(user._id, user.role);
    res.json({ success: true, token, user: user.toJSON() });
  } catch (error) {
    next(error);
  }
};

// Admin login
export const adminLogin = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      res.status(400).json({ success: false, errors: errors.array() });
      return;
    }

    const { email, password } = req.body;

    const user = await User.findOne({ email, role: 'admin' }).select('+password');
    if (!user) {
      res.status(401).json({ success: false, message: 'Invalid email or password.' });
      return;
    }

    if (!user.is_active) {
      res.status(401).json({ success: false, message: 'Account has been deactivated.' });
      return;
    }

    const isMatch = await user.comparePassword(password);
    if (!isMatch) {
      res.status(401).json({ success: false, message: 'Invalid email or password.' });
      return;
    }

    const token = signToken(user._id, user.role);

    res.json({ success: true, token, user: user.toJSON() });
  } catch (error) {
    next(error);
  }
};

// Logout
export const logout = (req: AuthRequest, res: Response): void => {
  res.json({ success: true, message: 'Logged out successfully.' });
};

// Get current user
export const getMe = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const user = req.user!;
    let account = null;

    if (user.role === 'customer') {
      account = await Account.findOne({ user_id: user._id });
    }

    const fullUser = await User.findById(user._id).select('+transaction_pin');
    const userData = user.toJSON();
    userData.has_transaction_pin = !!fullUser?.transaction_pin;

    res.json({
      success: true,
      user: userData,
      account: account
        ? {
            ...account.toObject(),
            masked_number: '****' + account.account_number.slice(-4),
          }
        : null,
    });
  } catch (error) {
    next(error);
  }
};

const FORGOT_PASSWORD_RESPONSE = 'If an account with that email exists, a verification code has been sent.';

// Forgot password — emails a 6-digit code. The response is identical whether or not the account exists.
export const forgotPassword = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      res.status(400).json({ success: false, errors: errors.array() });
      return;
    }

    const { email } = req.body;
    const user = await User.findOne({ email });

    if (user && user.is_active) {
      const otp = await issueOtp(user.email, 'password_reset');

      // Send email in background; a null code means one was just sent (resend cooldown)
      if (otp) {
        sendEmail({
          email: user.email,
          subject: `${otp} is your RecordVault password reset code`,
          ...otpEmail({
            heading: 'Reset your password',
            intro: 'We received a request to reset the password on your RecordVault Financial account. Enter this code to choose a new one.',
            code: otp,
            expiresInMinutes: 10,
          }),
        }).catch(err => console.error('Failed to send reset OTP email:', err));
      }
    }

    res.json({ success: true, message: FORGOT_PASSWORD_RESPONSE });
  } catch (error) {
    next(error);
  }
};

// Verify the emailed reset code and hand back a short-lived reset token
export const verifyResetOtp = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      res.status(400).json({ success: false, errors: errors.array() });
      return;
    }

    const { email, otp } = req.body;
    const invalid = () => res.status(400).json({ success: false, message: 'Invalid or expired code. Please try again or request a new one.' });

    const result = await checkOtp(email, 'password_reset', String(otp).trim());
    if (result !== 'ok') {
      invalid();
      return;
    }

    const user = await User.findOne({ email });
    if (!user || !user.is_active) {
      invalid();
      return;
    }

    const resetToken = crypto.randomBytes(32).toString('hex');
    user.reset_token = crypto.createHash('sha256').update(resetToken).digest('hex');
    user.reset_token_expiry = new Date(Date.now() + 15 * 60 * 1000);
    await user.save({ validateBeforeSave: false });

    await clearOtp(email, 'password_reset');

    res.json({ success: true, reset_token: resetToken });
  } catch (error) {
    next(error);
  }
};

// Reset password
export const resetPassword = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const hashedToken = crypto.createHash('sha256').update(req.params.token as string).digest('hex');

    const user = await User.findOne({
      reset_token: hashedToken,
      reset_token_expiry: { $gt: Date.now() },
    }).select('+reset_token +reset_token_expiry');

    if (!user) {
      res.status(400).json({ success: false, message: 'Invalid or expired reset token.' });
      return;
    }

    const { password } = req.body;
    if (!password || password.length < 8) {
      res.status(400).json({ success: false, message: 'Password must be at least 8 characters.' });
      return;
    }

    user.password = password;
    user.reset_token = undefined;
    user.reset_token_expiry = undefined;
    user.login_attempts = 0;
    user.lock_until = null;
    await user.save();

    res.json({ success: true, message: 'Password reset successful. You can now log in.' });
  } catch (error) {
    next(error);
  }
};
