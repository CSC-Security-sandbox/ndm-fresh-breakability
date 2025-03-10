import { Box } from "@components/container/index";
import { ReactNode } from "react";

const FormFrame = ({ children }: { children: ReactNode }) => {
  return (
    <Box className="h-3/5 w-9/12 mx-auto">
      <Box className="!bg-white mx-auto shadow-[rgba(0,_0,_0,_0.24)_0px_3px_8px]">
        {children}
      </Box>
    </Box>
  );
};

export default FormFrame;
