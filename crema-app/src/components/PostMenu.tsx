/**
 * PostMenu — three-dots dropdown for post management (edit, pin, delete).
 * Shared between PostFeedCard (feed/profile) and PostModal.
 */

import { useState, useRef } from "react";
import { View, Text, Pressable, Modal, StyleSheet, Platform } from "react-native";
import Svg, { Circle } from "react-native-svg";
import { PenLine, Pin, Trash2 } from "lucide-react-native";
import { fonts } from "../theme/colors";

interface PostMenuProps {
  onEdit?: () => void;
  onPin?: () => void;
  onDelete?: () => void;
  isPinned?: boolean;
}

export default function PostMenu({ onEdit, onPin, onDelete, isPinned }: PostMenuProps) {
  const [open, setOpen] = useState(false);
  const [menuPos, setMenuPos] = useState({ top: 0, right: 0 });
  const btnRef = useRef<any>(null);

  const handleOpen = () => {
    if (Platform.OS === "web" && btnRef.current) {
      const el = btnRef.current as any;
      const rect = el.getBoundingClientRect?.();
      if (rect) {
        setMenuPos({
          top: rect.bottom + 4,
          right: Math.max(16, window.innerWidth - rect.right),
        });
      }
    }
    setOpen(true);
  };

  return (
    <>
      <Pressable ref={btnRef} onPress={handleOpen} hitSlop={8} style={s.btn}>
        <Svg width={16} height={16} viewBox="0 0 16 16" fill="none">
          <Circle cx={8} cy={3} r={1.5} fill="#A09580" />
          <Circle cx={8} cy={8} r={1.5} fill="#A09580" />
          <Circle cx={8} cy={13} r={1.5} fill="#A09580" />
        </Svg>
      </Pressable>

      {open && (
        <Modal visible transparent animationType="none" onRequestClose={() => setOpen(false)}>
          <Pressable style={s.overlay} onPress={() => setOpen(false)}>
            <View style={[s.menu, Platform.OS === "web" ? { position: "fixed" as any, top: menuPos.top, right: menuPos.right } : {}]}>
              {onEdit && (
                <Pressable onPress={() => { setOpen(false); onEdit(); }} style={({ pressed }) => [s.menuItem, pressed && s.menuItemPressed]}>
                  <PenLine size={14} color="#684F44" strokeWidth={1.5} />
                  <Text style={s.menuText}>Edit post</Text>
                </Pressable>
              )}
              {onPin && (
                <Pressable onPress={() => { setOpen(false); onPin(); }} style={({ pressed }) => [s.menuItem, pressed && s.menuItemPressed]}>
                  <Pin size={14} color="#684F44" strokeWidth={1.5} />
                  <Text style={s.menuText}>{isPinned ? "Unpin post" : "Pin post"}</Text>
                </Pressable>
              )}
              {onDelete && (
                <Pressable onPress={() => { setOpen(false); onDelete(); }} style={({ pressed }) => [s.menuItem, pressed && s.menuItemPressed]}>
                  <Trash2 size={14} color="#C8553D" strokeWidth={1.5} />
                  <Text style={[s.menuText, { color: "#C8553D" }]}>Delete</Text>
                </Pressable>
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
  overlay: {
    flex: 1,
    backgroundColor: "transparent",
  },
  // Matches roaster profile three-dot dropdown (Figma 264:3590)
  menu: {
    backgroundColor: "#FFFFFF",
    borderRadius: 6.228,
    paddingVertical: 8,
    width: 173,
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
  menuItemPressed: { backgroundColor: "#FAF8F0" },
  menuText: { fontFamily: fonts.bodyRegular, fontSize: 13.573, color: "#684F44" },
});
