/**
 * Simple {{varName}} interpolation for field guide templates.
 * Unknown variables are left as-is so the output makes missing context visible.
 */
const render = (text, ctx) => {
  if (!text) return "";
  return text.replace(/\{\{(\w+)\}\}/g, (match, key) => {
    const val = ctx[key];
    return val !== undefined && val !== null && val !== "" ? String(val) : match;
  });
};

export { render };
