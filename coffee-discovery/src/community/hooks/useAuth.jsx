import { createContext, useContext, useState, useEffect, useCallback } from "react";
import { apiFetch, setToken } from "../api";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [backendAvailable, setBackendAvailable] = useState(false);
  const [loading, setLoading] = useState(true);

  // Probe backend + restore session on mount
  useEffect(() => {
    (async () => {
      try {
        // Quick probe — dictionary endpoint is public, lightweight
        await apiFetch("/dictionary/brew-methods");
        setBackendAvailable(true);

        // If we have a token, try to restore the session
        const token = localStorage.getItem("coffee_session_token");
        if (token) {
          const me = await apiFetch("/auth/me");
          setUser(me);
        }
      } catch {
        // Backend unreachable or token invalid — that's fine
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const login = useCallback(async (username, password) => {
    const res = await apiFetch("/auth/login", {
      method: "POST",
      body: JSON.stringify({ username, password }),
    });
    setToken(res.token);
    setUser(res.user);
    return res.user;
  }, []);

  const register = useCallback(async (username, displayName, password) => {
    const res = await apiFetch("/auth/register", {
      method: "POST",
      body: JSON.stringify({
        username,
        display_name: displayName,
        password,
      }),
    });
    setToken(res.token);
    setUser(res.user);
    return res.user;
  }, []);

  const logout = useCallback(() => {
    setToken(null);
    setUser(null);
  }, []);

  const updateProfile = useCallback(async (profileData) => {
    const updated = await apiFetch("/auth/profile", {
      method: "PUT",
      body: JSON.stringify(profileData),
    });
    setUser(updated);
    return updated;
  }, []);

  return (
    <AuthContext.Provider
      value={{ user, backendAvailable, loading, login, register, logout, updateProfile }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be inside AuthProvider");
  return ctx;
}
