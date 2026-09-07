import React, { useState } from 'react';
import {
  View, Text, StyleSheet, TextInput, TouchableOpacity, ScrollView,
  KeyboardAvoidingView, Platform, ActivityIndicator, Alert,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { Colors, Spacing, BorderRadius, Shadows } from '../theme';
import { firebaseConfigError } from '../config/firebase';
import {
  signInWithEmail, registerWithEmail, sendReset, mapFirebaseError,
} from '../services/auth.service';
import { hydrateSession, registerBackendUser } from '../services/session.service';
import { emergencyEngine } from '../emergency/EmergencyEngine';

type Mode = 'login' | 'register';

export default function AuthScreen() {
  const [mode, setMode] = useState<Mode>('login');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const configError = firebaseConfigError;

  const submit = async () => {
    setError(null);
    if (!email.trim() || !password) {
      setError('Please enter your email and password.');
      return;
    }
    if (mode === 'register' && (!name.trim() || !phone.trim())) {
      setError('Please enter your name and phone number.');
      return;
    }
    setLoading(true);
    try {
      if (mode === 'register') {
        await registerWithEmail(email, password, name.trim());
        await registerBackendUser({ name: name.trim(), email: email.trim(), phone: phone.trim() });
      } else {
        await signInWithEmail(email, password);
        await hydrateSession();
      }
      // Session is set in the store; resume any emergency that's still open server-side.
      await emergencyEngine.restore();
    } catch (err) {
      setError(mapFirebaseError(err));
    } finally {
      setLoading(false);
    }
  };

  const forgotPassword = async () => {
    if (!email.trim()) {
      setError('Enter your email above first, then tap Forgot password.');
      return;
    }
    try {
      await sendReset(email);
      Alert.alert('Check your email', 'If an account exists, a password reset link has been sent.');
    } catch (err) {
      setError(mapFirebaseError(err));
    }
  };

  if (configError) {
    return (
      <View style={styles.configContainer}>
        <StatusBar style="dark" />
        <Text style={styles.logo}>SafeLink</Text>
        <View style={styles.configCard}>
          <Text style={styles.configTitle}>Configuration needed</Text>
          <Text style={styles.configText}>{configError}</Text>
        </View>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <StatusBar style="dark" />
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <View style={styles.brand}>
          <View style={styles.brandIcon}><Text style={styles.brandIconText}>🛡</Text></View>
          <Text style={styles.logo}>SafeLink</Text>
          <Text style={styles.tagline}>
            {mode === 'login' ? 'Welcome back — stay safe.' : 'Create your safety account.'}
          </Text>
        </View>

        {error && (
          <View style={styles.errorBox}>
            <Text style={styles.errorText}>{error}</Text>
          </View>
        )}

        {mode === 'register' && (
          <>
            <Text style={styles.label}>Full name</Text>
            <TextInput style={styles.input} value={name} onChangeText={setName}
              placeholder="Your name" placeholderTextColor={Colors.textMuted} autoCapitalize="words" />
          </>
        )}

        <Text style={styles.label}>Email</Text>
        <TextInput style={styles.input} value={email} onChangeText={setEmail}
          placeholder="you@example.com" placeholderTextColor={Colors.textMuted}
          keyboardType="email-address" autoCapitalize="none" autoCorrect={false} />

        {mode === 'register' && (
          <>
            <Text style={styles.label}>Phone</Text>
            <TextInput style={styles.input} value={phone} onChangeText={setPhone}
              placeholder="+92 300 1234567" placeholderTextColor={Colors.textMuted} keyboardType="phone-pad" />
          </>
        )}

        <Text style={styles.label}>Password</Text>
        <TextInput style={styles.input} value={password} onChangeText={setPassword}
          placeholder="••••••••" placeholderTextColor={Colors.textMuted} secureTextEntry />

        {mode === 'login' && (
          <TouchableOpacity onPress={forgotPassword} disabled={loading}>
            <Text style={styles.forgot}>Forgot password?</Text>
          </TouchableOpacity>
        )}

        <TouchableOpacity style={[styles.submitBtn, loading && styles.submitBtnDisabled]}
          onPress={submit} disabled={loading} activeOpacity={0.85}>
          {loading
            ? <ActivityIndicator color="#fff" />
            : <Text style={styles.submitText}>{mode === 'login' ? 'Sign In' : 'Create Account'}</Text>}
        </TouchableOpacity>

        <View style={styles.switchRow}>
          <Text style={styles.switchText}>
            {mode === 'login' ? "Don't have an account?" : 'Already have an account?'}
          </Text>
          <TouchableOpacity
            onPress={() => { setMode(mode === 'login' ? 'register' : 'login'); setError(null); }}
            disabled={loading}
          >
            <Text style={styles.switchLink}>{mode === 'login' ? 'Sign up' : 'Sign in'}</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

// AUTHSCREEN_STYLES
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  scroll: { padding: Spacing.xl, paddingTop: 80, flexGrow: 1, justifyContent: 'center' },

  brand: { alignItems: 'center', marginBottom: Spacing.xxl },
  brandIcon: {
    width: 72, height: 72, borderRadius: 36, backgroundColor: Colors.primarySurface,
    alignItems: 'center', justifyContent: 'center', marginBottom: 12,
  },
  brandIconText: { fontSize: 34 },
  logo: { fontSize: 32, fontWeight: '800', color: Colors.primary, letterSpacing: 0.5 },
  tagline: { fontSize: 14, color: Colors.textSecondary, marginTop: 6 },

  label: { fontSize: 13, fontWeight: '600', color: Colors.textSecondary, marginBottom: 6, marginTop: Spacing.md },
  input: {
    backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.border,
    borderRadius: BorderRadius.md, padding: 14, fontSize: 15, color: Colors.textPrimary,
  },
  forgot: { color: Colors.primary, fontSize: 13, fontWeight: '600', textAlign: 'right', marginTop: 10 },

  submitBtn: {
    backgroundColor: Colors.primary, paddingVertical: 16, borderRadius: BorderRadius.md,
    alignItems: 'center', marginTop: Spacing.xl, ...Shadows.md,
  },
  submitBtnDisabled: { opacity: 0.7 },
  submitText: { color: '#fff', fontSize: 16, fontWeight: '700' },

  switchRow: { flexDirection: 'row', justifyContent: 'center', gap: 6, marginTop: Spacing.xl },
  switchText: { color: Colors.textSecondary, fontSize: 14 },
  switchLink: { color: Colors.primary, fontSize: 14, fontWeight: '700' },

  errorBox: { backgroundColor: Colors.sosLight, borderRadius: BorderRadius.sm, padding: 12, marginBottom: 4 },
  errorText: { color: Colors.sosDark, fontSize: 13, fontWeight: '500' },

  configContainer: { flex: 1, backgroundColor: Colors.background, alignItems: 'center', justifyContent: 'center', padding: Spacing.xl },
  configCard: { backgroundColor: Colors.sosLight, borderRadius: BorderRadius.lg, padding: Spacing.xl, marginTop: Spacing.lg },
  configTitle: { fontSize: 18, fontWeight: '700', color: Colors.sosDark, marginBottom: 8 },
  configText: { fontSize: 14, color: Colors.sosDark, lineHeight: 20 },
});
