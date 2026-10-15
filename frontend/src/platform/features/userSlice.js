import { createSlice } from '@reduxjs/toolkit';

const initialState = {
  name: '',
  email: '',
  userId: null,
  noOfJoinedClasses: 0,
  noOfCreatedClasses: 0,
  isNotification: true,
};

const userSlice = createSlice({
  name: 'user',
  initialState,
  reducers: {
    setUserName: (state, action) => {
      state.name = action.payload;
    },
    setUserId(state, action) {
      state.userId = action.payload;
    },
    setUserMail(state, action) {
      state.email = action.payload;
    },
    setNoOfJoinedClasses(state, action) {
      state.noOfJoinedClasses = action.payload;
    },
    setNoOfCreatedClasses(state, action) {
      state.noOfCreatedClasses = action.payload;
    },
    setIsNotification(state, action) {
      state.isNotification = action.payload;
    },
  },
});

export const { setUserId, setUserName, setUserMail, setNoOfCreatedClasses, setNoOfJoinedClasses, setIsNotification } = userSlice.actions;

export default userSlice.reducer;
