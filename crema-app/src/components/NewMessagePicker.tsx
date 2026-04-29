/**
 * NewMessagePicker — "compose a new DM" dialog that replaces the
 * MessagesDropdown list when the user taps the + icon.
 *
 * Accounts are bucketed by relationship (following / followers data
 * from `/my-following` + `/followers/{my-slug}`):
 *   1. Mutuals — you follow them, they follow you back.
 *   2. You follow — you follow them, they don't follow back.
 *   3. Follows you — they follow you, you don't follow back.
 *   4. Other users — shown only when the search field is non-empty;
 *      hits come from `/users/search` and exclude anyone already in
 *      the three buckets above.
 *
 * Typing in the search field narrows every section by username /
 * display name. Tapping a row hits `POST /direct-threads/with/
 * {username}` and hands the new `thread_id` back to the caller,
 * which flips MessagesDropdown into the thread view.
 */
import { useEffect, useMemo, useState } from "react";
import {
  View, Text, Pressable, StyleSheet, TextInput, ScrollView, ActivityIndicator,
} from "react-native";
import { Search as SearchIcon, X } from "lucide-react-native";

import { t } from "../tokens/useTokens";
import { apiFetchRaw } from "../api/client";
import { useAuth } from "../hooks/useAuth";
import { CroppedAvatar } from "./primitives";

interface Props {
  onClose: () => void;
  onPick: (threadId: number) => void;
}

interface Account {
  username: string;
  display_name: string;
  avatar_url?: string | null;
  avatar_crop_x?: number | null;
  avatar_crop_y?: number | null;
  avatar_zoom?: number | null;
  location?: string | null;
  slug?: string;
}

/** My own slug in the follows table — roaster slug for business
 *  accounts, `user_<id>` for regular users. Matches how backend
 *  `/my-following` stores rows. */
function mySlug(user: any): string {
  if (user?.roaster_slug) return user.roaster_slug;
  return `user_${user?.id}`;
}

function matches(query: string) {
  const q = query.trim().toLowerCase();
  if (!q) return () => true;
  return (a: Account) =>
    a.username.toLowerCase().includes(q) ||
    (a.display_name || "").toLowerCase().includes(q);
}

export default function NewMessagePicker({ onClose, onPick }: Props) {
  const { user } = useAuth();
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [following, setFollowing] = useState<Account[]>([]);
  const [followers, setFollowers] = useState<Account[]>([]);
  const [others, setOthers] = useState<Account[]>([]);
  const [picking, setPicking] = useState<string | null>(null);

  // Load my following + my followers on mount. Both endpoints are
  // cheap; no pagination needed at F&F scale.
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      try {
        const [followingRes, followerRes] = await Promise.all([
          apiFetchRaw<any>("/my-following"),
          apiFetchRaw<any>(`/followers/${mySlug(user)}`),
        ]);
        if (cancelled) return;
        setFollowing((followingRes?.data ?? followingRes)?.following || []);
        setFollowers((followerRes?.data ?? followerRes)?.followers || []);
      } catch (e) {
        console.warn("NewMessagePicker load failed:", e);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [user?.id]);

  // "Other users" only populates when the query is non-empty — we
  // don't want to dump the whole user table into the picker.
  useEffect(() => {
    const q = query.trim();
    if (!q) { setOthers([]); return; }
    let cancelled = false;
    const handle = setTimeout(async () => {
      try {
        const raw = await apiFetchRaw<any>(`/users/search?q=${encodeURIComponent(q)}`);
        if (cancelled) return;
        const hits: Account[] = (raw?.data ?? raw)?.hits || (raw?.data ?? raw) || [];
        setOthers(hits);
      } catch {
        if (!cancelled) setOthers([]);
      }
    }, 180);
    return () => { cancelled = true; clearTimeout(handle); };
  }, [query]);

  const { mutuals, followingOnly, followersOnly, strangers } = useMemo(() => {
    const followingSet = new Set(following.map((a) => a.username));
    const followerSet = new Set(followers.map((a) => a.username));
    const mine = user?.username;
    const mutuals = following.filter((a) => followerSet.has(a.username) && a.username !== mine);
    const followingOnly = following.filter((a) => !followerSet.has(a.username) && a.username !== mine);
    const followersOnly = followers.filter((a) => !followingSet.has(a.username) && a.username !== mine);
    const strangers = others.filter(
      (a) => a.username !== mine && !followingSet.has(a.username) && !followerSet.has(a.username),
    );
    return { mutuals, followingOnly, followersOnly, strangers };
  }, [following, followers, others, user?.username]);

  const f = matches(query);
  const mutualsF = mutuals.filter(f);
  const followingOnlyF = followingOnly.filter(f);
  const followersOnlyF = followersOnly.filter(f);
  const strangersF = strangers.filter(f);
  const anyResults =
    mutualsF.length + followingOnlyF.length + followersOnlyF.length + strangersF.length > 0;

  const handlePick = async (username: string) => {
    if (picking) return;
    setPicking(username);
    try {
      const raw = await apiFetchRaw<any>(`/direct-threads/with/${username}`, { method: "POST" });
      const d = raw?.data ?? raw;
      if (d?.thread_id) onPick(d.thread_id);
    } catch (e) {
      console.warn("Open DM failed:", e);
    } finally {
      setPicking(null);
    }
  };

  return (
    <View style={s.root}>
      <View style={s.header}>
        <Text style={s.title}>New message</Text>
        <Pressable onPress={onClose} style={s.closeBtn} hitSlop={10} accessibilityLabel="Close">
          <X size={18} color={t.color["text.primary"]} strokeWidth={2} />
        </Pressable>
      </View>

      <View style={s.inputWrap}>
        <SearchIcon size={t.size["icon.md"]} color={t.color["text.muted"]} />
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Search by name or username"
          placeholderTextColor={t.color["text.muted"]}
          style={s.input}
          autoCapitalize="none"
          autoCorrect={false}
        />
        {query ? (
          <Pressable onPress={() => setQuery("")} hitSlop={6}>
            <X size={t.size["icon.sm"]} color={t.color["text.muted"]} />
          </Pressable>
        ) : null}
      </View>

      <ScrollView style={s.list} showsVerticalScrollIndicator={false}>
        {loading ? (
          <ActivityIndicator size="small" color={t.color.accent} style={{ paddingVertical: t.spacing["2xl"] }} />
        ) : !anyResults ? (
          <Text style={s.hint}>
            {query ? `No matches for "${query}".` : "No connections yet. Follow someone to start a message."}
          </Text>
        ) : (
          <>
            {mutualsF.length > 0 && <Section label="Mutual">{mutualsF.map((a) => renderRow(a, handlePick, picking))}</Section>}
            {followingOnlyF.length > 0 && <Section label="You follow">{followingOnlyF.map((a) => renderRow(a, handlePick, picking))}</Section>}
            {followersOnlyF.length > 0 && <Section label="Follows you">{followersOnlyF.map((a) => renderRow(a, handlePick, picking))}</Section>}
            {strangersF.length > 0 && <Section label="Other users">{strangersF.map((a) => renderRow(a, handlePick, picking))}</Section>}
          </>
        )}
      </ScrollView>
    </View>
  );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View style={s.section}>
      <Text style={s.sectionLabel}>{label}</Text>
      {children}
    </View>
  );
}

function renderRow(a: Account, onPick: (username: string) => void, picking: string | null) {
  const isPicking = picking === a.username;
  return (
    <Pressable
      key={a.username}
      onPress={() => onPick(a.username)}
      style={({ pressed }: any) => [s.row, pressed && s.rowPressed, isPicking && s.rowPressed]}
      disabled={!!picking}
    >
      {a.avatar_url ? (
        <CroppedAvatar
          url={a.avatar_url}
          cropX={a.avatar_crop_x ?? undefined}
          cropY={a.avatar_crop_y ?? undefined}
          zoom={a.avatar_zoom ?? undefined}
          size={32}
        />
      ) : (
        <View style={s.avatarFb}>
          <Text style={s.avatarLetter}>{(a.display_name || a.username || "?")[0].toUpperCase()}</Text>
        </View>
      )}
      <View style={s.rowText}>
        <Text style={s.rowTitle} numberOfLines={1}>{a.display_name || a.username}</Text>
        <Text style={s.rowMeta} numberOfLines={1}>@{a.username}{a.location ? ` · ${a.location}` : ""}</Text>
      </View>
      {isPicking ? <ActivityIndicator size="small" color={t.color.accent} /> : null}
    </Pressable>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: t.color.bg },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: t.spacing.lg,
    paddingVertical: t.spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: t.color["border.light"],
  },
  title: {
    fontFamily: t.font["body.semibold"],
    fontSize: t.size["font.lg"],
    color: t.color["text.primary"],
  },
  closeBtn: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  inputWrap: {
    flexDirection: "row",
    alignItems: "center",
    gap: t.spacing.sm,
    marginHorizontal: t.spacing.lg,
    marginTop: t.spacing.md,
    paddingHorizontal: t.spacing.md,
    paddingVertical: t.spacing.sm,
    borderRadius: t.radius.md,
    backgroundColor: t.color["card.front"],
    borderWidth: 1,
    borderColor: t.color["border.light"],
  },
  input: {
    flex: 1,
    fontFamily: t.font["body.regular"],
    fontSize: t.size["font.md"],
    color: t.color["text.primary"],
  },
  list: { flex: 1, marginTop: t.spacing.sm },
  hint: {
    fontFamily: t.font["body.regular"],
    fontSize: t.size["font.md"],
    color: t.color["text.muted"],
    textAlign: "center",
    paddingVertical: t.spacing["3xl"],
    paddingHorizontal: t.spacing.xl,
  },
  section: { paddingTop: t.spacing.md },
  sectionLabel: {
    fontFamily: t.font["body.semibold"],
    fontSize: t.size["font.xs"],
    color: t.color["text.muted"],
    letterSpacing: 0.6,
    textTransform: "uppercase",
    paddingHorizontal: t.spacing.lg,
    paddingVertical: t.spacing.xs,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: t.spacing.md,
    paddingHorizontal: t.spacing.lg,
    paddingVertical: t.spacing.md,
  },
  rowPressed: {
    backgroundColor: "rgba(215,152,218,0.08)",
  },
  rowText: { flex: 1 },
  rowTitle: {
    fontFamily: t.font["body.semibold"],
    fontSize: t.size["font.md"],
    color: t.color["text.primary"],
  },
  rowMeta: {
    fontFamily: t.font["body.regular"],
    fontSize: t.size["font.sm"],
    color: t.color["text.muted"],
    marginTop: 2,
  },
  avatarFb: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: t.color["text.primary"],
    alignItems: "center",
    justifyContent: "center",
  },
  avatarLetter: {
    fontFamily: t.font["body.semibold"],
    fontSize: t.size["font.base"],
    color: t.color.bg,
  },
});
