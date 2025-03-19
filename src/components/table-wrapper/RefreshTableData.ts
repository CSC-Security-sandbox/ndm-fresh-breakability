import React, { useEffect } from 'react';
import { useDispatch } from 'react-redux';
import { Dispatch } from "@reduxjs/toolkit";

interface RefreshTableDataProps {
  // dispatch: (action: any) => void;
  api: any;
  tag: string;
}

function RefreshTableData (
  dispatch: Dispatch
) {
  // const dispatch = useDispatch();

  const recallApiData = ({api, tag}: RefreshTableDataProps) => {
    dispatch(api.util.invalidateTags([tag]));
  };

  return {
    recallApiData,
  };
};

export default RefreshTableData;