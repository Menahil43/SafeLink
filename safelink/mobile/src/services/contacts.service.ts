import { contactsAPI } from './api';
import { useStore, TrustedContact } from '../store';
import { Colors } from '../theme';

/**
 * Trusted-contact data access. The backend stores contacts as raw Mongoose docs
 * (`_id`, not `id`), so every contact crossing into the app is normalized here and
 * written to the zustand store. Screens call these instead of touching the API
 * directly, so contact shape/mapping lives in exactly one place.
 */

const AVATAR_POOL = Colors.avatarColors;

/** Normalize a backend contact doc into the store's TrustedContact shape. */
export const mapContact = (raw: any, index = 0): TrustedContact => ({
  id: raw.id ?? raw._id,
  name: raw.name,
  phone: raw.phone,
  email: raw.email || undefined,
  relationship: raw.relationship,
  priority: raw.priority ?? index + 1,
  status: raw.status === 'inactive' ? 'inactive' : 'active',
  avatarColor: raw.avatarColor || AVATAR_POOL[index % AVATAR_POOL.length],
});

/** Fetch all contacts from the backend and put them in the store. */
export const loadContacts = async (): Promise<TrustedContact[]> => {
  const { data } = await contactsAPI.getAll();
  const list: TrustedContact[] = (data.contacts || []).map((c: any, i: number) => mapContact(c, i));
  useStore.getState().setContacts(list);
  return list;
};

/** Create a contact on the backend, then add the normalized result to the store. */
export const createContact = async (input: {
  name: string;
  phone: string;
  email?: string;
  relationship: string;
}): Promise<TrustedContact> => {
  const count = useStore.getState().contacts.length;
  const { data } = await contactsAPI.create(input);
  const contact = mapContact(data.contact, count);
  useStore.getState().addContact(contact);
  return contact;
};

/** Delete a contact on the backend, then remove it from the store. */
export const deleteContact = async (id: string): Promise<void> => {
  await contactsAPI.delete(id);
  useStore.getState().removeContact(id);
};
