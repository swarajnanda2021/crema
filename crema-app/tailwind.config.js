/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./app/**/*.{js,jsx,ts,tsx}",
    "./src/**/*.{js,jsx,ts,tsx}",
  ],
  presets: [require("nativewind/preset")],
  theme: {
    extend: {
      colors: {
        bg: "#FAF7F2",
        "card-front": "#FFFFFF",
        "card-back": "#2C1810",
        "text-primary": "#1A1A1A",
        "text-secondary": "#6B5B4F",
        "text-on-dark": "#F5F0EB",
        accent: "#C8553D",
        "accent-hover": "#A94432",
        like: "#E63946",
        "tag-bg": "#EDE8E1",
        "tag-text": "#5D4E42",
        border: "#E0D8CF",
        unavailable: "#B0A89F",
      },
      fontFamily: {
        serif: ["PlayfairDisplay", "Georgia", "serif"],
        sans: ["Inter", "system-ui", "sans-serif"],
      },
    },
  },
  plugins: [],
};
