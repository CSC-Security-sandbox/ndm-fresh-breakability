export const formatDateToYMD = (rawDate: Date) => {
  const date = new Date(rawDate);
  return date.toLocaleDateString("en-CA");
};
