import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import axios from 'axios';
import { toast } from 'react-toastify';

import SettingsPage from './settings';
import ChangePasswordModal from './changePasswordModal';
import Header from '../header/header';
import userReducer from '../features/userSlice';
import sidebarReducer from '../features/sidebarSlice';
import toggleReducer from '../features/toggleSlice';

jest.mock('axios');
jest.mock('react-toastify', () => ({
  toast: {
    success: jest.fn(),
    error: jest.fn(),
    dismiss: jest.fn(),
  },
  ToastContainer: () => <div data-testid="toast-container" />,
}));

const createTestStore = (initialUserState = {}) => {
  return configureStore({
    reducer: {
      user: userReducer,
      sidebar: sidebarReducer,
      toggleState: toggleReducer,
    },
    preloadedState: {
      sidebar: { width: '250px' },
      toggleState: { isEnrolled: true },
      user: {
        name: '',
        email: '',
        userId: null,
        noOfJoinedClasses: 0,
        noOfCreatedClasses: 0,
        isNotification: true,
        ...initialUserState,
      },
    },
  });
};

describe('Settings Phase 1 Unit and Integration Verification', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    sessionStorage.clear();
    localStorage.clear();
    sessionStorage.setItem('authToken', 'test-token');
  });

  afterEach(() => {
    sessionStorage.clear();
    localStorage.clear();
  });

  // ==========================================
  // SETTINGS DATA HYDRATION
  // ==========================================
  test('1. Settings direct load hydrates profile data from GET /user/details', async () => {
    axios.get.mockResolvedValueOnce({
      data: {
        success: true,
        user: {
          _id: 'u123',
          name: 'Jane Doe',
          email: 'jane@example.com',
          isNotification: true,
          noOfJoinedClasses: 2,
          noOfCreatedClasses: 1,
        },
      },
    });

    const store = createTestStore();
    render(
      <Provider store={store}>
        <MemoryRouter initialEntries={['/settings']}>
          <SettingsPage />
        </MemoryRouter>
      </Provider>
    );

    await waitFor(() => {
      expect(axios.get).toHaveBeenCalledWith(
        expect.stringContaining('/user/details'),
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: 'Bearer test-token',
          }),
        })
      );
    });

    expect(await screen.findByText('Jane Doe')).toBeInTheDocument();
    expect(await screen.findByText('jane@example.com')).toBeInTheDocument();
  });

  test('2. Persisted isNotification=true renders toggle ON', async () => {
    axios.get.mockResolvedValueOnce({
      data: {
        success: true,
        user: {
          _id: 'u123',
          name: 'Jane Doe',
          email: 'jane@example.com',
          isNotification: true,
        },
      },
    });

    const store = createTestStore({ isNotification: true });
    render(
      <Provider store={store}>
        <MemoryRouter initialEntries={['/settings']}>
          <SettingsPage />
        </MemoryRouter>
      </Provider>
    );

    const toggle = await screen.findByRole('switch');
    expect(toggle).toHaveAttribute('aria-checked', 'true');
    expect(toggle.className).toContain('bg-teal-600');
  });

  test('3. Persisted isNotification=false renders toggle OFF', async () => {
    axios.get.mockResolvedValueOnce({
      data: {
        success: true,
        user: {
          _id: 'u123',
          name: 'Jane Doe',
          email: 'jane@example.com',
          isNotification: false,
        },
      },
    });

    const store = createTestStore({ isNotification: false });
    render(
      <Provider store={store}>
        <MemoryRouter initialEntries={['/settings']}>
          <SettingsPage />
        </MemoryRouter>
      </Provider>
    );

    const toggle = await screen.findByRole('switch');
    await waitFor(() => {
      expect(toggle).toHaveAttribute('aria-checked', 'false');
    });
    expect(toggle.className).toContain('bg-gray-300');
  });

  test('4. Notification toggle update calls API, updates UI state, and shows toast', async () => {
    axios.get.mockResolvedValueOnce({
      data: {
        success: true,
        user: {
          _id: 'u123',
          name: 'Jane Doe',
          email: 'jane@example.com',
          isNotification: true,
        },
      },
    });

    axios.post.mockResolvedValueOnce({
      data: {
        success: true,
        message: 'Notifications disabled.',
        isNotification: false,
      },
    });

    const store = createTestStore({ isNotification: true });
    render(
      <Provider store={store}>
        <MemoryRouter initialEntries={['/settings']}>
          <SettingsPage />
        </MemoryRouter>
      </Provider>
    );

    const toggle = await screen.findByRole('switch');
    fireEvent.click(toggle);

    await waitFor(() => {
      expect(axios.post).toHaveBeenCalledWith(
        expect.stringContaining('/user/settings/change-is-notification-enabled'),
        { isNotification: false },
        expect.any(Object)
      );
    });

    await waitFor(() => {
      expect(toggle).toHaveAttribute('aria-checked', 'false');
    });
    expect(toast.success).toHaveBeenCalledWith(
      'Notifications disabled.',
      expect.objectContaining({ className: 'custom-toast' })
    );
  });

  test('5. Notification toggle reverts state and displays error toast on API failure', async () => {
    axios.get.mockResolvedValueOnce({
      data: {
        success: true,
        user: {
          _id: 'u123',
          name: 'Jane Doe',
          email: 'jane@example.com',
          isNotification: true,
        },
      },
    });

    axios.post.mockRejectedValueOnce({
      response: {
        data: {
          message: 'Server failed to update notification setting.',
        },
      },
    });

    const store = createTestStore({ isNotification: true });
    render(
      <Provider store={store}>
        <MemoryRouter initialEntries={['/settings']}>
          <SettingsPage />
        </MemoryRouter>
      </Provider>
    );

    const toggle = await screen.findByRole('switch');
    expect(toggle).toHaveAttribute('aria-checked', 'true');

    fireEvent.click(toggle);

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith(
        'Server failed to update notification setting.',
        expect.objectContaining({ className: 'custom-toast' })
      );
    });

    // Reverts back to true
    expect(toggle).toHaveAttribute('aria-checked', 'true');
  });

  // ==========================================
  // NAME EDITING
  // ==========================================
  test('6. Invalid short name does not exit edit mode and shows error toast', async () => {
    axios.get.mockResolvedValueOnce({
      data: {
        success: true,
        user: {
          _id: 'u123',
          name: 'Jane Doe',
          email: 'jane@example.com',
          isNotification: true,
        },
      },
    });

    const store = createTestStore({ name: 'Jane Doe', email: 'jane@example.com' });
    render(
      <Provider store={store}>
        <MemoryRouter initialEntries={['/settings']}>
          <SettingsPage />
        </MemoryRouter>
      </Provider>
    );

    const editBtn = await screen.findByLabelText('Edit name');
    fireEvent.click(editBtn);

    const input = screen.getByDisplayValue('Jane Doe');
    fireEvent.change(input, { target: { value: '  ab  ' } });
    fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' });

    expect(toast.error).toHaveBeenCalledWith(
      'At least 3 characters required',
      expect.objectContaining({ className: 'custom-toast' })
    );
    // Input must still be present (not exited edit mode)
    expect(screen.getByDisplayValue('ab')).toBeInTheDocument();
    expect(axios.post).not.toHaveBeenCalled();
  });

  test('7. Valid name updates Redux and backend state with trimmed value', async () => {
    axios.get.mockResolvedValueOnce({
      data: {
        success: true,
        user: {
          _id: 'u123',
          name: 'Jane Doe',
          email: 'jane@example.com',
          isNotification: true,
        },
      },
    });

    axios.post.mockResolvedValueOnce({
      data: {
        success: true,
        message: 'Name updated successfully',
        user: {
          name: 'Alice Johnson',
        },
      },
    });

    const store = createTestStore({ name: 'Jane Doe', email: 'jane@example.com' });
    render(
      <Provider store={store}>
        <MemoryRouter initialEntries={['/settings']}>
          <SettingsPage />
        </MemoryRouter>
      </Provider>
    );

    const editBtn = await screen.findByLabelText('Edit name');
    fireEvent.click(editBtn);

    const input = screen.getByDisplayValue('Jane Doe');
    fireEvent.change(input, { target: { value: '   Alice Johnson   ' } });
    fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' });

    await waitFor(() => {
      expect(axios.post).toHaveBeenCalledWith(
        expect.stringContaining('/user/settings/change-name'),
        { name: 'Alice Johnson' },
        expect.any(Object)
      );
    });

    await waitFor(() => {
      expect(toast.success).toHaveBeenCalledWith(
        'Name updated successfully',
        expect.objectContaining({ className: 'custom-toast' })
      );
    });

    // Edit mode exited and new name visible
    expect(await screen.findByText('Alice Johnson')).toBeInTheDocument();
    expect(screen.queryByDisplayValue('Alice Johnson')).not.toBeInTheDocument();
  });

  test('8. Name editing API failure preserves edit mode and produces visible error toast', async () => {
    axios.get.mockResolvedValueOnce({
      data: {
        success: true,
        user: {
          _id: 'u123',
          name: 'Jane Doe',
          email: 'jane@example.com',
          isNotification: true,
        },
      },
    });

    axios.post.mockRejectedValueOnce({
      response: {
        data: {
          message: 'Server error updating name',
        },
      },
    });

    const store = createTestStore({ name: 'Jane Doe', email: 'jane@example.com' });
    render(
      <Provider store={store}>
        <MemoryRouter initialEntries={['/settings']}>
          <SettingsPage />
        </MemoryRouter>
      </Provider>
    );

    // Wait for hydration
    expect(await screen.findByText('Jane Doe')).toBeInTheDocument();

    const editBtn = await screen.findByLabelText('Edit name');
    fireEvent.click(editBtn);

    const input = screen.getByDisplayValue('Jane Doe');
    fireEvent.change(input, { target: { value: 'Valid Name' } });
    fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' });

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith(
        'Server error updating name',
        expect.objectContaining({ className: 'custom-toast' })
      );
    });

    // Input should remain open so the user can retry or adjust
    expect(screen.getByDisplayValue('Valid Name')).toBeInTheDocument();
  });

  test('9. Escape cancels name editing without saving', async () => {
    axios.get.mockResolvedValueOnce({
      data: {
        success: true,
        user: {
          _id: 'u123',
          name: 'Jane Doe',
          email: 'jane@example.com',
          isNotification: true,
        },
      },
    });

    const store = createTestStore({ name: 'Jane Doe', email: 'jane@example.com' });
    render(
      <Provider store={store}>
        <MemoryRouter initialEntries={['/settings']}>
          <SettingsPage />
        </MemoryRouter>
      </Provider>
    );

    const editBtn = await screen.findByLabelText('Edit name');
    fireEvent.click(editBtn);

    const input = screen.getByDisplayValue('Jane Doe');
    fireEvent.change(input, { target: { value: 'Something Else' } });
    fireEvent.keyDown(input, { key: 'Escape', code: 'Escape' });

    expect(screen.queryByDisplayValue('Something Else')).not.toBeInTheDocument();
    expect(screen.getByText('Jane Doe')).toBeInTheDocument();
    expect(axios.post).not.toHaveBeenCalled();
  });

  // ==========================================
  // CHANGE PASSWORD MODAL
  // ==========================================
  test('10. Change Password: mismatch between new password and confirm password blocks API request', async () => {
    render(<ChangePasswordModal isOpen={true} onClose={jest.fn()} />);

    fireEvent.change(screen.getByPlaceholderText('Enter old password'), {
      target: { value: 'OldPassword@123' },
    });
    fireEvent.change(screen.getByPlaceholderText('Enter new password'), {
      target: { value: 'NewPassword@123' },
    });
    fireEvent.change(screen.getByPlaceholderText('Confirm new password'), {
      target: { value: 'MismatchPassword@123' },
    });

    fireEvent.click(screen.getByRole('button', { name: /change password/i }));

    expect(
      await screen.findByText('New password and confirm password do not match.')
    ).toBeInTheDocument();
    expect(axios.post).not.toHaveBeenCalled();
  });

  test('11. Change Password: correct confirmation sends request with only oldPassword and newPassword', async () => {
    axios.post.mockResolvedValueOnce({
      data: {
        success: true,
        message: 'Password changed successfully!',
        token: 'new-fresh-jwt-token',
      },
    });

    render(<ChangePasswordModal isOpen={true} onClose={jest.fn()} />);

    fireEvent.change(screen.getByPlaceholderText('Enter old password'), {
      target: { value: 'OldPassword@123' },
    });
    fireEvent.change(screen.getByPlaceholderText('Enter new password'), {
      target: { value: 'NewPassword@123' },
    });
    fireEvent.change(screen.getByPlaceholderText('Confirm new password'), {
      target: { value: 'NewPassword@123' },
    });

    fireEvent.click(screen.getByRole('button', { name: /change password/i }));

    await waitFor(() => {
      expect(axios.post).toHaveBeenCalledWith(
        expect.stringContaining('/user/settings/change-password'),
        {
          oldPassword: 'OldPassword@123',
          newPassword: 'NewPassword@123',
        },
        expect.any(Object)
      );
    });
  });

  test('12. Change Password: localStorage session remains in localStorage after token update', async () => {
    sessionStorage.clear();
    localStorage.setItem('authToken', 'origin-local-token');

    axios.post.mockResolvedValueOnce({
      data: {
        success: true,
        message: 'Password changed successfully!',
        token: 'replaced-local-jwt',
      },
    });

    render(<ChangePasswordModal isOpen={true} onClose={jest.fn()} />);

    fireEvent.change(screen.getByPlaceholderText('Enter old password'), {
      target: { value: 'OldPassword@123' },
    });
    fireEvent.change(screen.getByPlaceholderText('Enter new password'), {
      target: { value: 'NewPassword@123' },
    });
    fireEvent.change(screen.getByPlaceholderText('Confirm new password'), {
      target: { value: 'NewPassword@123' },
    });

    fireEvent.click(screen.getByRole('button', { name: /change password/i }));

    await waitFor(() => {
      expect(localStorage.getItem('authToken')).toBe('replaced-local-jwt');
      expect(sessionStorage.getItem('authToken')).toBeNull();
    });
  });

  test('13. Change Password: sessionStorage session remains in sessionStorage after token update', async () => {
    localStorage.clear();
    sessionStorage.setItem('authToken', 'origin-session-token');

    axios.post.mockResolvedValueOnce({
      data: {
        success: true,
        message: 'Password changed successfully!',
        token: 'replaced-session-jwt',
      },
    });

    render(<ChangePasswordModal isOpen={true} onClose={jest.fn()} />);

    fireEvent.change(screen.getByPlaceholderText('Enter old password'), {
      target: { value: 'OldPassword@123' },
    });
    fireEvent.change(screen.getByPlaceholderText('Enter new password'), {
      target: { value: 'NewPassword@123' },
    });
    fireEvent.change(screen.getByPlaceholderText('Confirm new password'), {
      target: { value: 'NewPassword@123' },
    });

    fireEvent.click(screen.getByRole('button', { name: /change password/i }));

    await waitFor(() => {
      expect(sessionStorage.getItem('authToken')).toBe('replaced-session-jwt');
      expect(localStorage.getItem('authToken')).toBeNull();
    });
  });

  // ==========================================
  // HEADER TOGGLE ROUTE VISIBILITY
  // ==========================================
  test('14. Joined | Created header toggle is hidden on /settings', () => {
    const store = createTestStore({
      noOfJoinedClasses: 2,
      noOfCreatedClasses: 2,
    });

    render(
      <Provider store={store}>
        <MemoryRouter initialEntries={['/settings']}>
          <Header />
        </MemoryRouter>
      </Provider>
    );

    expect(screen.queryByText('Joined')).not.toBeInTheDocument();
    expect(screen.queryByText('Created')).not.toBeInTheDocument();
  });

  test('15. Joined | Created header toggle remains available on other routes (e.g. /dashboard)', () => {
    const store = createTestStore({
      noOfJoinedClasses: 2,
      noOfCreatedClasses: 2,
    });

    render(
      <Provider store={store}>
        <MemoryRouter initialEntries={['/dashboard']}>
          <Header />
        </MemoryRouter>
      </Provider>
    );

    expect(screen.getByText('Joined')).toBeInTheDocument();
    expect(screen.getByText('Created')).toBeInTheDocument();
  });
});
