import { useState } from "react";
import { Share2, Link, MessageCircle, Twitter, Check } from "lucide-react";
import { useShare } from "../hooks/useShare";

export default function ShareButton({ coffee, showLabel = false, className = "" }) {
  const { share, copyLink, whatsappUrl, twitterUrl } = useShare();
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  const handleClick = async (e) => {
    e.stopPropagation();
    const shared = await share(coffee);
    if (!shared) setOpen((v) => !v);
  };

  const handleCopy = async (e) => {
    e.stopPropagation();
    const ok = await copyLink(coffee);
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
    setOpen(false);
  };

  const handleExternal = (e, url) => {
    e.stopPropagation();
    window.open(url, "_blank");
    setOpen(false);
  };

  return (
    <div className={`relative ${className}`}>
      <button
        onClick={handleClick}
        className="inline-flex items-center gap-1.5 transition-colors cursor-pointer"
        aria-label="Share"
      >
        <Share2 size={18} />
        {showLabel && <span className="text-sm font-medium">Share</span>}
      </button>

      {open && (
        <div
          className="absolute bottom-full mb-2 right-0 bg-white rounded-xl shadow-lg border p-2 min-w-[160px] z-50"
          style={{ borderColor: "var(--color-border)" }}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            onClick={handleCopy}
            className="w-full flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-gray-50 text-sm cursor-pointer"
          >
            {copied ? <Check size={16} /> : <Link size={16} />}
            {copied ? "Copied!" : "Copy Link"}
          </button>
          <button
            onClick={(e) => handleExternal(e, whatsappUrl(coffee))}
            className="w-full flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-gray-50 text-sm cursor-pointer"
          >
            <MessageCircle size={16} />
            WhatsApp
          </button>
          <button
            onClick={(e) => handleExternal(e, twitterUrl(coffee))}
            className="w-full flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-gray-50 text-sm cursor-pointer"
          >
            <Twitter size={16} />
            Twitter / X
          </button>
        </div>
      )}
    </div>
  );
}
