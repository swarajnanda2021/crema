import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";
import { Coffee } from "lucide-react";

export default function AuthPage() {
  const [mode, setMode] = useState("login"); // login | register
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const { login, register } = useAuth();
  const navigate = useNavigate();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    try {
      if (mode === "login") {
        await login(username, password);
      } else {
        await register(username, displayName || username, password);
      }
      navigate("/my-shelf");
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <div className="max-w-sm mx-auto px-4 py-16">
      <div className="text-center mb-8">
        <Coffee size={40} className="mx-auto mb-3" style={{ color: "var(--color-accent)" }} />
        <h1 className="text-2xl font-bold" style={{ fontFamily: "var(--font-serif)" }}>
          {mode === "login" ? "Welcome Back" : "Join the Community"}
        </h1>
        <p className="text-sm mt-1" style={{ color: "var(--color-text-secondary)" }}>
          Track your coffee journey
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--color-text-secondary)" }}>
            Username
          </label>
          <input
            value={username}
            onChange={(e) => setUsername(e.target.value.toLowerCase())}
            placeholder="e.g. swaraj"
            className="w-full mt-1 px-3 py-2.5 rounded-lg border text-sm"
            style={{ borderColor: "var(--color-border)" }}
            required
          />
        </div>

        {mode === "register" && (
          <div>
            <label className="text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--color-text-secondary)" }}>
              Display Name
            </label>
            <input
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="e.g. Swaraj"
              className="w-full mt-1 px-3 py-2.5 rounded-lg border text-sm"
              style={{ borderColor: "var(--color-border)" }}
            />
          </div>
        )}

        <div>
          <label className="text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--color-text-secondary)" }}>
            Password
          </label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Min 6 characters"
            className="w-full mt-1 px-3 py-2.5 rounded-lg border text-sm"
            style={{ borderColor: "var(--color-border)" }}
            required
            minLength={6}
          />
        </div>

        {error && (
          <p className="text-sm text-red-600">{error}</p>
        )}

        <button
          type="submit"
          className="w-full py-2.5 rounded-lg text-white font-semibold text-sm cursor-pointer"
          style={{ background: "var(--color-accent)" }}
        >
          {mode === "login" ? "Sign In" : "Create Account"}
        </button>
      </form>

      <p className="text-center text-sm mt-6" style={{ color: "var(--color-text-secondary)" }}>
        {mode === "login" ? (
          <>
            New here?{" "}
            <button
              onClick={() => { setMode("register"); setError(""); }}
              className="font-semibold cursor-pointer hover:underline"
              style={{ color: "var(--color-accent)" }}
            >
              Create an account
            </button>
          </>
        ) : (
          <>
            Already have an account?{" "}
            <button
              onClick={() => { setMode("login"); setError(""); }}
              className="font-semibold cursor-pointer hover:underline"
              style={{ color: "var(--color-accent)" }}
            >
              Sign in
            </button>
          </>
        )}
      </p>
    </div>
  );
}
