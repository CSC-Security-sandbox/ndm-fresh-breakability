import React from 'react';
import { useDispatch } from 'react-redux';

interface RefreshProps {
  api: any;
  tag: string;
}

const useRTKApiRefresh = ({api, tag}: RefreshProps) => {
  const dispatch = useDispatch();

  const fetchData = () => {
    dispatch(api.util.invalidateTags([tag]));
  }

  return fetchData;
}

export default useRTKApiRefresh;