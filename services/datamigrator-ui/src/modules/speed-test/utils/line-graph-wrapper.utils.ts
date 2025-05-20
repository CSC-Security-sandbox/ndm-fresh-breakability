//Dynamic color generation
export const generateColors = (numColors: number) => {
  const colors = [
    "chart-9-gradient",
    "icon-primary",
    "chart-5",
    "chart-4",
    "chart-8",
    "chart-7",
    "chart-2",
    "chart-3",
    "chart-6",
    "chart-10",
  ];
  return colors.slice(0, numColors);
};
