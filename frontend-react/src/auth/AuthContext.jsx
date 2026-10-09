import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { getMe, signInRequest, signOutRequest } from './authApi';

// Holds the signed-in user for the whole app (NEW). `loading` is true until the first /api/auth/me
// answer arrives so a page refresh never flashes the sign-in screen for a user who is logged in.
const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    getMe()
      .then((d) => alive && setUser(d.user))
      .catch(() => alive && setUser(null))
      .finally(() => alive && setLoading(false));
    return () => { alive = false; };
  }, []);

  // If the session expires while the app is open, any existing page's API call gets a 401.
  // Catch it centrally (without touching those pages) and send the user back to Sign In.
  useEffect(() => {
    const original = window.fetch;
    window.fetch = async (...args) => {
      const res = await original(...args);
      if (res.status === 401) {
        const first = args[0];
        const url = typeof first === 'string' ? first : (first && first.url) || '';
        if (url.startsWith('/api/') && !url.startsWith('/api/auth/')) setUser(null);
      }
      return res;
    };
    return () => { window.fetch = original; };
  }, []);

  const signIn = useCallback(async (email, password) => {
    const data = await signInRequest({ email, password });
    setUser(data.user);
    return data.user;
  }, []);

  const signOut = useCallback(async () => {
    try { await signOutRequest(); } catch { /* even if the call fails, drop the local session */ }
    setUser(null);
  }, []);

  const value = useMemo(() => ({ user, loading, signIn, signOut }), [user, loading, signIn, signOut]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
