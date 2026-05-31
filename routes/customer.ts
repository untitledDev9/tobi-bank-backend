import { Router } from 'express';
import { body } from 'express-validator';
import protect from '../middleware/protect';
import * as ctrl from '../controllers/customerController';

const router = Router();

router.use(protect);

router.get('/me', ctrl.getMe);
router.get('/transactions', ctrl.getTransactions);
router.post(
  '/withdraw',
  [
    body('amount').isFloat({ gt: 0 }).withMessage('Amount must be a positive number'),
    body('method').isIn(['bank', 'card']).withMessage('A withdrawal method is required'),
    body('bank_name')
      .if(body('method').equals('bank'))
      .trim().notEmpty().withMessage('Destination bank is required'),
    body('account_number')
      .if(body('method').equals('bank'))
      .trim().notEmpty().withMessage('Destination account number is required'),
    body('routing_number')
      .if(body('method').equals('bank'))
      .trim().matches(/^\d{9}$/).withMessage('Routing number must be 9 digits'),
    body('card_number')
      .if(body('method').equals('card'))
      .trim().matches(/^\d{13,19}$/).withMessage('A valid card number is required'),
    body('card_expiry')
      .if(body('method').equals('card'))
      .trim().matches(/^(0[1-9]|1[0-2])\/\d{2}$/).withMessage('Expiry must be in MM/YY format'),
    body('card_name')
      .if(body('method').equals('card'))
      .trim().notEmpty().withMessage('Name on card is required'),
  ],
  ctrl.withdraw
);

router.patch(
  '/profile',
  [
    body('full_name').optional().trim().notEmpty().withMessage('Name cannot be empty'),
    body('email').optional().isEmail().normalizeEmail().withMessage('Valid email required'),
    body('phone').optional().trim(),
  ],
  ctrl.updateProfile
);

router.post(
  '/change-password',
  [
    body('current_password').notEmpty().withMessage('Current password is required'),
    body('new_password').isLength({ min: 8 }).withMessage('New password must be at least 8 characters'),
  ],
  ctrl.changePassword
);

router.post(
  '/transfer',
  [
    body('recipient_id').trim().notEmpty().withMessage('Account number or email is required'),
    body('amount').isFloat({ gt: 0 }).withMessage('Amount must be positive'),
    body('description').optional().trim(),
  ],
  ctrl.transfer
);

router.get('/lookup-account/:recipient_id', ctrl.lookupAccount);

export default router;
