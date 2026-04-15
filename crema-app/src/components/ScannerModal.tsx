/**
 * CRUD Utopia — café-side QR scanner. Camera + jsQR on web,
 * expo-camera on native. POSTs to /api/cafes/{slug}/stamp.
 * See CRUD_UTOPIA.md at repo root.
 */

import { useState, useEffect, useRef } from "react";
import { View, Text, Pressable, Modal, TextInput, StyleSheet, ActivityIndicator, Platform } from "react-native";
import { X } from "lucide-react-native";
import { t } from "../tokens/useTokens";
import { apiFetchRaw } from "../api/client";

interface Props {
  cafeSlug: string;
  onClose: () => void;
}

interface StampResult {
  user_id: number;
  display_name: string;
  username: string;
  avatar_url: string | null;
  stamps_progress: number;
  stamp_target: number;
  reward_earned: boolean;
}

export default function ScannerModal({ cafeSlug, onClose }: Props) {
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<StampResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [manualToken, setManualToken] = useState("");
  const [scannerActive, setScannerActive] = useState(true);

  const submitToken = async (token: string) => {
    if (!token.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      const raw = await apiFetchRaw(`/cafes/${cafeSlug}/stamp`, {
        method: "POST",
        body: JSON.stringify({ qr_token: token.trim() }),
      });
      const r = (raw as any)?.data ?? raw;
      setResult(r);
      setScannerActive(false);
    } catch (e: any) {
      setError(e?.message || "Stamp failed");
    } finally {
      setSubmitting(false);
    }
  };

  const handleRedeem = async () => {
    if (!result) return;
    try {
      await apiFetchRaw(`/cafes/${cafeSlug}/redeem`, {
        method: "POST",
        body: JSON.stringify({ user_id: result.user_id }),
      });
      setResult(null);
      setManualToken("");
      setScannerActive(true);
    } catch (e) { console.warn("Redeem failed:", e); }
  };

  const reset = () => {
    setResult(null);
    setError(null);
    setManualToken("");
    setScannerActive(true);
  };

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <View style={s.overlay}>
        <Pressable style={StyleSheet.absoluteFillObject} onPress={onClose} />
        <View style={s.card}>
          <View style={s.header}>
            <Text style={s.title}>Scan QR</Text>
            <Pressable onPress={onClose}><X size={20} color={t.color["text.primary"]} /></Pressable>
          </View>

          {result ? (
            <View style={s.body}>
              <Text style={s.successTitle}>Stamped {result.display_name}</Text>
              <Text style={s.progressText}>{result.stamps_progress} / {result.stamp_target} stamps</Text>
              {result.reward_earned && (
                <Pressable onPress={handleRedeem} style={s.redeemBtn}>
                  <Text style={s.redeemBtnText}>Redeem free coffee</Text>
                </Pressable>
              )}
              <Pressable onPress={reset} style={s.againBtn}>
                <Text style={s.againText}>Scan another</Text>
              </Pressable>
            </View>
          ) : (
            <View style={s.body}>
              {scannerActive && (
                Platform.OS === "web"
                  ? <WebScanner onDecode={submitToken} />
                  : <NativeScanner onDecode={submitToken} />
              )}

              <Text style={s.label}>Or paste a QR token manually:</Text>
              <TextInput
                style={s.input}
                value={manualToken}
                onChangeText={setManualToken}
                placeholder="QR token"
                placeholderTextColor={t.color["text.muted"]}
                autoCapitalize="none"
              />
              {error && <Text style={s.error}>{error}</Text>}
              <Pressable onPress={() => submitToken(manualToken)} style={s.submitBtn} disabled={submitting}>
                {submitting ? <ActivityIndicator color={t.color["text.primary"]} /> : <Text style={s.submitText}>Stamp</Text>}
              </Pressable>
            </View>
          )}
        </View>
      </View>
    </Modal>
  );
}

// ── Web scanner — getUserMedia + jsQR ───────────────────────────────────────

function WebScanner({ onDecode }: { onDecode: (token: string) => void }) {
  const videoRef = useRef<any>(null);
  const canvasRef = useRef<any>(null);
  const [status, setStatus] = useState<"idle" | "starting" | "scanning" | "denied" | "error">("idle");
  const decodedRef = useRef(false);

  useEffect(() => {
    if (Platform.OS !== "web") return;
    let stream: any = null;
    let raf: any = null;

    (async () => {
      setStatus("starting");
      try {
        const jsQRModule: any = await import("jsqr");
        const jsQR = jsQRModule.default || jsQRModule;
        stream = await (navigator as any).mediaDevices.getUserMedia({
          video: { facingMode: "environment" },
        });
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
        }
        setStatus("scanning");

        const tick = () => {
          if (decodedRef.current) return;
          const video = videoRef.current;
          const canvas = canvasRef.current;
          if (video && video.readyState === 4 && canvas) {
            canvas.width = video.videoWidth;
            canvas.height = video.videoHeight;
            const ctx = canvas.getContext("2d");
            ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
            const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
            const code = jsQR(imageData.data, imageData.width, imageData.height);
            if (code && code.data) {
              decodedRef.current = true;
              onDecode(code.data);
              return;
            }
          }
          raf = requestAnimationFrame(tick);
        };
        raf = requestAnimationFrame(tick);
      } catch (e: any) {
        if (e?.name === "NotAllowedError") setStatus("denied");
        else setStatus("error");
      }
    })();

    return () => {
      if (raf) cancelAnimationFrame(raf);
      if (stream) {
        stream.getTracks().forEach((t: any) => t.stop());
      }
      decodedRef.current = false;
    };
  }, [onDecode]);

  if (Platform.OS !== "web") return null;

  return (
    <View style={s.scannerWrap}>
      {/* @ts-ignore — DOM video element on web */}
      <video ref={videoRef} style={{ width: "100%", height: 220, objectFit: "cover", borderRadius: 8 }} muted playsInline />
      {/* @ts-ignore — DOM canvas */}
      <canvas ref={canvasRef} style={{ display: "none" }} />
      {status === "starting" && <Text style={s.scannerStatus}>Starting camera…</Text>}
      {status === "denied" && <Text style={s.scannerStatus}>Camera permission denied. Use manual token below.</Text>}
      {status === "error" && <Text style={s.scannerStatus}>Camera unavailable. Use manual token below.</Text>}
      {status === "scanning" && <Text style={s.scannerStatus}>Point camera at user's QR code</Text>}
    </View>
  );
}

// ── Native scanner — expo-camera ────────────────────────────────────────────

function NativeScanner({ onDecode }: { onDecode: (token: string) => void }) {
  const [Camera, setCamera] = useState<any>(null);
  const [permission, setPermission] = useState<any>(null);
  const decodedRef = useRef(false);

  useEffect(() => {
    if (Platform.OS === "web") return;
    (async () => {
      const cameraModule: any = await import("expo-camera");
      setCamera(cameraModule.CameraView || cameraModule.Camera);
      const perm = await cameraModule.Camera.requestCameraPermissionsAsync();
      setPermission(perm);
    })();
  }, []);

  if (Platform.OS === "web") return null;

  if (!Camera || !permission) {
    return (
      <View style={s.scannerWrap}>
        <ActivityIndicator color={t.color.accent} />
      </View>
    );
  }

  if (!permission.granted) {
    return (
      <View style={s.scannerWrap}>
        <Text style={s.scannerStatus}>Camera permission required. Use manual token below.</Text>
      </View>
    );
  }

  return (
    <View style={s.scannerWrap}>
      <Camera
        style={{ height: 220, borderRadius: 8 }}
        barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
        onBarcodeScanned={(scan: any) => {
          if (decodedRef.current) return;
          decodedRef.current = true;
          onDecode(scan.data);
        }}
      />
      <Text style={s.scannerStatus}>Point camera at user's QR code</Text>
    </View>
  );
}

const s = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)", alignItems: "center", justifyContent: "center" },
  card: {
    width: "92%", maxWidth: 480, backgroundColor: t.color.bg, borderRadius: 12,
    overflow: "hidden",
  },
  header: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: 20, paddingVertical: 14,
    borderBottomWidth: 1, borderBottomColor: t.color["border.light"],
  },
  title: { fontFamily: t.font["body.semibold"], fontSize: 16, color: t.color["text.primary"] },
  body: { padding: 20, gap: 12 },
  scannerWrap: { gap: 8, marginBottom: 8 },
  scannerStatus: { fontFamily: t.font["body.regular"], fontSize: 12, color: t.color["text.muted"], textAlign: "center" },
  label: { fontFamily: t.font["body.regular"], fontSize: 12, color: t.color["text.secondary"], marginTop: 8 },
  input: {
    fontFamily: t.font["body.regular"], fontSize: 14, color: t.color["text.primary"],
    backgroundColor: t.color["card.info"], paddingHorizontal: 12, paddingVertical: 10,
    borderRadius: 4,
  },
  submitBtn: { backgroundColor: t.color.accent, paddingVertical: 12, borderRadius: 4, alignItems: "center" },
  submitText: { fontFamily: t.font["body.semibold"], fontSize: 14, color: t.color["text.primary"] },
  successTitle: { fontFamily: t.font.display, fontSize: 22, color: t.color["text.primary"] },
  progressText: { fontFamily: t.font["body.medium"], fontSize: 14, color: t.color["text.secondary"] },
  redeemBtn: { backgroundColor: t.color["accent.cta"], paddingVertical: 12, borderRadius: 4, alignItems: "center" },
  redeemBtnText: { fontFamily: t.font["body.semibold"], fontSize: 14, color: t.color["text.on-dark"] },
  againBtn: { paddingVertical: 8, alignItems: "center" },
  againText: { fontFamily: t.font["body.medium"], fontSize: 13, color: t.color["text.muted"] },
  error: { fontFamily: t.font["body.regular"], fontSize: 12, color: t.color["accent.cta"] },
});
