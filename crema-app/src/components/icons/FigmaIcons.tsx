/**
 * FigmaIcons — Exact SVG icons from the Figma design file.
 * Exported from Figma MCP localhost assets.
 * All paths and colors match the Figma source exactly.
 */
import Svg, { Path, Circle, G } from "react-native-svg";

interface IconProps {
  size?: number;
  color?: string;
}

/**
 * Heart button UNSELECTED — 31px circle with stroke-only heart.
 * Figma: circle #EFE9DB, heart stroke #351101.
 */
export function HeartIcon({ size = 31 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 31 31" fill="none">
      <Circle cx={15.5} cy={15.5} r={15.5} fill="#EFE9DB" />
      <Path
        d="M15.8997 20.9838L20.9686 15.8423C21.5005 15.3104 21.7994 14.5889 21.7994 13.8366C21.7994 13.0843 21.5005 12.3628 20.9686 11.8308C20.4366 11.2989 19.7151 11 18.9628 11C18.2105 11 17.489 11.2989 16.957 11.8308L15.8997 12.8155L14.8423 11.8308C14.3104 11.2989 13.5889 11 12.8366 11C12.0843 11 11.3628 11.2989 10.8308 11.8308C10.2989 12.3628 10 13.0843 10 13.8366C10 14.5889 10.2989 15.3104 10.8308 15.8423L15.8997 20.9838Z"
        stroke="#351101"
        strokeWidth={1.452}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

/**
 * Heart button SELECTED — 31px circle with filled purple heart.
 * Figma: circle #EFE9DB, heart fill+stroke #D798DA.
 */
export function HeartFilledIcon({ size = 31 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 31 31" fill="none">
      <Circle cx={15.5} cy={15.5} r={15.5} fill="#EFE9DB" />
      <Path
        d="M15.8997 20.9838L20.9686 15.8423C21.5005 15.3104 21.7994 14.5889 21.7994 13.8366C21.7994 13.0843 21.5005 12.3628 20.9686 11.8308C20.4366 11.2989 19.7151 11 18.9628 11C18.2105 11 17.489 11.2989 16.957 11.8308L15.8997 12.8155L14.8423 11.8308C14.3104 11.2989 13.5889 11 12.8366 11C12.0843 11 11.3628 11.2989 10.8308 11.8308C10.2989 12.3628 10 13.0843 10 13.8366C10 14.5889 10.2989 15.3104 10.8308 15.8423L15.8997 20.9838Z"
        fill="#D798DA"
        stroke="#D798DA"
        strokeWidth={1.452}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

/**
 * Share button — 31px circle with upload/share icon.
 * Figma: circle #E7D5B8, icon stroke #351101.
 */
export function ShareIcon({ size = 31 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 31 31" fill="none">
      <Circle cx={15.5} cy={15.5} r={15.5} fill="#E7D5B8" />
      <G>
        <Path
          d="M18.9571 13.5982H20.6365C20.785 13.5982 20.9274 13.6572 21.0324 13.7621C21.1374 13.8671 21.1963 14.0095 21.1963 14.158V20.8758C21.1963 21.0243 21.1374 21.1667 21.0324 21.2716C20.9274 21.3766 20.785 21.4356 20.6365 21.4356H10.5598C10.4113 21.4356 10.269 21.3766 10.164 21.2716C10.059 21.1667 10 21.0243 10 20.8758V14.158C10 14.0095 10.059 13.8671 10.164 13.7621C10.269 13.6572 10.4113 13.5982 10.5598 13.5982H12.2393"
          stroke="#351101"
          strokeWidth={1.5}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <Path
          d="M12.7993 10.7991L15.5984 8L18.3975 10.7991"
          stroke="#351101"
          strokeWidth={1.5}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <Path
          d="M15.5984 8V15.8374"
          stroke="#351101"
          strokeWidth={1.5}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </G>
    </Svg>
  );
}

/**
 * Cart button — 31px circle with shopping cart icon.
 *
 * Default: Espresso disc + white glyph. The card front uses this
 * default because the card's info panel is a constant beige
 * (`#EFE9DB`) in both light and dark mode — Espresso reads cleanly.
 *
 * For surfaces with a mode-flipping background (e.g. /coffee/[id],
 * which sits on `t.color.bg` and flips to `#2a0d00` in dark), pass
 * `fill={t.color["accent.cta"]}` + `glyph={t.color["text.on-cta"]}`
 * so the disc reads as a Crema-pink CTA against either page tone.
 */
interface CartIconProps {
  size?: number;
  /** Disc fill. Defaults to Espresso for card-front use. */
  fill?: string;
  /** Cart-glyph stroke. Defaults to white for card-front use. */
  glyph?: string;
}
export function CartIcon({
  size = 31,
  fill = "#351101",
  glyph = "#FFFFFF",
}: CartIconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 31 31" fill="none">
      <Circle cx={15.5} cy={15.5} r={15.5} fill={fill} />
      <Path
        d="M9.25 9.25H9.4348C9.7611 9.25 9.9245 9.25 10.0576 9.3089C10.1749 9.3608 10.2752 9.4443 10.3475 9.5503C10.4294 9.6703 10.459 9.8305 10.518 10.1502L12.0046 18.2024L19.1814 18.2023C19.4935 18.2023 19.65 18.2023 19.7793 18.1472C19.8935 18.0985 19.992 18.0196 20.0651 17.9193C20.1479 17.8058 20.1829 17.654 20.2529 17.3505L21.3341 12.6656C21.4405 12.2044 21.4938 11.9737 21.4353 11.7927C21.384 11.634 21.2761 11.4993 21.1329 11.4137C20.9696 11.3159 20.7336 11.3159 20.2605 11.3159H10.9716M19.5796 21.6455C19.1993 21.6455 18.891 21.3372 18.891 20.9569C18.891 20.5766 19.1993 20.2682 19.5796 20.2682C19.9599 20.2682 20.2682 20.5766 20.2682 20.9569C20.2682 21.3372 19.9599 21.6455 19.5796 21.6455ZM12.6932 21.6455C12.3129 21.6455 12.0046 21.3372 12.0046 20.9569C12.0046 20.5766 12.3129 20.2682 12.6932 20.2682C13.0735 20.2682 13.3818 20.5766 13.3818 20.9569C13.3818 21.3372 13.0735 21.6455 12.6932 21.6455Z"
        stroke={glyph}
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

/**
 * Heart outline — Figma 151:1826. For post action bars (unliked).
 */
export function HeartOutlineIcon({ size = 16, color = "#D798DA" }: IconProps) {
  const h = size * (15.8612 / 17.6743);
  return (
    <Svg width={size} height={h} viewBox="0 0 17.6743 15.8612" fill="none">
      <Path
        d="M8.83716 3.6416C7.05961 -0.530693 0.838193 -0.086306 0.838193 5.24637C0.838193 10.579 8.83716 15.0231 8.83716 15.0231C8.83716 15.0231 16.8361 10.579 16.8361 5.24637C16.8361 -0.086306 10.6147 -0.530693 8.83716 3.6416Z"
        stroke={color}
        strokeWidth={1.67639}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

/**
 * Heart filled — Figma 151:1826 filled variant. For post action bars (liked).
 */
export function HeartFilledOutlineIcon({ size = 16, color = "#D798DA" }: IconProps) {
  const h = size * (15.8612 / 17.6743);
  return (
    <Svg width={size} height={h} viewBox="0 0 17.6743 15.8612" fill="none">
      <Path
        d="M8.83716 3.6416C7.05961 -0.530693 0.838193 -0.086306 0.838193 5.24637C0.838193 10.579 8.83716 15.0231 8.83716 15.0231C8.83716 15.0231 16.8361 10.579 16.8361 5.24637C16.8361 -0.086306 10.6147 -0.530693 8.83716 3.6416Z"
        fill={color}
        stroke={color}
        strokeWidth={1.67639}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

/**
 * Users icon — two people silhouette for friends badge.
 * Figma: stroke #351101, no background.
 */
export function UsersIcon({ size = 17, color = "#351101" }: IconProps) {
  return (
    <Svg width={size} height={size * (12.375 / 14.5)} viewBox="0 0 14.5 12.375" fill="none">
      <Path
        d="M13.625 11.5C13.625 10.2663 12.4424 9.2168 10.7917 8.8278M9.375 11.5C9.375 9.9352 7.4722 8.6667 5.125 8.6667C2.7778 8.6667 0.875 9.9352 0.875 11.5M9.375 6.5417C10.9398 6.5417 12.2083 5.2731 12.2083 3.7083C12.2083 2.1435 10.9398 0.875 9.375 0.875M5.125 6.5417C3.5602 6.5417 2.2917 5.2731 2.2917 3.7083C2.2917 2.1435 3.5602 0.875 5.125 0.875C6.6898 0.875 7.9583 2.1435 7.9583 3.7083C7.9583 5.2731 6.6898 6.5417 5.125 6.5417Z"
        stroke={color}
        strokeWidth={1.75}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

/**
 * Comment bubble — Figma 151:1823. Circular speech bubble with tail.
 */
export function CommentBubbleIcon({ size = 14, color = "#D798DA" }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 15.9255 15.9255" fill="none">
      <Path
        d="M4.4082 14.1388C5.45432 14.7421 6.66809 15.0873 7.96248 15.0873C11.8973 15.0873 15.0873 11.8976 15.0873 7.96276C15.0873 4.02796 11.8976 0.838184 7.96276 0.838184C4.02796 0.838184 0.838184 4.02796 0.838184 7.96276C0.838184 9.25715 1.18336 10.4709 1.7867 11.517L1.78903 11.5211C1.84709 11.6217 1.87636 11.6725 1.88962 11.7205C1.90213 11.7657 1.90562 11.8064 1.90242 11.8532C1.89897 11.9035 1.88202 11.9557 1.84725 12.06L1.23863 13.8859L1.23787 13.8883C1.10945 14.2735 1.04525 14.4661 1.09101 14.5944C1.13092 14.7063 1.2195 14.7947 1.3314 14.8346C1.45946 14.8802 1.65121 14.8163 2.03475 14.6885L2.03953 14.6867L3.86537 14.0781C3.96933 14.0434 4.02219 14.0259 4.07242 14.0224C4.11925 14.0192 4.15964 14.0235 4.20489 14.036C4.25298 14.0493 4.30376 14.0785 4.40493 14.1369L4.4082 14.1388Z"
        stroke={color} strokeWidth={1.67637} strokeLinecap="round" strokeLinejoin="round"
      />
    </Svg>
  );
}

/**
 * Share upload — Figma 151:1827. Upload box with arrow for post action bars.
 */
export function ShareNodesIcon({ size = 12, color = "#D798DA" }: IconProps) {
  const h = size * (15.9257 / 13.5506);
  return (
    <Svg width={size} height={h} viewBox="0 0 13.5506 15.9257" fill="none">
      <Path d="M10.3376 6.77553H12.1187C12.2762 6.77553 12.4272 6.83808 12.5386 6.94943C12.6499 7.06077 12.7125 7.21178 12.7125 7.36925V14.4938C12.7125 14.6513 12.6499 14.8023 12.5386 14.9136C12.4272 15.025 12.2762 15.0875 12.1187 15.0875H1.4319C1.27444 15.0875 1.12342 15.025 1.01208 14.9136C0.900736 14.8023 0.838184 14.6513 0.838184 14.4938V7.36925C0.838184 7.21178 0.900736 7.06077 1.01208 6.94943C1.12342 6.83808 1.27444 6.77553 1.4319 6.77553H3.21304" stroke={color} strokeWidth={1.67637} strokeLinecap="round" strokeLinejoin="round" />
      <Path d="M3.80698 3.80675L6.77555 0.838184L9.74412 3.80675" stroke={color} strokeWidth={1.67637} strokeLinecap="round" strokeLinejoin="round" />
      <Path d="M6.77553 0.838184V9.15016" stroke={color} strokeWidth={1.67637} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

/**
 * Café tag icon — heart shape, accent purple. Matches icon_cafe.svg and
 * the HeroHeartIcon used on user profiles. Distinguishes "Tag a café"
 * rows from the plain location pin.
 */
export function PostCafeIcon({ size = 12, color = "#D798DA" }: IconProps) {
  const h = size * (16 / 16.9667);
  return (
    <Svg width={size} height={h} viewBox="0 0 16.9667 16.0002" fill="none">
      <Path
        d="M8.48333 3.6159C6.76481 -0.649079 0.75 -0.19482 0.75 5.25632C0.75 10.7075 8.48333 15.2502 8.48333 15.2502C8.48333 15.2502 16.2167 10.7075 16.2167 5.25632C16.2167 -0.19482 10.2019 -0.649079 8.48333 3.6159Z"
        stroke={color}
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

/**
 * Coffee drink icon — steaming cup. Used for the "Tag a drink" compose row.
 */
export function PostDrinkIcon({ size = 12, color = "#D798DA" }: IconProps) {
  const h = size * (16.55 / 16.55);
  return (
    <Svg width={size} height={h} viewBox="0 0 16.55 16.55" fill="none">
      <Path
        d="M0.75 15.8H6.556M6.556 15.8H6.651M6.556 15.8C3.345 15.775 0.75 13.01 0.75 9.604V5.994C0.75 5.543 1.095 5.177 1.522 5.177H11.685C12.111 5.177 12.457 5.543 12.457 5.994V6.062M6.651 15.8H12.457M6.651 15.8C9.862 15.775 12.457 13.01 12.457 9.604M12.457 6.062H13.711C14.866 6.062 15.802 7.053 15.802 8.276C15.802 9.498 14.866 10.489 13.711 10.489H12.457V9.604M12.457 6.062V9.604M9.948 0.75L9.112 2.521M7.44 0.75L6.603 2.521M4.931 0.75L4.095 2.521"
        stroke={color}
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

/**
 * Post location pin — Figma 151:1791. Map pin with inner circle for post location rows.
 */
export function PostLocationPinIcon({ size = 12, color = "#D798DA" }: IconProps) {
  const h = size * (15.2881 / 12.3262);
  return (
    <Svg width={size} height={h} viewBox="0 0 12.3262 15.2881" fill="none">
      <Path d="M0.628714 6.10212C0.628714 9.93811 3.98452 13.1103 5.46988 14.3265C5.68246 14.5006 5.79003 14.5887 5.94862 14.6333C6.07212 14.6681 6.25388 14.6681 6.37737 14.6333C6.53627 14.5886 6.64308 14.5014 6.85646 14.3266C8.34182 13.1104 11.6975 9.93846 11.6975 6.10247C11.6975 4.65079 11.1144 3.25839 10.0765 2.23189C9.03859 1.20539 7.63099 0.628714 6.16318 0.628714C4.69536 0.628714 3.2876 1.20548 2.2497 2.23198C1.2118 3.25847 0.628714 4.65043 0.628714 6.10212Z" stroke={color} strokeWidth={1.25743} strokeLinecap="round" strokeLinejoin="round" />
      <Path d="M4.58186 5.37249C4.58186 6.24579 5.28981 6.95374 6.16311 6.95374C7.03642 6.95374 7.74437 6.24579 7.74437 5.37249C7.74437 4.49918 7.03642 3.79123 6.16311 3.79123C5.28981 3.79123 4.58186 4.49918 4.58186 5.37249Z" stroke={color} strokeWidth={1.25743} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}
