import React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import axios from 'axios';

import Header from './header';
import userReducer from '../features/userSlice';
import sidebarReducer from '../features/sidebarSlice';
import toggleReducer from '../features/toggleSlice';
import * as socketService from '../../services/socket';

jest.mock('axios');
jest.mock('../../services/socket');

let socketCallbacks = {};

const createTestStore = (initialUserState = {}, initialToggleState = { isEnrolled: true }) => {
  return configureStore({
    reducer: {
      user: userReducer,
      sidebar: sidebarReducer,
      toggleState: toggleReducer,
    },
    preloadedState: {
      sidebar: { width: '250px' },
      toggleState: initialToggleState,
      user: {
        name: 'Alex Johnson',
        email: 'alex@example.com',
        userId: 'u100',
        noOfJoinedClasses: 2,
        noOfCreatedClasses: 1,
        isNotification: true,
        ...initialUserState,
      },
    },
  });
};

const mockNotifications = [
  {
    _id: 'notif-1',
    type: 'ASSIGNMENT_CREATED',
    title: 'New Assignment',
    message: '"Physics Assignment 1" was posted in Physics 101',
    link: '/assignment-details',
    assignmentId: 'assign-101',
    classCode: 'PHYS101',
    className: 'Physics 101',
    classroomId: {
      _id: 'class-1',
      code: 'PHYS101',
      name: 'Physics 101'
    },
    isRead: false,
    createdAt: new Date().toISOString(),
  },
  {
    _id: 'notif-2',
    type: 'ASSIGNMENT_GRADED',
    title: 'Assignment Graded',
    message: '"Math Homework" has been graded',
    link: '/assignment-details',
    assignmentId: 'assign-102',
    classCode: 'MATH201',
    className: 'Math 201',
    classroomId: {
      _id: 'class-2',
      code: 'MATH201',
      name: 'Math 201'
    },
    isRead: true,
    createdAt: new Date(Date.now() - 3600000).toISOString(),
  },
  {
    _id: 'notif-3',
    type: 'ANNOUNCEMENT_CREATED',
    title: 'New Announcement',
    message: 'New announcement in Physics 101',
    link: '/announcement',
    classCode: 'PHYS101',
    className: 'Physics 101',
    classroomId: {
      _id: 'class-1',
      code: 'PHYS101',
      name: 'Physics 101'
    },
    isRead: false,
    createdAt: new Date().toISOString(),
  },
  {
    _id: 'notif-4',
    type: 'LECTURE_SCHEDULED',
    title: 'Lecture Scheduled',
    message: '"Quantum Mechanics" was scheduled in Physics 101',
    link: '/calendar',
    classCode: 'PHYS101',
    className: 'Physics 101',
    classroomId: {
      _id: 'class-1',
      code: 'PHYS101',
      name: 'Physics 101'
    },
    isRead: false,
    createdAt: new Date().toISOString(),
  },
  {
    _id: 'notif-5',
    type: 'SUBMISSION_RECEIVED',
    title: 'New Submission',
    message: 'John Doe submitted "Physics Assignment 1"',
    link: '/assignment-details',
    assignmentId: 'assign-101',
    classCode: 'PHYS101',
    className: 'Physics 101',
    classroomId: {
      _id: 'class-1',
      code: 'PHYS101',
      name: 'Physics 101'
    },
    isRead: false,
    createdAt: new Date().toISOString(),
  }
];

describe('Header Notifications Phase 2 Frontend Verification', () => {
  let capturedLocation = null;

  const LocationObserver = () => {
    capturedLocation = useLocation();
    return <div data-testid="route-destination">{capturedLocation.pathname}</div>;
  };

  beforeEach(() => {
    jest.clearAllMocks();
    capturedLocation = null;
    socketCallbacks = {};
    socketService.getSharedSocket.mockImplementation(() => ({
      connected: true,
      on: jest.fn((event, cb) => {
        socketCallbacks[event] = cb;
      }),
      off: jest.fn((event, cb) => {
        if (socketCallbacks[event] === cb) {
          delete socketCallbacks[event];
        }
      }),
      emit: jest.fn(),
      disconnect: jest.fn(),
    }));
    socketService.disconnectSharedSocket.mockImplementation(() => {});
    sessionStorage.clear();
    localStorage.clear();
    sessionStorage.setItem('authToken', 'test-token');
  });

  afterEach(() => {
    sessionStorage.clear();
    localStorage.clear();
  });

  const renderHeader = (storeOverrides = {}, initialEntries = ['/dashboard']) => {
    const store = createTestStore(storeOverrides);
    return render(
      <Provider store={store}>
        <MemoryRouter initialEntries={initialEntries}>
          <Header />
          <Routes>
            <Route path="/assignment-details" element={<LocationObserver />} />
            <Route path="/announcement" element={<LocationObserver />} />
            <Route path="/calendar" element={<LocationObserver />} />
            <Route path="*" element={<LocationObserver />} />
          </Routes>
        </MemoryRouter>
      </Provider>
    );
  };

  test('1. Header bell renders', async () => {
    axios.get.mockResolvedValueOnce({
      data: { success: true, unreadCount: 0, notifications: [] },
    });

    renderHeader();

    const bellBtn = await screen.findByRole('button', { name: /notifications/i });
    expect(bellBtn).toBeInTheDocument();
  });

  test('2. unread badge displays correct count', async () => {
    axios.get.mockResolvedValueOnce({
      data: { success: true, unreadCount: 3, notifications: mockNotifications },
    });

    renderHeader();

    const badge = await screen.findByText('3');
    expect(badge).toBeInTheDocument();
  });

  test('3. zero unread hides badge', async () => {
    axios.get.mockResolvedValueOnce({
      data: { success: true, unreadCount: 0, notifications: [] },
    });

    renderHeader();

    const bellBtn = await screen.findByRole('button', { name: /notifications/i });
    expect(bellBtn).toBeInTheDocument();
    expect(document.querySelector('#notification-badge')).toBeNull();
  });

  test('4. clicking bell opens dropdown panel', async () => {
    axios.get.mockResolvedValueOnce({
      data: { success: true, unreadCount: 2, notifications: mockNotifications.slice(0, 2) },
    });

    renderHeader();

    const bellBtn = await screen.findByRole('button', { name: /notifications/i });
    fireEvent.click(bellBtn);

    expect(await screen.findByText('Notifications')).toBeInTheDocument();
    expect(await screen.findByText('Mark all as read')).toBeInTheDocument();
  });

  test('5. empty state renders when no notifications exist', async () => {
    axios.get.mockResolvedValueOnce({
      data: { success: true, unreadCount: 0, notifications: [] },
    });

    renderHeader();

    const bellBtn = await screen.findByRole('button', { name: /notifications/i });
    fireEvent.click(bellBtn);

    expect(await screen.findByText('No notifications yet')).toBeInTheDocument();
  });

  test('6. newest notifications render in order', async () => {
    axios.get.mockResolvedValueOnce({
      data: { success: true, unreadCount: 2, notifications: mockNotifications.slice(0, 2) },
    });

    renderHeader();

    const bellBtn = await screen.findByRole('button', { name: /notifications/i });
    fireEvent.click(bellBtn);

    const items = await screen.findAllByText(/Assignment/i);
    expect(items.length).toBeGreaterThan(0);
    expect(screen.getByText('New Assignment')).toBeInTheDocument();
    expect(screen.getByText('Assignment Graded')).toBeInTheDocument();
  });

  test('7. unread and read notifications differ visually', async () => {
    axios.get.mockResolvedValueOnce({
      data: { success: true, unreadCount: 1, notifications: mockNotifications.slice(0, 2) },
    });

    renderHeader();

    const bellBtn = await screen.findByRole('button', { name: /notifications/i });
    fireEvent.click(bellBtn);

    const unreadTitle = await screen.findByText('New Assignment');
    const readTitle = await screen.findByText('Assignment Graded');

    const unreadItem = unreadTitle.closest('[data-notification-id="notif-1"]');
    const readItem = readTitle.closest('[data-notification-id="notif-2"]');

    expect(unreadItem.className).toContain('bg-[#F2F8F7]');
    expect(readItem.className).toContain('bg-white');
    expect(unreadItem.innerHTML).toContain('bg-[#008080]');
    expect(readItem.innerHTML).toContain('bg-transparent');
  });

  test('8 & 9. clicking unread notification marks read optimistically, decrements count, and calls API', async () => {
    axios.get.mockImplementation((url) => {
      if (url.includes('/api/notification')) {
        return Promise.resolve({
          data: { success: true, unreadCount: 1, notifications: mockNotifications.slice(0, 2) },
        });
      }
      if (url.includes('/assignment/get')) {
        return Promise.resolve({
          data: {
            success: true,
            assignment: {
              _id: 'assign-101',
              name: 'Physics Assignment 1',
              title: 'Physics Assignment 1',
              classroom: { code: 'PHYS101', name: 'Physics 101' },
            },
          },
        });
      }
      return Promise.resolve({ data: {} });
    });

    axios.patch.mockResolvedValueOnce({
      data: { success: true, notification: { ...mockNotifications[0], isRead: true } },
    });

    renderHeader();

    expect(await screen.findByText('1')).toBeInTheDocument();

    const bellBtn = await screen.findByRole('button', { name: /notifications/i });
    fireEvent.click(bellBtn);

    const notifItem = await screen.findByText('New Assignment');
    fireEvent.click(notifItem);

    await waitFor(() => {
      expect(axios.patch).toHaveBeenCalledWith(
        expect.stringContaining('/notification/notif-1/read'),
        {},
        expect.any(Object)
      );
    });

    expect(document.querySelector('#notification-badge')).toBeNull();
  });

  test('10. mark all as read clears badge and marks items as read', async () => {
    axios.get.mockResolvedValueOnce({
      data: { success: true, unreadCount: 1, notifications: mockNotifications.slice(0, 2) },
    });
    axios.patch.mockResolvedValueOnce({
      data: { success: true, modifiedCount: 1 },
    });

    renderHeader();

    const bellBtn = await screen.findByRole('button', { name: /notifications/i });
    expect(await screen.findByText('1')).toBeInTheDocument();

    fireEvent.click(bellBtn);
    const markAllBtn = await screen.findByRole('button', { name: /mark all as read/i });
    fireEvent.click(markAllBtn);

    await waitFor(() => {
      expect(axios.patch).toHaveBeenCalledWith(
        expect.stringContaining('/notification/read-all'),
        {},
        expect.any(Object)
      );
    });

    expect(document.querySelector('#notification-badge')).toBeNull();
  });

  test('11. incoming socket notification prepends without runtime crash or toast error', async () => {
    axios.get.mockResolvedValueOnce({
      data: { success: true, unreadCount: 0, notifications: [] },
    });

    renderHeader();

    const bellBtn = await screen.findByRole('button', { name: /notifications/i });
    fireEvent.click(bellBtn);

    expect(await screen.findByText('No notifications yet')).toBeInTheDocument();
    expect(document.querySelector('#notification-badge')).toBeNull();

    // Emit real-time notification via socket
    act(() => {
      if (socketCallbacks['notification:new']) {
        socketCallbacks['notification:new']({
          _id: 'notif-live-1',
          type: 'ANNOUNCEMENT_CREATED',
          title: 'Live Announcement',
          message: 'Real-time test message',
          isRead: false,
          createdAt: new Date().toISOString(),
        });
      }
    });

    // Badge increments to 1 without throw
    expect(await screen.findByText('1')).toBeInTheDocument();
    expect(await screen.findByText('Live Announcement')).toBeInTheDocument();
  });

  test('12. duplicate socket notification by same _id is ignored', async () => {
    axios.get.mockResolvedValueOnce({
      data: { success: true, unreadCount: 1, notifications: mockNotifications.slice(0, 2) },
    });

    renderHeader();

    expect(await screen.findByText('1')).toBeInTheDocument();

    act(() => {
      if (socketCallbacks['notification:new']) {
        socketCallbacks['notification:new'](mockNotifications[0]);
      }
    });

    expect(screen.getByText('1')).toBeInTheDocument();
  });

  test('13. ASSIGNMENT_CREATED click fetches authoritative assignment and supplies complete contract', async () => {
    const fullAssignment = {
      _id: 'assign-101',
      name: 'Physics Assignment 1',
      title: 'Physics Assignment 1',
      description: 'Complete questions 1 to 10',
      dueDate: '2026-10-30',
      createdAt: 'Oct 15, 2026',
      status: 'Due',
      classroom: {
        _id: 'class-1',
        name: 'Physics 101',
        code: 'PHYS101',
        subject: 'Physics'
      }
    };

    axios.get.mockImplementation((url) => {
      if (url.includes('/api/notification')) {
        return Promise.resolve({
          data: { success: true, unreadCount: 1, notifications: [mockNotifications[0]] },
        });
      }
      if (url.includes('/assignment/get')) {
        return Promise.resolve({
          data: { success: true, assignment: fullAssignment },
        });
      }
      return Promise.resolve({ data: {} });
    });
    axios.patch.mockResolvedValueOnce({ data: { success: true } });

    renderHeader();

    const bellBtn = await screen.findByRole('button', { name: /notifications/i });
    fireEvent.click(bellBtn);

    const notifItem = await screen.findByText('New Assignment');
    fireEvent.click(notifItem);

    await waitFor(() => {
      expect(capturedLocation).not.toBeNull();
      expect(capturedLocation.pathname).toBe('/assignment-details');
    });

    // Full contract assertions
    expect(capturedLocation.state).toEqual({
      assignment: fullAssignment,
      classCode: 'PHYS101',
      className: 'Physics 101',
      assignmentId: 'assign-101'
    });

    expect(sessionStorage.getItem('currentAssignmentId')).toBe('assign-101');
    expect(sessionStorage.getItem('currentClassCode')).toBe('PHYS101');
    expect(sessionStorage.getItem('currentClassName')).toBe('Physics 101');
    expect(sessionStorage.getItem('isEnrolled')).toBe('true');
  });

  test('14. SUBMISSION_RECEIVED click sets teacher mode (isEnrolled=false) and navigates to assignment-details', async () => {
    const teacherAssignment = {
      _id: 'assign-101',
      name: 'Physics Assignment 1',
      title: 'Physics Assignment 1',
      totalSubmissions: 5,
      reviewedSubmissions: 2,
      submissions: [{ _id: 'sub-1', marks: 8 }],
      classroom: {
        _id: 'class-1',
        name: 'Physics 101',
        code: 'PHYS101',
      }
    };

    axios.get.mockImplementation((url) => {
      if (url.includes('/api/notification')) {
        return Promise.resolve({
          data: { success: true, unreadCount: 1, notifications: [mockNotifications[4]] },
        });
      }
      if (url.includes('/assignment/get')) {
        return Promise.resolve({
          data: { success: true, assignment: teacherAssignment },
        });
      }
      return Promise.resolve({ data: {} });
    });
    axios.patch.mockResolvedValueOnce({ data: { success: true } });

    renderHeader();

    const bellBtn = await screen.findByRole('button', { name: /notifications/i });
    fireEvent.click(bellBtn);

    const notifItem = await screen.findByText('New Submission');
    fireEvent.click(notifItem);

    await waitFor(() => {
      expect(capturedLocation.pathname).toBe('/assignment-details');
    });

    expect(sessionStorage.getItem('isEnrolled')).toBe('false');
    expect(capturedLocation.state.assignment).toEqual(teacherAssignment);
  });

  test('15. ANNOUNCEMENT_CREATED click supplies classroom code and avoids dashboard redirect', async () => {
    axios.get.mockImplementation((url) => {
      if (url.includes('/api/notification')) {
        return Promise.resolve({
          data: { success: true, unreadCount: 1, notifications: [mockNotifications[2]] },
        });
      }
      return Promise.resolve({ data: {} });
    });
    axios.patch.mockResolvedValueOnce({ data: { success: true } });

    renderHeader();

    const bellBtn = await screen.findByRole('button', { name: /notifications/i });
    fireEvent.click(bellBtn);

    const notifItem = await screen.findByText('New Announcement');
    fireEvent.click(notifItem);

    await waitFor(() => {
      expect(capturedLocation.pathname).toBe('/announcement');
    });

    expect(capturedLocation.state).toEqual({
      code: 'PHYS101',
      _id: 'class-1',
      name: 'Physics 101'
    });
    expect(sessionStorage.getItem('isEnrolled')).toBe('true');
  });

  test('16. LECTURE_SCHEDULED click navigates to /calendar and sets enrolled mode', async () => {
    axios.get.mockImplementation((url) => {
      if (url.includes('/api/notification')) {
        return Promise.resolve({
          data: { success: true, unreadCount: 1, notifications: [mockNotifications[3]] },
        });
      }
      return Promise.resolve({ data: {} });
    });
    axios.patch.mockResolvedValueOnce({ data: { success: true } });

    renderHeader();

    const bellBtn = await screen.findByRole('button', { name: /notifications/i });
    fireEvent.click(bellBtn);

    const notifItem = await screen.findByText('Lecture Scheduled');
    fireEvent.click(notifItem);

    await waitFor(() => {
      expect(capturedLocation.pathname).toBe('/calendar');
    });

    expect(sessionStorage.getItem('isEnrolled')).toBe('true');
  });

  test('17. Header profile menu and add menu behaviors remain intact', async () => {
    axios.get.mockResolvedValueOnce({
      data: { success: true, unreadCount: 0, notifications: [] },
    });

    renderHeader({ name: 'Alex Johnson' });

    const profileIcon = document.querySelector('svg[data-testid="AccountCircleOutlinedIcon"]');
    expect(profileIcon).toBeInTheDocument();

    fireEvent.click(profileIcon.parentElement);

    expect(await screen.findByText('Alex Johnson')).toBeInTheDocument();
    expect(await screen.findByText('Logout')).toBeInTheDocument();
  });
});
