import { RadioButton } from "@netapp/bxp-design-system-react";
import RenderEach from "@components/render-each/RenderEach";
import { RadioButtonGroupPropsType } from "@components/radio-button/radio-button-group.types";

const RadioButtonGroup = ({
  options,
  form,
  name,
  disabled = false,
}: RadioButtonGroupPropsType) => {
  return (
    <RenderEach
      renderList={options}
      renderItem={({ label, value }) => (
        <RadioButton
          key={value}
          form={form}
          name={name}
          value={value}
          disabled={disabled}
        >
          {label}
        </RadioButton>
      )}
    ></RenderEach>
  );
};

export default RadioButtonGroup;

/* Sample usage of RadioButtonGroup
const RADIO_BUTTON_OPTIONS = [
    { label: "Option 1", value: "1" },
    { label: "Option 2", value: "2" },
    { label: "Option 3", value: "3" },
  ];
{
  <RadioButtonGroup
  options={RADIO_BUTTON_OPTIONS}
  form={form_name}
  name="radioGroupName"
/>; 
} */
