import { Link, useLocation, useNavigate } from "react-router-dom";
import { Coffee, Search, X, User, ShoppingBag, LogIn } from "lucide-react";
import { useAuth } from "../community/hooks/useAuth";
import { useState } from "react";

export default function Navbar() {
  const { user, backendAvailable } = useAuth();
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const navigate = useNavigate();
  const location = useLocation();

  const handleSearch = (e) => {
    e.preventDefault();
    if (query.trim()) {
      navigate(`/browse?q=${encodeURIComponent(query.trim())}`);
    }
    setSearchOpen(false);
  };

  const isActive = (path) => location.pathname === path;

  return (
    <nav
      className="fixed top-0 left-0 right-0 z-50 h-14 flex items-center px-4 md:px-6 backdrop-blur-md border-b"
      style={{
        background: "rgba(250, 247, 242, 0.95)",
        borderColor: "var(--color-border)",
      }}
    >
      {/* Logo — always links to feed */}
      <Link
        to="/"
        className="flex items-center gap-2 shrink-0 mr-6"
        style={{ color: "var(--color-text-primary)" }}
      >
        <Coffee size={22} style={{ color: "var(--color-accent)" }} />
        <span
          className="text-lg font-bold hidden sm:inline"
          style={{ fontFamily: "var(--font-serif)" }}
        >
          Crema
        </span>
      </Link>

      {/* Nav tabs */}
      <div className="flex items-center gap-1 flex-1">
        {user && (
          <NavTab to="/profile" icon={User} label="My Shelf" active={isActive("/profile")} />
        )}
        <NavTab to="/browse" icon={ShoppingBag} label="Browse" active={isActive("/browse")} />
      </div>

      {/* Right side */}
      <div className="flex items-center gap-1">
        {/* Search */}
        {searchOpen ? (
          <form onSubmit={handleSearch} className="flex items-center gap-2 max-w-xs">
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search..."
              className="w-40 sm:w-56 rounded-lg px-3 py-1.5 text-sm border outline-none"
              style={{ borderColor: "var(--color-border)" }}
            />
            <button type="button" onClick={() => setSearchOpen(false)} className="cursor-pointer">
              <X size={18} />
            </button>
          </form>
        ) : (
          <button
            onClick={() => setSearchOpen(true)}
            className="p-2 rounded-lg hover:bg-black/5 cursor-pointer"
            aria-label="Search"
          >
            <Search size={18} />
          </button>
        )}

        {/* Sign In (when not logged in) */}
        {backendAvailable && !user && (
          <Link
            to="/auth"
            className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-sm font-medium text-white ml-1"
            style={{ background: "var(--color-accent)" }}
          >
            <LogIn size={14} />
            <span className="hidden sm:inline">Sign In</span>
          </Link>
        )}
      </div>
    </nav>
  );
}

function NavTab({ to, icon: Icon, label, active }) {
  return (
    <Link
      to={to}
      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors"
      style={{
        background: active ? "var(--color-tag-bg)" : "transparent",
        color: active ? "var(--color-text-primary)" : "var(--color-text-secondary)",
      }}
    >
      <Icon size={16} />
      <span className="hidden sm:inline">{label}</span>
    </Link>
  );
}
