import User, { IUser } from '../../src/models/User.model';
import TrustedContact from '../../src/models/TrustedContact.model';

let seq = 0;

/**
 * Create an active User. The returned user's `firebaseUid` doubles as the bearer
 * token to send (the mocked verifyIdToken maps token -> uid). Use authHeader()
 * to build the matching Authorization header.
 */
export const createUser = async (overrides: Partial<Record<string, unknown>> = {}): Promise<IUser> => {
  seq += 1;
  return User.create({
    firebaseUid: `uid-${seq}`,
    name: `User ${seq}`,
    email: `user${seq}@test.com`,
    phone: `+100000000${seq}`,
    ...overrides,
  });
};

/** Bearer header whose token is the user's firebaseUid (see mocked verifyIdToken). */
export const authHeader = (user: IUser): string => `Bearer ${user.firebaseUid}`;

/** Seed an active trusted contact for a user. */
export const createContact = async (
  user: IUser,
  overrides: Partial<Record<string, unknown>> = {}
) => {
  seq += 1;
  return TrustedContact.create({
    userId: user._id,
    name: `Contact ${seq}`,
    phone: `+120000000${seq}`,
    relationship: 'friend',
    status: 'active',
    ...overrides,
  });
};
