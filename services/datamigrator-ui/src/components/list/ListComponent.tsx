import { memo } from "react";
import Box from "@components/container/Box";
import { Tooltip } from "@netapp/bxp-design-system-react";
import { ListComponentPropsType } from "@/components/list/list-component.types";
import RenderEach from "../render-each/RenderEach";

const ListComponent = ({ itemsList, styles }: ListComponentPropsType) => {
  return (
    <>
      <RenderEach
        renderList={itemsList}
        renderItem={({ label, value, extraContent, tooltip }, index) => (
          <Box key={index} className="flex items-center my-1 gap-2">
            {(tooltip || extraContent) && (
              <Box className="flex items-center">
                {tooltip && <Tooltip>{tooltip}</Tooltip>}
                {extraContent}
              </Box>
            )}

            <Box className="flex items-center gap-1">
              {label && <span>{label}: </span>}
              <span className="font-light">{value}</span>
            </Box>
          </Box>
        )}
      ></RenderEach>
    </>
  );
};

export default memo(ListComponent);
