# Crema App

React Native (Expo) frontend for the Crema coffee community platform.

## Stack

- **Expo SDK 54** with Expo Router (file-based navigation)
- **React Native 0.81** + **React 19**
- **TypeScript** (strict mode)
- Fonts: Canela Text (display), Inter (body)

## Quick Start

```bash
npm install
npx expo start --web --port 8082    # Web
npx expo start                       # Native (scan QR with Expo Go)
```

Requires the backend running at `localhost:8000`. See the root README for backend setup.

## Architecture

### Design Tokens (`src/tokens/`)

All visual values live in `design-tokens.json` — a language-agnostic JSON file. The same file can be read by Swift, Kotlin, or any other platform to achieve visual parity without translation.

```typescript
import { t, font, shadow, sp } from "../tokens/useTokens";

backgroundColor: t.color.bg              // "#FAF8F0"
fontFamily: t.font["body.semibold"]      // "Inter_600SemiBold"
padding: sp("lg")                         // 16
style={font("body.semibold", "font.md")} // { fontFamily: "...", fontSize: 14 }
style={shadow("card")}                    // { shadowColor, shadowOffset, ... }
```

Token categories: `color`, `font`, `size`, `spacing`, `radius`, `shadow`, `shelf`, `lineHeight`.

### API Client (`src/api/client.ts`)

Single `apiFetchRaw<T>(path)` function for all API calls:
- Injects `Authorization: Bearer {token}` automatically
- Cross-platform token storage (SecureStore on native, localStorage on web)
- Cross-platform base URL (localhost on iOS, 10.0.2.2 on Android, window.location on web)
- Returns raw JSON — callers unwrap envelope with `res?.data ?? res`

Also: `apiUpload(path, formData)` for file uploads, `trackClick()` for analytics.

### Generic Resource Hook (`src/resources/useResource.ts`)

One hook for any backend resource:

```typescript
const { data: posts, loading, refetch, create, update, remove } = useResource<Post>("posts", { limit: 40 });
const { data: comments } = useResource<Comment>("post_comments", { parent: { resource: "posts", id: 42 } });
```

Handles envelope unwrapping, pagination, nested resources, and mutations.

### Toggle Hook (`src/resources/useToggle.ts`)

Like/follow with optimistic update and rollback:

```typescript
const like = useToggle("post_likes", post.id, { initial: post.liked_by_me, count: post.like_count });
// like.toggled, like.count, like.toggle()
```

### Type Definitions (`src/resources/types.ts`)

TypeScript interfaces: `User`, `Post`, `Comment`, `Product`, `ShelfEntry`, `TastingNote`, `Notification`, `RoasterProfile`, `Envelope<T>`, `ToggleResult`.

## Screens

| Path | File | Description |
|---|---|---|
| `/` | `app/(tabs)/index.tsx` | Post feed with compose, like, comment, repost |
| `/browse` | `app/(tabs)/browse.tsx` | Beans tab (search + filters) and Roasters tab |
| `/profile` | `app/(tabs)/profile.tsx` | Own profile: shelves, posts, following, edit |
| `/auth` | `app/auth.tsx` | Login / register |
| `/coffee/:id` | `app/coffee/[id].tsx` | Product detail, shelf, tasting notes |
| `/roaster/:slug` | `app/roaster/[slug].tsx` | Roaster profile (split panel layout) |
| `/user/:username` | `app/user/[username].tsx` | Public user profile |

## Component Organization

```
src/components/
  domain/          PostCard, EditableCoffeeCard
  primitives/      Avatar, ActionBar, CommentThread, Toggle, TimeAgo
  shell/           PostModal, Navbar, ProfileDropdown
  ComposePost.tsx  Unified compose (article/note/repost)
  ImageUploadModal.tsx
  TastingNoteForm.tsx, TastingNoteDisplay.tsx
  CoffeeLabel.tsx, CoffeeList.tsx
  Chip.tsx, PopularityModal.tsx
```

## iOS Migration Path

This architecture was designed for cross-platform portability:

1. **`design-tokens.json`** is pure JSON — Swift reads it directly as `Codable` structs
2. **`types.ts`** maps 1:1 to Swift `Codable` structs (fields are already snake_case from the Python backend)
3. **`useResource<T>`** maps to a Swift `@Observable class Resource<T: Codable>`
4. **`useToggle`** maps to a Swift `@Observable class Toggle`
5. **The envelope** `{ data, meta }` needs one Swift `Envelope<T: Codable>` generic decoder
6. **The backend stays unchanged** — iOS app talks to the same API
