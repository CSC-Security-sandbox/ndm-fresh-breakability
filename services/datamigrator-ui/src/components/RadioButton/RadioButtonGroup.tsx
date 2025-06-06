import { RadioButton } from "@netapp/bxp-design-system-react";
import { Box } from "@/components/container";
import { RadioButtonGroupPropsType } from "@components/RadioButton/radio-button-group.types";
import RenderEach from "@components/render-each/RenderEach";

const RadioButtonGroup = ({
  options,
  form,
  name,
  style,
}: RadioButtonGroupPropsType) => {
  return (
    <Box className={style}>
      <RenderEach
        renderList={options}
        renderItem={({ label, value }) => (
          <RadioButton key={value} form={form} name={name} value={value}>
            {label}
          </RadioButton>
        )}
      ></RenderEach>
    </Box>
  );
};

export default RadioButtonGroup;
