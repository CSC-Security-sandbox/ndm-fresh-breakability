import { createSlice, PayloadAction } from "@reduxjs/toolkit";

interface appSliceType {
  project: string;
  account: string;
  allProjectList: any[];
  theme: "light" | "dark";
}

const initialState: appSliceType = {
  project: "",
  account: "",
  allProjectList: [],
  theme: "light",
};

export const appSlice = createSlice({
  name: "appSlice",
  initialState,
  reducers: {
    setProject: (state, action: PayloadAction<string>) => {
      state.project = action.payload;
    },
    setAccount: (state, action: PayloadAction<string>) => {
      state.account = action.payload;
    },
    setAllProjectList: (state, action: PayloadAction<any[]>) => {
      state.allProjectList = action.payload;
    },
    setTheme: (state, action: PayloadAction<"light" | "dark">) => {
      state.theme = action.payload;
    },
  },
});

export const { setProject, setAccount, setAllProjectList, setTheme } =
  appSlice.actions;
