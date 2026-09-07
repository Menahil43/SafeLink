import { Request, Response, NextFunction } from 'express';
import { verifyIdToken } from '../services/firebase.service';
import User, { IUser } from '../models/User.model';
import { logger } from '../utils/logger';

export interface AuthRequest extends Request {
  user?: IUser;
  firebaseUid?: string;
}

export const verifyFirebaseToken = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      res.status(401).json({ error: 'Missing or invalid authorization header' });
      return;
    }

    const idToken = authHeader.split('Bearer ')[1];
    if (!idToken) {
      res.status(401).json({ error: 'No token provided' });
      return;
    }

    const decodedToken = await verifyIdToken(idToken);
    req.firebaseUid = decodedToken.uid;

    const user = await User.findOne({ firebaseUid: decodedToken.uid, accountStatus: 'active' });
    if (!user) {
      res.status(404).json({ error: 'User account not found. Please register first.' });
      return;
    }

    req.user = user;
    next();
  } catch (error: unknown) {
    logger.warn('Token verification failed:', error);
    const message = error instanceof Error ? error.message : 'Invalid token';
    if (message.includes('expired')) {
      res.status(401).json({ error: 'Token expired. Please log in again.' });
    } else {
      res.status(401).json({ error: 'Unauthorized' });
    }
  }
};
