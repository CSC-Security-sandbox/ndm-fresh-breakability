import React, { useEffect } from 'react';
import { useDispatch } from 'react-redux';

interface RefreshProps {
  // dispatch: (action: any) => void;
  api: any;
  tag: string;
}

// export const RefreshTable = ({dispatch, api, tag}: RefreshProps): void => {
//   console.log("refreshJobList", api, tag);
//   // dispatch1(api.util.invalidateTags([tag]));

//   // useEffect(() => {
//   //   fetchData();
//   // }, []); 

//   // const fetchData = () => {
//   //   const dispatch = useDispatch();
//   //   dispatch(api.util.invalidateTags([tag]));
//   // }

//   // return null;
// };

const useRefresh = ({api, tag}: RefreshProps) => {
  const dispatch = useDispatch();
  
  useEffect(() => {
    dispatch(api.util.invalidateTags([tag]));
  }, [])

  return null;
}

export default useRefresh;