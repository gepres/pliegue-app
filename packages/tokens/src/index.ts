export const primitiveColors = [
  { name: "paper/50", variable: "--pliegue-paper-50", value: "#fbf6ec" },
  { name: "paper/100", variable: "--pliegue-paper-100", value: "#f0e5d2" },
  { name: "paper/200", variable: "--pliegue-paper-200", value: "#d8c9b2" },
  { name: "ink/900", variable: "--pliegue-ink-900", value: "#25231f" },
  { name: "ink/950", variable: "--pliegue-ink-950", value: "#171614" },
  { name: "ink/800", variable: "--pliegue-ink-800", value: "#211f1c" },
  { name: "forest/500", variable: "--pliegue-forest-500", value: "#365b48" },
  { name: "forest/300", variable: "--pliegue-forest-300", value: "#7fa58d" },
  { name: "ochre/500", variable: "--pliegue-ochre-500", value: "#c99232" },
  { name: "terracotta/500", variable: "--pliegue-terracotta-500", value: "#b9674f" },
  { name: "plum/500", variable: "--pliegue-plum-500", value: "#76566f" },
  { name: "white/1000", variable: "--pliegue-white-1000", value: "#ffffff" },
  { name: "danger/500", variable: "--pliegue-danger-500", value: "#a9473e" },
] as const;

export const semanticTokens = [
  "bg/canvas",
  "bg/surface",
  "bg/subtle",
  "text/primary",
  "text/secondary",
  "action/primary",
  "text/on-action",
  "accent/warm",
  "border/default",
  "icon/default",
  "status/danger",
] as const;

export const spacingTokens = [
  { name: "2xs", value: "4px" },
  { name: "xs", value: "8px" },
  { name: "sm", value: "12px" },
  { name: "md", value: "16px" },
  { name: "lg", value: "24px" },
  { name: "xl", value: "32px" },
] as const;
