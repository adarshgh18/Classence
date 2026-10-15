import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import axios from 'axios';
import toggleReducer from '../features/toggleSlice';
import AttendanceDashboard from './attendanceStreakSec';

jest.mock('axios');
jest.mock('react-chartjs-2', () => ({
  Bar: () => <div data-testid="bar-chart">Bar Chart</div>,
}));
jest.mock('./attendanceChart', () => () => <div data-testid="animated-graph">Animated Graph</div>);

const createStore = (isEnrolled = true) => configureStore({
  reducer: {
    toggleState: toggleReducer,
  },
  preloadedState: {
    toggleState: { isEnrolled },
  },
});

describe('AttendanceDashboard Heading Verification', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('Teacher / Created mode (isEnrolled = false) renders "Class Attendance Overview"', async () => {
    axios.get.mockResolvedValueOnce({
      data: {
        success: true,
        isTeacher: true,
        totalPresent: 10,
        totalAbsent: 2,
        last7Lectures: [],
        lectureData: [],
      },
    });

    render(
      <Provider store={createStore(false)}>
        <AttendanceDashboard classCode="TEST_CLASS" />
      </Provider>
    );

    // Initial render and post-fetch both show Teacher heading
    expect(screen.getByText('Class Attendance Overview')).toBeInTheDocument();
    expect(screen.queryByText('Your Attendance')).toBeNull();

    await waitFor(() => {
      expect(screen.getByText('Class Attendance Overview')).toBeInTheDocument();
    });
    expect(screen.queryByText('Your Attendance')).toBeNull();
  });

  test('Student / Joined mode (isEnrolled = true) renders "Your Attendance"', async () => {
    axios.get.mockResolvedValueOnce({
      data: {
        success: true,
        isTeacher: false,
        totalPresent: 5,
        totalAbsent: 1,
        currentStreak: 2,
        longestStreak: 4,
        lectureData: [],
      },
    });

    render(
      <Provider store={createStore(true)}>
        <AttendanceDashboard classCode="TEST_CLASS" />
      </Provider>
    );

    expect(screen.getByText('Your Attendance')).toBeInTheDocument();
    expect(screen.queryByText('Class Attendance Overview')).toBeNull();

    await waitFor(() => {
      expect(screen.getByText('Your Attendance')).toBeInTheDocument();
    });
    expect(screen.queryByText('Class Attendance Overview')).toBeNull();
  });
});
