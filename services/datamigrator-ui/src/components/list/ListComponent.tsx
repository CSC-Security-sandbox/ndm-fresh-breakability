import { memo } from "react";
import Box from "@components/container/Box";
import { Tooltip } from "@netapp/bxp-design-system-react";
import { ListComponentPropsType } from "@/components/list/list-component.types";
import RenderEach from "@components/render-each/RenderEach";
import { Show } from "@components/show/Show";

const ListComponent = ({ itemsList }: ListComponentPropsType) => (
  <RenderEach
    renderList={itemsList}
    renderItem={({ label, value, tooltip, children }) => (
      <Box className="flex items-center my-1 gap-2">
        <Show>
          <Show.When isTrue={Boolean(tooltip)}>
            <Tooltip>{tooltip}</Tooltip>
          </Show.When>
        </Show>

        {children}

        <Show>
          <Show.When isTrue={Boolean(label)}>
            <Box className="flex items-center gap-1 text-sm">
              <span>{label}: </span>
              <span className="font-light">{value}</span>
            </Box>
          </Show.When>
        </Show>
      </Box>
    )}
  />
);

export default memo(ListComponent);

/* Sample usage of ListComponent
const itemsList = [
  {
    label: "Item 1",
    value: "Value 1",
    extraContent: <InfoIcon className="w-4" />,
    tooltip: "This is a tooltip for Item 1",
  }]
  {<ListComponent itemsList={itemsList} />; }

Note: The `InfoIcon` components is imported from the appropriate libraries for sample code snippets. */
