import { UserPermissionsApiType } from "@/app/type.interface";
import { createSlice, PayloadAction } from "@reduxjs/toolkit";

const initialState = {
  userPermissions: {} as UserPermissionsApiType,
};

export const permissionSlice = createSlice({
  name: "permissionSlice",
  initialState,
  reducers: {
    setUserPermissions: (
      state,
      action: PayloadAction<UserPermissionsApiType>
    ) => {
      state.userPermissions = action.payload;
    },
  },
});

export const { setUserPermissions } = permissionSlice.actions;
