import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import User, { IUser } from '../models/User';

export interface AuthRequest extends Request {
  user?: IUser;
}

// The client signs the user out only on this code. Other 401s (wrong PIN, wrong password...)
// are ordinary errors the user should see without losing their session.
const sessionExpired = (res: Response, message: string): void => {
  res.status(401).json({ success: false, code: 'SESSION_EXPIRED', message });
};

const protect = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const authHeader = req.headers.authorization;
    const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;

    if (!token) {
      sessionExpired(res, 'Not authorized. Please log in.');
      return;
    }

    let decoded: { id: string; role: string };
    try {
      decoded = jwt.verify(token, process.env.JWT_SECRET as string) as { id: string; role: string };
    } catch {
      sessionExpired(res, 'Invalid or expired token.');
      return;
    }

    const user = await User.findById(decoded.id);

    if (!user) {
      sessionExpired(res, 'User no longer exists.');
      return;
    }

    if (!user.is_active) {
      sessionExpired(res, 'Account has been deactivated.');
      return;
    }

    req.user = user;
    next();
  } catch (error) {
    // A database or server failure is not a bad session; let it surface as a 500.
    next(error);
  }
};

export default protect;
