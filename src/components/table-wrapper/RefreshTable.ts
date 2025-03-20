import React, { useEffect } from 'react';
import { useDispatch } from 'react-redux';
import { Dispatch } from "@reduxjs/toolkit";
import { ReactNode } from "react";

interface RefreshProps {
  dispatch: (action: any) => void;
  api: any;
  tag: string;
}

export const RefreshTable = ({dispatch, api, tag}: RefreshProps): void => {
  console.log("refreshJobList", api, tag);
  dispatch(api.util.invalidateTags([tag]));

  // useEffect(() => {
  //   fetchData();
  // }, []); 

  // const fetchData = () => {
  //   const dispatch = useDispatch();
  //   dispatch(api.util.invalidateTags([tag]));
  // }

  return null;
};
