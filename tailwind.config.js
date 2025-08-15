/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        // Use variable font as primary (recommended)
        satoshi: ["Satoshi-Variable", "sans-serif"],

        // Individual weight-specific families (if you prefer)
        "satoshi-light": ["Satoshi-Light", "sans-serif"],
        "satoshi-regular": ["Satoshi-Regular", "sans-serif"],
        "satoshi-medium": ["Satoshi-Medium", "sans-serif"],
        "satoshi-bold": ["Satoshi-Bold", "sans-serif"],
        "satoshi-black": ["Satoshi-Black", "sans-serif"],

        // Variable fonts (for maximum flexibility)
        "satoshi-variable": ["Satoshi-Variable", "sans-serif"],
        "satoshi-variable-italic": ["Satoshi-VariableItalic", "sans-serif"],
      },
    },
  },
  plugins: [],
};
