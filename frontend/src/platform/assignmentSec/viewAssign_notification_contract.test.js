import React from 'react';
import { render, screen } from '@testing-library/react';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import toggleReducer from '../features/toggleSlice';
import userReducer from '../features/userSlice';
import sidebarReducer from '../features/sidebarSlice';
import AssignmentDetails from './viewAssign';

jest.mock('../sidebar/sidebar', () => () => <div data-testid="sidebar" />);
jest.mock('../header/header', () => () => <div data-testid="header" />);
jest.mock('./createAssignModal', () => () => <div data-testid="modal" />);
jest.mock('./studentSubmission', () => ({
  ChatBox: () => <div data-testid="chatbox" />,
  default: () => <div data-testid="submissions" />,
}));

let mockLocationState = null;
jest.mock('react-router-dom', () => ({
  ...jest.requireActual('react-router-dom'),
  useNavigate: () => jest.fn(),
  useLocation: () => ({ state: mockLocationState, pathname: '/assignment-details' }),
}));

const createStore = () => configureStore({
  reducer: {
    toggleState: toggleReducer,
    user: userReducer,
    sidebar: sidebarReducer,
  },
  preloadedState: {
    sidebar: { width: '250px' },
    toggleState: { isEnrolled: true },
    user: { name: 'Student Alex', email: 'alex@example.com' },
  },
});

describe('AssignmentDetails Notification Navigation Contract Verification', () => {
  beforeEach(() => {
    sessionStorage.clear();
    localStorage.clear();
  });

  test('Incomplete old navigation state causes active assignment to appear archived', () => {
    // Old flawed navigation: only passed { assignment: { _id: '101' } } without classroom or classCode
    mockLocationState = {
      assignment: { _id: 'assign-old-101' },
      assignmentId: 'assign-old-101',
    };

    render(
      <Provider store={createStore()}>
        <AssignmentDetails />
      </Provider>
    );

    // Because assignment has no classroom and classCode is missing, it is misclassified as historical/archived
    expect(screen.getByText(/This class is no longer active/i)).toBeInTheDocument();
    expect(screen.getByText(/No submission recorded for this archived assignment/i)).toBeInTheDocument();
  });

  test('New complete navigation contract correctly renders active assignment without archived banner', () => {
    const fullAssignment = {
      _id: 'assign-new-101',
      name: 'Physics Lab 1',
      title: 'Physics Lab 1',
      description: 'Perform velocity measurements',
      dueDate: '2026-10-30',
      createdAt: 'Oct 15, 2026',
      status: 'Due',
      classroom: {
        _id: 'class-phys-101',
        name: 'Physics 101',
        code: 'PHYS101',
      },
    };

    // New fixed navigation from Header: supplies full assignment object, classCode, className
    mockLocationState = {
      assignment: fullAssignment,
      classCode: 'PHYS101',
      className: 'Physics 101',
      assignmentId: 'assign-new-101',
    };

    render(
      <Provider store={createStore()}>
        <AssignmentDetails />
      </Provider>
    );

    // Genuinely active assignment is NOT classified as archived
    expect(screen.queryByText(/This class is no longer active/i)).toBeNull();
    expect(screen.queryByText(/No submission recorded for this archived assignment/i)).toBeNull();

    // Renders active assignment details
    expect(screen.getByText('Physics Lab 1')).toBeInTheDocument();
    expect(screen.getByText('Perform velocity measurements')).toBeInTheDocument();
  });
});
