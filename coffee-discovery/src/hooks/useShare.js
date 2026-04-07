import { useCallback } from "react";

export function useShare() {
  const share = useCallback(async (coffee) => {
    const url = `${window.location.origin}/coffee/${coffee.product_id}`;
    const text = `Check out ${coffee.coffee_name} from ${coffee.roaster_name}${
      coffee.tasting_notes ? ` — ${coffee.tasting_notes}` : ""
    }. ${coffee.price_inr ? `₹${coffee.price_inr}` : ""}${
      coffee.weight_grams ? ` for ${coffee.weight_grams}g` : ""
    }.`;

    if (navigator.share) {
      try {
        await navigator.share({ title: coffee.coffee_name, text, url });
        return true;
      } catch {
        /* user cancelled */
      }
    }
    return false;
  }, []);

  const copyLink = useCallback(async (coffee) => {
    const url = `${window.location.origin}/coffee/${coffee.product_id}`;
    try {
      await navigator.clipboard.writeText(url);
      return true;
    } catch {
      return false;
    }
  }, []);

  const whatsappUrl = useCallback((coffee) => {
    const url = `${window.location.origin}/coffee/${coffee.product_id}`;
    const text = `Check out ${coffee.coffee_name} from ${coffee.roaster_name}${
      coffee.tasting_notes ? ` — ${coffee.tasting_notes}` : ""
    }. ${url}`;
    return `https://wa.me/?text=${encodeURIComponent(text)}`;
  }, []);

  const twitterUrl = useCallback((coffee) => {
    const url = `${window.location.origin}/coffee/${coffee.product_id}`;
    const text = `${coffee.coffee_name} from ${coffee.roaster_name}${
      coffee.tasting_notes ? ` — ${coffee.tasting_notes}` : ""
    }`;
    return `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}`;
  }, []);

  return { share, copyLink, whatsappUrl, twitterUrl };
}
