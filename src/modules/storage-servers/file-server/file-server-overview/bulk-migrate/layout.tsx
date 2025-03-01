"use client";
import { Box } from "@components/container/index";
import React from "react";

const layout = ({ children }: { children: React.ReactNode }) => {
  return <Box>{children}</Box>;
};

export default layout;
