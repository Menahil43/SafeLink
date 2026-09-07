import React, { useState, useEffect } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ScrollView,
  TextInput, Alert, Modal, KeyboardAvoidingView, Platform, ActivityIndicator, RefreshControl,
} from 'react-native';
import { useStore, TrustedContact } from '../store';
import { Colors, Spacing, BorderRadius, Shadows } from '../theme';
import { loadContacts, createContact, deleteContact } from '../services/contacts.service';

const getInitials = (name: string) => name.split(' ').map((w) => w[0]).join('').toUpperCase().slice(0, 2);
const RELATIONSHIPS = ['Family', 'Friend', 'Partner', 'Sibling', 'Colleague', 'Other'];

export default function ContactsScreen() {
  const { contacts } = useStore();
  const [showAdd, setShowAdd] = useState(false);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [relationship, setRelationship] = useState('Family');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const refresh = async (initial = false) => {
    if (!initial) setRefreshing(true);
    try {
      await loadContacts();
    } catch (e) {
      Alert.alert('Could not load contacts', (e as Error).message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => { void refresh(true); }, []);

  const resetForm = () => { setName(''); setPhone(''); setEmail(''); setRelationship('Family'); };

  const handleAdd = async () => {
    if (!name.trim() || name.trim().length < 2) {
      Alert.alert('Missing info', 'Please enter a name (at least 2 characters).');
      return;
    }
    if (!phone.trim() || phone.trim().length < 10) {
      Alert.alert('Missing info', 'Please enter a valid phone number (at least 10 digits).');
      return;
    }
    setSubmitting(true);
    try {
      await createContact({
        name: name.trim(),
        phone: phone.trim(),
        email: email.trim() || undefined,
        relationship,
      });
      resetForm();
      setShowAdd(false);
    } catch (e) {
      Alert.alert('Could not add contact', (e as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = (contact: TrustedContact) => {
    Alert.alert('Remove contact', `Remove ${contact.name} from trusted contacts?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: async () => {
          try {
            await deleteContact(contact.id);
          } catch (e) {
            Alert.alert('Could not remove contact', (e as Error).message);
          }
        },
      },
    ]);
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Trusted Contacts</Text>
        <Text style={styles.subtitle}>People who get alerted during emergencies</Text>
      </View>

      <TouchableOpacity style={styles.addBtn} onPress={() => setShowAdd(true)}>
        <Text style={styles.addBtnIcon}>+</Text>
        <Text style={styles.addBtnText}>Add Contact</Text>
      </TouchableOpacity>

      {loading ? (
        <View style={styles.empty}><ActivityIndicator color={Colors.primary} size="large" /></View>
      ) : (
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.list}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => refresh()} tintColor={Colors.primary} />}
        >
          {contacts.length === 0 && (
            <View style={styles.empty}>
              <Text style={styles.emptyIcon}>👥</Text>
              <Text style={styles.emptyTitle}>No contacts yet</Text>
              <Text style={styles.emptyDesc}>Add trusted people who will be notified when you activate SOS.</Text>
            </View>
          )}
          {contacts.map((c: TrustedContact) => (
            <View key={c.id} style={styles.card}>
              <View style={[styles.avatar, { backgroundColor: c.avatarColor }]}>
                <Text style={styles.avatarText}>{getInitials(c.name)}</Text>
              </View>
              <View style={styles.cardInfo}>
                <Text style={styles.cardName}>{c.name}</Text>
                <Text style={styles.cardPhone}>{c.phone}</Text>
                <View style={styles.badge}><Text style={styles.badgeText}>{c.relationship}</Text></View>
              </View>
              <TouchableOpacity style={styles.deleteBtn} onPress={() => handleDelete(c)}>
                <Text style={styles.deleteBtnText}>✕</Text>
              </TouchableOpacity>
            </View>
          ))}
        </ScrollView>
      )}

      <Modal visible={showAdd} animationType="slide" transparent onRequestClose={() => setShowAdd(false)}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Add Trusted Contact</Text>

            <Text style={styles.inputLabel}>Name</Text>
            <TextInput style={styles.input} value={name} onChangeText={setName} placeholder="Full name" placeholderTextColor={Colors.textMuted} autoCapitalize="words" />

            <Text style={styles.inputLabel}>Phone</Text>
            <TextInput style={styles.input} value={phone} onChangeText={setPhone} placeholder="+92 300 1234567" placeholderTextColor={Colors.textMuted} keyboardType="phone-pad" />

            <Text style={styles.inputLabel}>Email (optional)</Text>
            <TextInput style={styles.input} value={email} onChangeText={setEmail} placeholder="contact@example.com" placeholderTextColor={Colors.textMuted} keyboardType="email-address" autoCapitalize="none" autoCorrect={false} />

            <Text style={styles.inputLabel}>Relationship</Text>
            <View style={styles.relRow}>
              {RELATIONSHIPS.map((r: string) => (
                <TouchableOpacity key={r} style={[styles.relChip, relationship === r && styles.relChipActive]} onPress={() => setRelationship(r)}>
                  <Text style={[styles.relChipText, relationship === r && styles.relChipTextActive]}>{r}</Text>
                </TouchableOpacity>
              ))}
            </View>

            <View style={styles.modalActions}>
              <TouchableOpacity style={styles.cancelBtn} onPress={() => setShowAdd(false)} disabled={submitting}>
                <Text style={styles.cancelBtnText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.saveBtn, submitting && styles.saveBtnDisabled]} onPress={handleAdd} disabled={submitting}>
                {submitting ? <ActivityIndicator color="#fff" /> : <Text style={styles.saveBtnText}>Add Contact</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  header: { paddingTop: 20, paddingHorizontal: Spacing.base, paddingBottom: Spacing.sm },
  title: { fontSize: 24, fontWeight: '700', color: Colors.textPrimary },
  subtitle: { fontSize: 13, color: Colors.textSecondary, marginTop: 4 },

  addBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    marginHorizontal: Spacing.base, marginVertical: Spacing.md, padding: 14,
    backgroundColor: Colors.primarySurface, borderRadius: BorderRadius.md, borderWidth: 1, borderColor: Colors.primary + '30',
  },
  addBtnIcon: { fontSize: 20, color: Colors.primary, fontWeight: '600', marginRight: 8 },
  addBtnText: { fontSize: 15, fontWeight: '600', color: Colors.primary },

  list: { paddingHorizontal: Spacing.base, paddingBottom: 100 },
  empty: { alignItems: 'center', paddingVertical: 60 },
  emptyIcon: { fontSize: 48, marginBottom: 12 },
  emptyTitle: { fontSize: 18, fontWeight: '600', color: Colors.textPrimary },
  emptyDesc: { fontSize: 14, color: Colors.textSecondary, textAlign: 'center', marginTop: 8, paddingHorizontal: 30 },

  card: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: Colors.surfaceCard,
    padding: Spacing.base, borderRadius: BorderRadius.lg, marginBottom: 10, ...Shadows.sm,
  },
  avatar: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: '#fff', fontWeight: '700', fontSize: 16 },
  cardInfo: { flex: 1, marginLeft: 12 },
  cardName: { fontSize: 16, fontWeight: '600', color: Colors.textPrimary },
  cardPhone: { fontSize: 13, color: Colors.textSecondary, marginTop: 2 },
  badge: { backgroundColor: Colors.primarySurface, paddingHorizontal: 8, paddingVertical: 2, borderRadius: 10, alignSelf: 'flex-start', marginTop: 4 },
  badgeText: { fontSize: 11, color: Colors.primary, fontWeight: '600' },
  deleteBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: Colors.sosLight, alignItems: 'center', justifyContent: 'center' },
  deleteBtnText: { color: Colors.sos, fontSize: 14, fontWeight: '600' },

  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  modalContent: { backgroundColor: '#fff', borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: Spacing.xl, paddingBottom: 40 },
  modalTitle: { fontSize: 20, fontWeight: '700', color: Colors.textPrimary, marginBottom: Spacing.lg },
  inputLabel: { fontSize: 13, fontWeight: '600', color: Colors.textSecondary, marginBottom: 6, marginTop: Spacing.sm },
  input: { backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.border, borderRadius: BorderRadius.sm, padding: 14, fontSize: 15, color: Colors.textPrimary },
  relRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 4 },
  relChip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.border },
  relChipActive: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  relChipText: { fontSize: 13, color: Colors.textSecondary, fontWeight: '500' },
  relChipTextActive: { color: '#fff' },
  modalActions: { flexDirection: 'row', gap: 12, marginTop: Spacing.xl },
  cancelBtn: { flex: 1, paddingVertical: 14, borderRadius: BorderRadius.md, backgroundColor: Colors.surface, alignItems: 'center' },
  cancelBtnText: { fontSize: 15, fontWeight: '600', color: Colors.textSecondary },
  saveBtn: { flex: 1, paddingVertical: 14, borderRadius: BorderRadius.md, backgroundColor: Colors.primary, alignItems: 'center' },
  saveBtnDisabled: { opacity: 0.7 },
  saveBtnText: { fontSize: 15, fontWeight: '600', color: '#fff' },
});
