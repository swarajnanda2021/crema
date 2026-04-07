/**
 * Community API client.
 * Uses dynamic host so LAN users hit the same backend.
 */

const API_BASE = `http://${window.location.hostname}:8000/api`;

function getToken() {
  return localStorage.getItem("coffee_session_token");
}

export function setToken(token) {
  if (token) {
    localStorage.setItem("coffee_session_token", token);
  } else {
    localStorage.removeItem("coffee_session_token");
  }
}

export async function apiFetch(path, options = {}) {
  const token = getToken();
  const headers = {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...options.headers,
  };

  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers,
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.detail || `API error: ${response.status}`);
  }

  if (response.status === 204) return null;
  return response.json();
}

/**
 * Fire-and-forget click tracking. Never blocks navigation.
 */
export function trackClick(productId, roasterSlug, sourcePage) {
  const token = getToken();
  fetch(`${API_BASE}/clicks`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({
      product_id: productId,
      roaster_slug: roasterSlug,
      source_page: sourcePage,
    }),
  }).catch(() => {
    // Silently fail — never block user
  });
}
