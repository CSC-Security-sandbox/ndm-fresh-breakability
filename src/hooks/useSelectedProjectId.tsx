"use client";
import { useSelector } from "react-redux";
import { RootStateType } from "@store/store";

const useSelectedProjectId = () => {
  const selectedProjectId = useSelector(
    (state: RootStateType) => state.appSlice.project
  );

  return {
    selectedProjectId,
  };
};

export default useSelectedProjectId;
