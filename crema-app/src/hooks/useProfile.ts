import { useCallback } from "react";
import { apiFetch } from "../api/client";

interface ProfileUpdate {
  display_name?: string;
  bio?: string;
  location?: string;
  coffee_preference?: string;
  brewing_style?: string;
  avatar_url?: string;
}

export function useProfile() {
  const updateProfile = useCallback(async (data: ProfileUpdate) => {
    return apiFetch("/auth/profile", {
      method: "PUT",
      body: JSON.stringify(data),
    });
  }, []);

  return { updateProfile };
}
