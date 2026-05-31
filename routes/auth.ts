import { Router } from 'express';
import { body } from 'express-validator';
import { authLimiter } from '../middleware/rateLimiter';
import protect from '../middleware/protect';
import * as ctrl from '../controllers/authController';

const router = Router();

const loginValidation = [
  body('email').isEmail().normalizeEmail().withMessage('Valid email is required'),
  body('password').notEmpty().withMessage('Password is required'),
];

const registerValidation = [
  body('full_name').notEmpty().withMessage('Full name is required'),
  body('email').isEmail().normalizeEmail().withMessage('Valid email is required'),
  body('password').isLength({ min: 8 }).withMessage('Password must be at least 8 characters'),
  body('ssn').notEmpty().withMessage('SSN is required'),
  body('id_type').isIn(['id_card', 'drivers_license']).withMessage('Valid ID type is required'),
  body('id_document').notEmpty().withMessage('ID document is required'),
  body('utility_bill').notEmpty().withMessage('Proof of address is required'),
  body('face_photo').notEmpty().withMessage('Face verification photo is required'),
];

router.post('/register', authLimiter, registerValidation, ctrl.register);
router.post('/login', authLimiter, loginValidation, ctrl.login);
router.post('/verify-otp', authLimiter, ctrl.verifyOtp);
router.post('/resend-otp', authLimiter, ctrl.resendOtp);
router.post('/verify-pin', authLimiter, ctrl.verifyPin);
router.post('/admin/login', authLimiter, loginValidation, ctrl.adminLogin);
router.post('/logout', ctrl.logout);
router.get('/me', protect, ctrl.getMe);
router.post('/forgot-password', authLimiter, body('email').isEmail(), ctrl.forgotPassword);
router.post('/reset-password/:token', body('password').isLength({ min: 8 }), ctrl.resetPassword);

export default router;
