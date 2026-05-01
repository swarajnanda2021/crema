/**
 * PostMenu — three-dots dropdown for post management.
 *
 * Owner sees: Edit / Pin / Delete.
 * Non-owner sees: Hide / Report / Dislike — recommender-engine
 * signals (Phase 2 work). The backend endpoints for those three
 * actions record the intent but don't yet change feed ranking;
 * see the roadmap entry for the engine that consumes them.
 *
 * The menu anchors under the three-dots button on both web and
 * native (uses `getBoundingClientRect` on web, `measureInWindow`
 * on native). Before this it anchored to the top-left corner of
 * the RN Modal overlay on native, which read as "a dropdown in
 * the corner of the screen" regardless of where the user tapped.
 */
import { useState, useRef } from "react";
import { View, Text, Pressable, Modal, StyleSheet, Platform, Dimensions } from "react-native";
import Svg, { Circle, Path } from "react-native-svg";
import { EyeOff, Flag, ThumbsDown } from "lucide-react-native";
import { t } from "../tokens/useTokens";
import { tap as hapticTap, warn as hapticWarn } from "../utils/haptics";

interface PostMenuProps {
  // Owner actions
  onEdit?: () => void;
  onPin?: () => void;
  onDelete?: () => void;
  isPinned?: boolean;
  // Non-owner actions — recommender signals
  onHide?: () => void;
  onReport?: () => void;
  onDislike?: () => void;
}

const MENU_WIDTH = 173;

export default function PostMenu({
  onEdit, onPin, onDelete, isPinned,
  onHide, onReport, onDislike,
}: PostMenuProps) {
  const [open, setOpen] = useState(false);
  const [menuPos, setMenuPos] = useState({ top: 0, right: 16 });
  const btnRef = useRef<any>(null);

  // Guard: render nothing when there are no items to show (e.g. a
  // non-owner viewer of a post the feed call-site hasn't wired the
  // hide/report/dislike handlers for yet).
  const hasOwnerItems = !!(onEdit || onPin || onDelete);
  const hasViewerItems = !!(onHide || onReport || onDislike);
  if (!hasOwnerItems && !hasViewerItems) return null;

  const handleOpen = () => {
    hapticTap();
    if (!btnRef.current) { setOpen(true); return; }
    if (Platform.OS === "web") {
      const el = btnRef.current as any;
      const rect = el.getBoundingClientRect?.();
      if (rect) {
        setMenuPos({
          top: rect.bottom + 4,
          right: Math.max(16, (typeof window !== "undefined" ? window.innerWidth : 0) - rect.right),
        });
      }
      setOpen(true);
    } else {
      // measureInWindow gives window-relative coords — exactly what
      // the RN Modal overlay uses for its absolute positioning.
      btnRef.current.measureInWindow?.((x: number, y: number, w: number, h: number) => {
        const screenW = Dimensions.get("window").width;
        setMenuPos({
          top: y + h + 4,
          right: Math.max(16, screenW - (x + w)),
        });
        setOpen(true);
      });
    }
  };

  return (
    <>
      <Pressable ref={btnRef} onPress={handleOpen} hitSlop={8} style={s.btn}>
        <Svg width={16} height={16} viewBox="0 0 16 16" fill="none">
          <Circle cx={8} cy={3} r={1.5} fill={t.color["text.muted"] as string} />
          <Circle cx={8} cy={8} r={1.5} fill={t.color["text.muted"] as string} />
          <Circle cx={8} cy={13} r={1.5} fill={t.color["text.muted"] as string} />
        </Svg>
      </Pressable>

      {open && (
        <Modal visible transparent animationType="none" onRequestClose={() => setOpen(false)}>
          <Pressable style={s.overlay} onPress={() => setOpen(false)}>
            <View
              style={[
                s.menu,
                Platform.OS === "web"
                  ? { position: "fixed" as any, top: menuPos.top, right: menuPos.right }
                  : { position: "absolute", top: menuPos.top, right: menuPos.right },
              ]}
            >
              {/* Owner: Edit */}
              {onEdit && (
                <Pressable onPress={() => { hapticTap(); setOpen(false); onEdit(); }} style={({ pressed }) => [s.menuItem, pressed && s.menuItemPressed]}>
                  <Svg width={15} height={15} viewBox="0 0 16.5 16.5" fill="none">
                    <Path d="M0.75 15.75H15.75M0.75 15.75V11.9004L10.9393 1.44043L10.941 1.43879C11.3112 1.05875 11.4966 0.8684 11.7103 0.797103C11.8986 0.734299 12.1015 0.734299 12.2898 0.797103C12.5034 0.868349 12.6886 1.05849 13.0583 1.43798L14.6893 3.11236C15.0606 3.49349 15.2463 3.68414 15.3159 3.90388C15.377 4.09717 15.377 4.30538 15.3158 4.49867C15.2463 4.71826 15.0609 4.90862 14.6902 5.2892L14.6893 5.29002L4.5 15.75L0.75 15.75Z" stroke={t.color["text.secondary"] as string} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
                  </Svg>
                  <Text style={s.menuText}>Edit post</Text>
                </Pressable>
              )}
              {/* Owner: Pin/Unpin */}
              {onPin && (
                <>
                  {onEdit && <View style={s.menuDivider} />}
                  <Pressable onPress={() => { hapticTap(); setOpen(false); onPin(); }} style={({ pressed }) => [s.menuItem, pressed && s.menuItemPressed]}>
                    {isPinned ? (
                      <Svg width={15} height={15} viewBox="0 0 16.5 16.5" fill="none">
                        <Path d="M6.16456 10.4306L0.75 15.75M11.4875 12.461L10.0739 13.8497L2.41602 6.32641L3.82964 4.93763M11.75 8.75L15.75 5.5375L10.8769 0.750002L7.75 4.75" stroke={t.color["text.secondary"] as string} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
                      </Svg>
                    ) : (
                      <Svg width={15} height={15} viewBox="0 0 16.5 16.5" fill="none">
                        <Path d="M6.16456 10.4306L0.75 15.75M2.41602 6.32641L10.0739 13.8497L11.4875 12.461L11.1601 9.36176L15.75 5.5375L10.8769 0.750001L6.98341 5.25925L3.82964 4.93763L2.41602 6.32641Z" stroke={t.color["text.secondary"] as string} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
                      </Svg>
                    )}
                    <Text style={s.menuText}>{isPinned ? "Unpin post" : "Pin post"}</Text>
                  </Pressable>
                </>
              )}
              {/* Owner: Delete */}
              {onDelete && (
                <>
                  {(onEdit || onPin) && <View style={s.menuDivider} />}
                  <Pressable onPress={() => { hapticWarn(); setOpen(false); onDelete(); }} style={({ pressed }) => [s.menuItem, pressed && s.menuItemPressed]}>
                    <Svg width={13} height={15} viewBox="0 0 14.5 16.5" fill="none">
                      <Path d="M2.375 3.25V13.0833C2.375 14.0168 2.375 14.4831 2.55211 14.8397C2.70791 15.1533 2.95632 15.4087 3.26208 15.5685C3.60935 15.75 4.06418 15.75 4.97249 15.75H9.52751C10.4358 15.75 10.89 15.75 11.2373 15.5685C11.543 15.4087 11.7923 15.1533 11.9481 14.8397C12.125 14.4835 12.125 14.0175 12.125 13.0859V3.25M2.375 3.25H4M2.375 3.25H0.75M4 3.25H10.5M4 3.25C4 2.47343 4 2.08534 4.1237 1.77905C4.28862 1.37067 4.60476 1.04602 5.00293 0.876868C5.30156 0.750001 5.68034 0.750001 6.4375 0.750001H8.0625C8.81965 0.750001 9.19823 0.750001 9.49686 0.876868C9.89503 1.04602 10.2113 1.37067 10.3762 1.77905C10.4999 2.08534 10.5 2.47343 10.5 3.25M10.5 3.25H12.125M12.125 3.25H13.75" stroke={t.color["text.secondary"] as string} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
                    </Svg>
                    <Text style={s.menuText}>Delete</Text>
                  </Pressable>
                </>
              )}

              {/* Non-owner: Hide */}
              {onHide && (
                <>
                  {hasOwnerItems && <View style={s.menuDivider} />}
                  <Pressable onPress={() => { hapticTap(); setOpen(false); onHide(); }} style={({ pressed }) => [s.menuItem, pressed && s.menuItemPressed]}>
                    <EyeOff size={15} color={t.color["text.secondary"]} strokeWidth={1.7} />
                    <Text style={s.menuText}>Hide</Text>
                  </Pressable>
                </>
              )}
              {/* Non-owner: Report */}
              {onReport && (
                <>
                  {(hasOwnerItems || onHide) && <View style={s.menuDivider} />}
                  <Pressable onPress={() => { hapticWarn(); setOpen(false); onReport(); }} style={({ pressed }) => [s.menuItem, pressed && s.menuItemPressed]}>
                    <Flag size={15} color={t.color["text.secondary"]} strokeWidth={1.7} />
                    <Text style={s.menuText}>Report</Text>
                  </Pressable>
                </>
              )}
              {/* Non-owner: Dislike */}
              {onDislike && (
                <>
                  {(hasOwnerItems || onHide || onReport) && <View style={s.menuDivider} />}
                  <Pressable onPress={() => { hapticTap(); setOpen(false); onDislike(); }} style={({ pressed }) => [s.menuItem, pressed && s.menuItemPressed]}>
                    <ThumbsDown size={15} color={t.color["text.secondary"]} strokeWidth={1.7} />
                    <Text style={s.menuText}>Dislike</Text>
                  </Pressable>
                </>
              )}
            </View>
          </Pressable>
        </Modal>
      )}
    </>
  );
}

const s = StyleSheet.create({
  btn: { padding: 4 },
  overlay: { flex: 1 } as any,
  menu: {
    backgroundColor: t.color["card.front"],
    borderRadius: 6.228,
    paddingVertical: 8,
    width: MENU_WIDTH,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 5 },
    shadowOpacity: 0.15,
    shadowRadius: 6.228,
    elevation: 8,
  } as any,
  menuItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 11,
    paddingHorizontal: 18,
    paddingVertical: 12,
  },
  menuItemPressed: { backgroundColor: t.color.bg },
  menuText: { fontFamily: t.font["body.regular"], fontSize: 13.573, color: t.color["text.secondary"] },
  menuDivider: { height: StyleSheet.hairlineWidth, backgroundColor: t.color.border, marginHorizontal: 10 },
});
