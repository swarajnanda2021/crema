import { useCallback } from "react";
import { Share, Platform } from "react-native";
import * as Clipboard from "expo-clipboard";

function buildShareText(coffee: any): string {
  const parts = [coffee.coffee_name];
  if (coffee.roaster_name) parts.push(`from ${coffee.roaster_name}`);
  if (coffee.tasting_notes) parts.push(`\u2014 ${coffee.tasting_notes}`);
  return parts.join(" ");
}

function buildShareUrl(coffee: any): string {
  return coffee.product_url || "";
}

export function useShare() {
  const share = useCallback(async (coffee: any) => {
    const text = buildShareText(coffee);
    const url = buildShareUrl(coffee);
    try {
      await Share.share({
        message: Platform.OS === "ios" ? text : `${text}\n${url}`,
        url: Platform.OS === "ios" ? url : undefined,
        title: coffee.coffee_name,
      });
      return true;
    } catch {
      return false;
    }
  }, []);

  const copyLink = useCallback(async (coffee: any) => {
    const url = buildShareUrl(coffee);
    if (!url) return false;
    await Clipboard.setStringAsync(url);
    return true;
  }, []);

  return { share, copyLink };
}
