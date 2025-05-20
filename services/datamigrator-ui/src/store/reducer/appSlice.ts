import { createSlice, PayloadAction } from "@reduxjs/toolkit";

interface appSliceType {
  project: string;
  account: string;
  allProjectList: any[];
}

const initialState: appSliceType = {
  project: localStorage.getItem("selected_project_id") || "",
  account: "",
  allProjectList: [],
};

export const appSlice = createSlice({
  name: "appSlice",
  initialState,
  reducers: {
    setProject: (state, action: PayloadAction<string>) => {
      state.project = action.payload;
      localStorage.setItem("selected_project_id", action.payload);
    },
    setAccount: (state, action: PayloadAction<string>) => {
      state.account = action.payload;
    },
    setAllProjectList: (state, action: PayloadAction<any[]>) => {
      state.allProjectList = action.payload;
    },
  },
});

export const { setProject, setAccount, setAllProjectList } = appSlice.actions;
