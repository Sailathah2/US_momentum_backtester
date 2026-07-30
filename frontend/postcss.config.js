/**
 * PostCSS runs Tailwind over our stylesheet and then adds any browser
 * prefixes that older browsers need. You should never have to edit this file.
 */
export default {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
};
