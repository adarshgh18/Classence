import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import axios from 'axios';
import { toast } from 'react-toastify';
import Modal2 from './modal2';

jest.mock('axios');
jest.mock('react-toastify', () => ({
  toast: {
    success: jest.fn(),
    error: jest.fn(),
    dismiss: jest.fn()
  }
}));

const mockDispatch = jest.fn();
jest.mock('react-redux', () => ({
  useDispatch: () => mockDispatch
}));

const mockNavigate = jest.fn();
jest.mock('react-router-dom', () => ({
  useNavigate: () => mockNavigate
}));

describe('Modal2 Unit & Integration Verification', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    sessionStorage.setItem('authToken', 'mock-test-token');
    axios.get.mockResolvedValue({
      data: {
        success: true,
        user: {
          joinedClasses: [{ _id: 'cls1', name: 'Math 101', code: 'CODE_SUCCESS' }],
          createdClasses: [],
          noOfJoinedClasses: 1,
          noOfCreatedClasses: 0
        }
      }
    });
  });

  afterEach(() => {
    sessionStorage.clear();
  });

  test('A & B. Modal2 renders without local ToastContainer', () => {
    const { container } = render(
      <Modal2 onClose={jest.fn()} />
    );
    // Ensure no ToastContainer element is mounted inside Modal2 DOM
    const toastContainer = container.querySelector('.Toastify');
    expect(toastContainer).toBeNull();
  });

  test('C, D, E. Single-flight auto-join under StrictMode remount & 400 error handling', async () => {
    const joinToken = 'INV_TOKEN_TEST_1';
    const classCode = 'CODE_TEST_1';

    // Mock owner rejection (400)
    axios.post.mockRejectedValueOnce({
      response: {
        status: 400,
        data: {
          success: false,
          error: 'You are the owner of this class and cannot join as a student.'
        }
      }
    });

    // Mount 1 (StrictMode initial mount)
    const { unmount } = render(
      <Modal2 joinToken={joinToken} classCode={classCode} onClose={jest.fn()} />
    );

    // Simulate StrictMode unmount
    unmount();

    // Mount 2 (StrictMode remount)
    render(
      <Modal2 joinToken={joinToken} classCode={classCode} onClose={jest.fn()} />
    );

    await waitFor(() => {
      // Exactly ONE POST request must be made across both mounts
      expect(axios.post).toHaveBeenCalledTimes(1);
      expect(toast.error).toHaveBeenCalledWith(
        'You are the owner of this class and cannot join as a student.',
        expect.any(Object)
      );
    });

    expect(axios.post).toHaveBeenCalledWith(
      expect.stringContaining('/classroom/join'),
      { code: classCode, token: joinToken },
      expect.any(Object)
    );

    // toast.dismiss must NOT have been called
    expect(toast.dismiss).not.toHaveBeenCalled();
    // Failed join must not show success toast
    expect(toast.success).not.toHaveBeenCalled();
  });

  test('F. Successful auto-join executes navigation, refetches user details, and shows success toast', async () => {
    const joinToken = 'INV_TOKEN_SUCCESS';
    const classCode = 'CODE_SUCCESS';

    axios.post.mockResolvedValueOnce({
      data: {
        success: true,
        message: 'Class joined successfully!'
      }
    });

    render(
      <Modal2 joinToken={joinToken} classCode={classCode} onClose={jest.fn()} />
    );

    await waitFor(() => {
      expect(axios.post).toHaveBeenCalledTimes(1);
      expect(axios.get).toHaveBeenCalledWith(
        expect.stringContaining('/user/details'),
        expect.any(Object)
      );
      expect(mockDispatch).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'joinedClasses/setJoinedClasses',
          payload: [{ _id: 'cls1', name: 'Math 101', code: 'CODE_SUCCESS' }]
        })
      );
      expect(toast.success).toHaveBeenCalledWith(
        'Class joined successfully!',
        expect.any(Object)
      );
      expect(mockNavigate).toHaveBeenCalledWith('/dashboard', { replace: true, state: {} });
    });

    expect(toast.dismiss).not.toHaveBeenCalled();
  });

  test('G. Manual class-code join refetches user details, updates Redux, and shows success toast', async () => {
    axios.post.mockResolvedValueOnce({
      data: {
        success: true,
        message: 'Class joined successfully!'
      }
    });

    render(
      <Modal2 onClose={jest.fn()} />
    );

    const input = screen.getByPlaceholderText(/Class Code/i);
    const submitBtn = screen.getByRole('button', { name: /Join Class/i });

    fireEvent.change(input, { target: { value: 'MANUAL123' } });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(axios.post).toHaveBeenCalledWith(
        expect.stringContaining('/classroom/join'),
        { code: 'MANUAL123' },
        expect.any(Object)
      );
      expect(axios.get).toHaveBeenCalledWith(
        expect.stringContaining('/user/details'),
        expect.any(Object)
      );
      expect(mockDispatch).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'joinedClasses/setJoinedClasses'
        })
      );
      expect(toast.success).toHaveBeenCalledWith(
        'Class joined successfully!',
        expect.any(Object)
      );
    });

    expect(toast.dismiss).not.toHaveBeenCalled();
  });

  test('H. Failed manual join shows error toast and does not update joined classes or show success toast', async () => {
    axios.post.mockRejectedValueOnce({
      response: {
        status: 404,
        data: {
          error: 'Class not found. Please check the code and try again.'
        }
      }
    });

    render(
      <Modal2 onClose={jest.fn()} />
    );

    const input = screen.getByPlaceholderText(/Class Code/i);
    const submitBtn = screen.getByRole('button', { name: /Join Class/i });

    fireEvent.change(input, { target: { value: 'INVALID999' } });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith(
        'Class not found. Please check the code and try again.',
        expect.any(Object)
      );
      expect(toast.success).not.toHaveBeenCalled();
      expect(axios.get).not.toHaveBeenCalled();
    });
  });
});
