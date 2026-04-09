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
 * Figma: circle #351101 (dark), cart icon stroke white.
 */
export function CartIcon({ size = 31 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 31 31" fill="none">
      <Circle cx={15.5} cy={15.5} r={15.5} fill="#351101" />
      <Path
        d="M9.25 9.25H9.4348C9.7611 9.25 9.9245 9.25 10.0576 9.3089C10.1749 9.3608 10.2752 9.4443 10.3475 9.5503C10.4294 9.6703 10.459 9.8305 10.518 10.1502L12.0046 18.2024L19.1814 18.2023C19.4935 18.2023 19.65 18.2023 19.7793 18.1472C19.8935 18.0985 19.992 18.0196 20.0651 17.9193C20.1479 17.8058 20.1829 17.654 20.2529 17.3505L21.3341 12.6656C21.4405 12.2044 21.4938 11.9737 21.4353 11.7927C21.384 11.634 21.2761 11.4993 21.1329 11.4137C20.9696 11.3159 20.7336 11.3159 20.2605 11.3159H10.9716M19.5796 21.6455C19.1993 21.6455 18.891 21.3372 18.891 20.9569C18.891 20.5766 19.1993 20.2682 19.5796 20.2682C19.9599 20.2682 20.2682 20.5766 20.2682 20.9569C20.2682 21.3372 19.9599 21.6455 19.5796 21.6455ZM12.6932 21.6455C12.3129 21.6455 12.0046 21.3372 12.0046 20.9569C12.0046 20.5766 12.3129 20.2682 12.6932 20.2682C13.0735 20.2682 13.3818 20.5766 13.3818 20.9569C13.3818 21.3372 13.0735 21.6455 12.6932 21.6455Z"
        stroke="#FFFFFF"
        strokeWidth={1.5}
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
