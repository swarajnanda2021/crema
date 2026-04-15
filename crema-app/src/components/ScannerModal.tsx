/**
 * CRUD Utopia — café-side stamp scanner. Two-step flow:
 *   1. Camera view decodes a user's QR code (expo-camera on native,
 *      getUserMedia + jsQR on web). No manual text-field fallback.
 *   2. Decoded QR token is POSTed to /api/qr-token/resolve to preview the
 *      user's avatar + name. A circular stamp button overlaid on the
 *      bottom-right of the avatar commits the stamp via
 *      /api/cafes/{slug}/stamp with { user_id }.
 * Matches icon colors / tokens from design-tokens.json everywhere.
 * See CRUD_UTOPIA.md at repo root.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  Pressable,
  Modal,
  StyleSheet,
  ActivityIndicator,
  Platform,
} from "react-native";
import { Stamp as StampIcon, X } from "lucide-react-native";

import { t } from "../tokens/useTokens";
import { apiFetchRaw } from "../api/client";
import { CroppedAvatar } from "./primitives";

interface Props {
  cafeSlug: string;
  onClose: () => void;
}

interface ResolvedUser {
  user_id: number;
  username: string;
  display_name: string;
  avatar_url: string | null;
  avatar_crop_x?: number;
  avatar_crop_y?: number;
  avatar_zoom?: number;
  location?: string | null;
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

type Phase = "scanning" | "resolving" | "preview" | "stamping" | "done";

export default function ScannerModal({ cafeSlug, onClose }: Props) {
  const [phase, setPhase] = useState<Phase>("scanning");
  const [resolved, setResolved] = useState<ResolvedUser | null>(null);
  const [result, setResult] = useState<StampResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const resolveToken = useCallback(
    async (qrToken: string) => {
      if (phase !== "scanning") return;
      setPhase("resolving");
      setError(null);
      try {
        const raw = await apiFetchRaw<any>("/qr-token/resolve", {
          method: "POST",
          body: JSON.stringify({ qr_token: qrToken }),
        });
        const d = (raw?.data ?? raw) as ResolvedUser;
        setResolved(d);
        setPhase("preview");
      } catch (e: any) {
        const msg: string = e?.message || "Couldn't decode that code";
        if (msg.includes("400")) setError("QR code is invalid or expired.");
        else setError(msg);
        setPhase("scanning");
      }
    },
    [phase],
  );

  const handleStamp = useCallback(async () => {
    if (!resolved || phase === "stamping") return;
    setPhase("stamping");
    setError(null);
    try {
      const raw = await apiFetchRaw<any>(`/cafes/${cafeSlug}/stamp`, {
        method: "POST",
        body: JSON.stringify({ user_id: resolved.user_id }),
      });
      const r = (raw?.data ?? raw) as StampResult;
      setResult(r);
      setPhase("done");
    } catch (e: any) {
      const msg: string = e?.message || "Stamp failed";
      if (msg.includes("429") || msg.toLowerCase().includes("already stamped")) {
        setError("Already stamped this user in the last 24 hours.");
      } else {
        setError(msg);
      }
      setPhase("preview");
    }
  }, [cafeSlug, resolved, phase]);

  const handleRedeem = useCallback(async () => {
    if (!result) return;
    try {
      await apiFetchRaw(`/cafes/${cafeSlug}/redeem`, {
        method: "POST",
        body: JSON.stringify({ user_id: result.user_id }),
      });
      reset();
    } catch (e) {
      console.warn("Redeem failed:", e);
    }
  }, [cafeSlug, result]);

  const reset = () => {
    setResolved(null);
    setResult(null);
    setError(null);
    setPhase("scanning");
  };

  // ── Render ──────────────────────────────────────────────────────────

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <View style={s.overlay}>
        <Pressable style={StyleSheet.absoluteFillObject} onPress={onClose} />
        <View style={s.card}>
          <View style={s.header}>
            <Text style={s.title}>
              {phase === "scanning" || phase === "resolving"
                ? "Scan a user's QR"
                : phase === "done"
                ? "Stamped"
                : "Confirm stamp"}
            </Text>
            <Pressable onPress={onClose} hitSlop={8}>
              <X size={20} color={t.color["text.primary"]} />
            </Pressable>
          </View>

          {/* ── Camera view ──────────────────────────────────────────── */}
          {(phase === "scanning" || phase === "resolving") && (
            <View style={s.cameraBody}>
              {Platform.OS === "web" ? (
                <WebScanner
                  onDecode={resolveToken}
                  paused={phase === "resolving"}
                />
              ) : (
                <NativeScanner
                  onDecode={resolveToken}
                  paused={phase === "resolving"}
                />
              )}
              {phase === "resolving" ? (
                <View style={s.resolvingBadge}>
                  <ActivityIndicator size="small" color={t.color["text.on-dark"]} />
                  <Text style={s.resolvingText}>Decoding…</Text>
                </View>
              ) : null}
              {error ? <Text style={s.error}>{error}</Text> : null}
            </View>
          )}

          {/* ── Preview — avatar + circular stamp button overlay ─────── */}
          {phase !== "scanning" && phase !== "resolving" && resolved ? (
            <View style={s.previewBody}>
              <View style={s.avatarStage}>
                <AvatarCard user={resolved} />
                {phase !== "done" ? (
                  <Pressable
                    onPress={handleStamp}
                    disabled={phase === "stamping"}
                    style={({ pressed }) => [
                      s.stampBtn,
                      pressed && s.stampBtnPressed,
                      phase === "stamping" && s.stampBtnSubmitting,
                    ]}
                    accessibilityLabel={`Stamp ${resolved.display_name}`}
                  >
                    {phase === "stamping" ? (
                      <ActivityIndicator size="small" color={t.color["text.on-dark"]} />
                    ) : (
                      <StampIcon
                        size={22}
                        color={t.color["text.on-dark"]}
                        strokeWidth={1.8}
                      />
                    )}
                  </Pressable>
                ) : null}
              </View>

              {phase === "done" && result ? (
                <>
                  <Text style={s.previewName}>Stamped {result.display_name}</Text>
                  <Text style={s.previewProgress}>
                    {result.stamps_progress} / {result.stamp_target} stamps
                  </Text>
                  {result.reward_earned ? (
                    <Pressable onPress={handleRedeem} style={s.redeemBtn}>
                      <Text style={s.redeemBtnText}>Redeem free coffee</Text>
                    </Pressable>
                  ) : null}
                  <Pressable onPress={reset} style={s.againBtn}>
                    <Text style={s.againText}>Scan another user</Text>
                  </Pressable>
                </>
              ) : (
                <>
                  <Text style={s.previewName}>{resolved.display_name}</Text>
                  <Text style={s.previewHandle}>@{resolved.username}</Text>
                  {resolved.location ? (
                    <Text style={s.previewMeta}>{resolved.location}</Text>
                  ) : null}
                  <Text style={s.tapHint}>Tap the stamp to confirm</Text>
                  {error ? <Text style={s.error}>{error}</Text> : null}
                  <Pressable onPress={reset} style={s.backBtn}>
                    <Text style={s.backText}>Scan a different code</Text>
                  </Pressable>
                </>
              )}
            </View>
          ) : null}
        </View>
      </View>
    </Modal>
  );
}

// ── Camera subcomponents ──────────────────────────────────────────────────

function WebScanner({
  onDecode,
  paused,
}: {
  onDecode: (token: string) => void;
  paused: boolean;
}) {
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
          if (decodedRef.current || paused) {
            raf = requestAnimationFrame(tick);
            return;
          }
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
    // We intentionally rebuild the stream on mount only — `paused` is read
    // inside tick() via closure. Omit from deps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onDecode]);

  if (Platform.OS !== "web") return null;

  return (
    <View style={s.cameraWrap}>
      {/* @ts-ignore — DOM video on web */}
      <video
        ref={videoRef}
        style={{
          width: "100%",
          aspectRatio: 1,
          objectFit: "cover",
          borderRadius: 12,
          backgroundColor: t.color["card.back"],
        }}
        muted
        playsInline
      />
      {/* @ts-ignore — DOM canvas on web */}
      <canvas ref={canvasRef} style={{ display: "none" }} />
      <View style={s.cameraFrame} pointerEvents="none" />
      {status === "starting" && (
        <Text style={s.cameraStatus}>Starting camera…</Text>
      )}
      {status === "denied" && (
        <Text style={s.cameraStatus}>
          Camera permission denied. Enable it in browser settings.
        </Text>
      )}
      {status === "error" && (
        <Text style={s.cameraStatus}>Camera unavailable.</Text>
      )}
      {status === "scanning" && (
        <Text style={s.cameraStatus}>Point camera at the user's QR code</Text>
      )}
    </View>
  );
}

function NativeScanner({
  onDecode,
  paused,
}: {
  onDecode: (token: string) => void;
  paused: boolean;
}) {
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
      <View style={s.cameraWrap}>
        <ActivityIndicator color={t.color.accent} />
      </View>
    );
  }

  if (!permission.granted) {
    return (
      <View style={s.cameraWrap}>
        <Text style={s.cameraStatus}>Camera permission required.</Text>
      </View>
    );
  }

  return (
    <View style={s.cameraWrap}>
      <Camera
        style={{ aspectRatio: 1, borderRadius: 12 }}
        barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
        onBarcodeScanned={(scan: any) => {
          if (decodedRef.current || paused) return;
          decodedRef.current = true;
          onDecode(scan.data);
        }}
      />
      <Text style={s.cameraStatus}>Point camera at the user's QR code</Text>
    </View>
  );
}

// ── Avatar card (reused in preview + result) ──────────────────────────────

function AvatarCard({ user }: { user: ResolvedUser | StampResult }) {
  const anyU = user as any;
  if (anyU.avatar_url) {
    return (
      <CroppedAvatar
        url={anyU.avatar_url}
        cropX={anyU.avatar_crop_x}
        cropY={anyU.avatar_crop_y}
        zoom={anyU.avatar_zoom}
        size={180}
      />
    );
  }
  return (
    <View style={s.avatarFallback}>
      <Text style={s.avatarInitials}>
        {(anyU.display_name || "?").charAt(0).toUpperCase()}
      </Text>
    </View>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: t.color.overlay,
    alignItems: "center",
    justifyContent: "center",
  },
  card: {
    width: "92%",
    maxWidth: 420,
    backgroundColor: t.color.bg,
    borderRadius: t.radius.lg,
    overflow: "hidden",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: t.spacing.xl,
    paddingVertical: t.spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: t.color["border.light"],
  },
  title: {
    fontFamily: t.font["body.semibold"],
    fontSize: t.size["font.lg"],
    color: t.color["text.primary"],
  },

  // Camera
  cameraBody: {
    padding: t.spacing.xl,
    gap: t.spacing.md,
  },
  cameraWrap: {
    position: "relative",
    alignItems: "center",
    gap: t.spacing.sm,
  } as any,
  cameraFrame: {
    position: "absolute",
    top: "15%",
    left: "15%",
    right: "15%",
    bottom: "15%",
    borderWidth: 2,
    borderColor: t.color.accent,
    borderRadius: t.radius.md,
  } as any,
  cameraStatus: {
    fontFamily: t.font["body.regular"],
    fontSize: t.size["font.sm"],
    color: t.color["text.muted"],
    textAlign: "center",
  },
  resolvingBadge: {
    position: "absolute",
    bottom: t.spacing["2xl"],
    alignSelf: "center",
    flexDirection: "row",
    alignItems: "center",
    gap: t.spacing.sm,
    backgroundColor: t.color["text.primary"],
    paddingHorizontal: t.spacing.md,
    paddingVertical: t.spacing.sm,
    borderRadius: t.radius.sm,
  } as any,
  resolvingText: {
    fontFamily: t.font["body.medium"],
    fontSize: t.size["font.sm"],
    color: t.color["text.on-dark"],
  },

  // Preview / confirm
  previewBody: {
    padding: t.spacing["2xl"],
    alignItems: "center",
    gap: t.spacing.sm,
  },
  avatarStage: {
    width: 180,
    height: 180,
    position: "relative",
    marginBottom: t.spacing.md,
  } as any,
  avatarFallback: {
    width: 180,
    height: 180,
    borderRadius: 90,
    backgroundColor: t.color["card.info"],
    alignItems: "center",
    justifyContent: "center",
  },
  avatarInitials: {
    fontFamily: t.font.display,
    fontSize: 64,
    color: t.color["text.primary"],
  },
  // Circular stamp button overlaid bottom-right on the avatar — uses the
  // app's primary dark fill + cream icon, matching icon colors elsewhere.
  stampBtn: {
    position: "absolute",
    bottom: 0,
    right: 0,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: t.color["text.primary"],
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 3,
    borderColor: t.color.bg,
    shadowColor: t.color.shadow,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
    elevation: 4,
  } as any,
  stampBtnPressed: {
    backgroundColor: t.color["accent.cta.hover"],
    transform: [{ scale: 0.96 }],
  } as any,
  stampBtnSubmitting: {
    backgroundColor: t.color["accent.cta"],
  },
  previewName: {
    fontFamily: t.font.display,
    fontSize: 28,
    color: t.color["text.primary"],
    marginTop: t.spacing.sm,
  },
  previewHandle: {
    fontFamily: t.font["body.medium"],
    fontSize: t.size["font.sm"],
    color: t.color["text.muted"],
  },
  previewMeta: {
    fontFamily: t.font["body.regular"],
    fontSize: t.size["font.xs"],
    color: t.color["text.secondary"],
    marginTop: 2,
  },
  previewProgress: {
    fontFamily: t.font["body.medium"],
    fontSize: t.size["font.md"],
    color: t.color["text.secondary"],
  },
  tapHint: {
    fontFamily: t.font["body.regular"],
    fontSize: t.size["font.sm"],
    color: t.color["text.muted"],
    marginTop: t.spacing.sm,
  },
  backBtn: {
    marginTop: t.spacing.md,
    paddingVertical: t.spacing.sm,
    paddingHorizontal: t.spacing.lg,
  },
  backText: {
    fontFamily: t.font["body.medium"],
    fontSize: t.size["font.sm"],
    color: t.color["text.muted"],
  },
  redeemBtn: {
    backgroundColor: t.color["accent.cta"],
    paddingVertical: t.spacing.md,
    paddingHorizontal: t.spacing.xl,
    borderRadius: t.radius.sm,
    marginTop: t.spacing.md,
  },
  redeemBtnText: {
    fontFamily: t.font["body.semibold"],
    fontSize: t.size["font.md"],
    color: t.color["text.on-dark"],
  },
  againBtn: {
    marginTop: t.spacing.sm,
    paddingVertical: t.spacing.sm,
  },
  againText: {
    fontFamily: t.font["body.medium"],
    fontSize: t.size["font.sm"],
    color: t.color["text.muted"],
  },

  error: {
    fontFamily: t.font["body.regular"],
    fontSize: t.size["font.sm"],
    color: t.color["accent.cta"],
    marginTop: t.spacing.sm,
    textAlign: "center",
  },
});
