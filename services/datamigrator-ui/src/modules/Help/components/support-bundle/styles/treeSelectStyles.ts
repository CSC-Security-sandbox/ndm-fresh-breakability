export const TREE_SELECT_CONFIG = {
  MAX_VISIBLE_ITEMS: 1,
  TREE_SELECT_WRAPPER_CLASS: "tree-select-wrapper",
  COUNT_INDICATOR_CLASS: "count-indicator",
  TIMER_DELAY: 100,
} as const;

export const createTreeSelectStyles = (
  wrapperClass: string,
  maxItems: number
): string => `
  /* Enable flex wrapping for value container */
  .${wrapperClass} .select__value-container,
  .${wrapperClass} .select__value-container--is-multi,
  .${wrapperClass} .select__value-container--has-value,
  .${wrapperClass} .css-hundvm,
  .${wrapperClass} [class*="css-"] {
    flex-wrap: wrap !important;
    -webkit-flex-wrap: wrap !important;
    -ms-flex-wrap: wrap !important;
  }
  
  /* Style selected items with tag appearance */
  .${wrapperClass} .select__multi-value {
    background-color: var(--tag-1-bg) !important;
    border-radius: 50px !important;
    padding: 2px 10px !important;
  }
  
  /* Label styling for selected items */
  .${wrapperClass} .select__multi-value__label {
    color: var(--tag-1-text) !important;
    font-size: 14px !important;
  }
  
  /* Remove button styling */
  .${wrapperClass} .select__multi-value__remove {
    color: var(--tag-1-text) !important;
  }
  
  .${wrapperClass} .select__multi-value__remove:hover {
    background-color: #d1d5db !important;
    color: #374151 !important;
  }
  
  /* Hide items beyond the maximum visible limit */
  .${wrapperClass} .select__multi-value:nth-child(n+${maxItems + 1}) {
    display: none !important;
  }
`;

export const COUNT_INDICATOR_STYLES = {
  backgroundColor: "var(--tag-1-bg)",
  borderRadius: "50px",
  padding: "2px 6px",
  fontSize: "12px",
  color: "var(--tag-1-text)",
  marginLeft: "4px",
  display: "inline-flex",
  alignItems: "center",
} as const;

export const createCountIndicator = (
  wrapperClass: string,
  countClass: string,
  hiddenCount: number
): void => {
  const wrapper = document.querySelector(`.${wrapperClass}`);
  const valueContainer = wrapper?.querySelector(".select__value-container");

  if (!valueContainer) return;

  const existingCount = valueContainer.querySelector(`.${countClass}`);
  existingCount?.remove();

  const countElement = document.createElement("span");
  countElement.className = countClass;
  Object.assign(countElement.style, COUNT_INDICATOR_STYLES);
  countElement.textContent = `+${hiddenCount}`;
  valueContainer.appendChild(countElement);
};

export const removeCountIndicator = (
  wrapperClass: string,
  countClass: string
): void => {
  const wrapper = document.querySelector(`.${wrapperClass}`);
  const valueContainer = wrapper?.querySelector(".select__value-container");
  const existingCount = valueContainer?.querySelector(`.${countClass}`);
  existingCount?.remove();
};
