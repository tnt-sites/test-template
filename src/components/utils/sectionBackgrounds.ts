// Classes for the "Background" field on page sections. "on-dark" turns text
// white and recolours the heading bar (see src/styles/base/_typography.pcss).
const backgrounds: Record<string, string> = {
  white: "bg-white",
  cream: "bg-cream",
  navy: "bg-navy on-dark",
  green: "bg-green on-dark on-green",
};

export function sectionBackground(name: string) {
  return backgrounds[name] ?? backgrounds.white;
}
