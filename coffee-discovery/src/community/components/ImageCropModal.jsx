import { useState, useCallback } from "react";
import Cropper from "react-easy-crop";

/**
 * Minimal crop modal — trackpad-native zoom/pan only.
 * Tap outside the crop area or hit "Done" to finish.
 * No zoom bar, no clutter.
 */
export default function ImageCropModal({ imageSrc, onCrop, onClose }) {
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [croppedArea, setCroppedArea] = useState(null);
  const [saving, setSaving] = useState(false);

  const onCropComplete = useCallback((_, croppedAreaPixels) => {
    setCroppedArea(croppedAreaPixels);
  }, []);

  const handleSave = async () => {
    if (!croppedArea) return;
    setSaving(true);
    try {
      const blob = await getCroppedBlob(imageSrc, croppedArea);
      await onCrop(blob);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] flex flex-col" style={{ background: "#000" }}>
      {/* Crop area — fills entire screen */}
      <div className="flex-1 relative" onClick={(e) => {
        // If they click outside the image (on the dark letterbox area), close
        if (e.target === e.currentTarget) onClose();
      }}>
        <Cropper
          image={imageSrc}
          crop={crop}
          zoom={zoom}
          aspect={1}
          cropShape="round"
          showGrid={false}
          onCropChange={setCrop}
          onZoomChange={setZoom}
          onCropComplete={onCropComplete}
          minZoom={1}
          maxZoom={4}
          zoomSpeed={0.3}
          style={{
            containerStyle: { background: "#111" },
            cropAreaStyle: { border: "2px solid rgba(255,255,255,0.6)" },
          }}
        />
      </div>

      {/* Floating buttons at bottom */}
      <div className="absolute bottom-6 left-0 right-0 flex justify-center gap-3 z-10">
        <button
          onClick={onClose}
          className="px-5 py-2.5 rounded-full text-sm font-medium cursor-pointer backdrop-blur-md"
          style={{ background: "rgba(255,255,255,0.15)", color: "white" }}
        >
          Cancel
        </button>
        <button
          onClick={handleSave}
          disabled={saving}
          className="px-6 py-2.5 rounded-full text-sm font-semibold cursor-pointer"
          style={{ background: "var(--color-accent)", color: "white" }}
        >
          {saving ? "Saving..." : "Done"}
        </button>
      </div>
    </div>
  );
}


function getCroppedBlob(imageSrc, crop) {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = crop.width;
      canvas.height = crop.height;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(
        img,
        crop.x, crop.y, crop.width, crop.height,
        0, 0, crop.width, crop.height
      );
      canvas.toBlob((blob) => resolve(blob), "image/jpeg", 0.92);
    };
    img.src = imageSrc;
  });
}
