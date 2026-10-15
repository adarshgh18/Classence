import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import axios from 'axios';
import { toast } from 'react-toastify';
import Modal1 from './modal1';

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

describe('Modal1 Unit & Integration Verification (Create Class)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    sessionStorage.setItem('authToken', 'mock-teacher-token');
    axios.get.mockResolvedValue({
      data: {
        success: true,
        user: {
          _id: 'teacher123',
          name: 'Teacher Jane',
          email: 'jane@example.com',
          joinedClasses: [],
          createdClasses: [
            {
              _id: 'class_new_1',
              name: 'Physics 101',
              subject: 'Physics',
              code: 'PHY101',
              privacy: 'public',
              teacher: { _id: 'teacher123', name: 'Teacher Jane' },
              students: []
            }
          ],
          noOfJoinedClasses: 0,
          noOfCreatedClasses: 1
        }
      }
    });
  });

  afterEach(() => {
    sessionStorage.clear();
  });

  test('1. Modal1 renders without duplicate local ToastContainer', () => {
    const { container } = render(<Modal1 onClose={jest.fn()} />);
    const toastContainer = container.querySelector('.Toastify');
    expect(toastContainer).toBeNull();
  });

  test('2. Missing fields prevent submission and trigger validation error without backend call', async () => {
    render(<Modal1 onClose={jest.fn()} />);
    const submitButton = screen.getByRole('button', { name: 'Create Class' });

    // Button is disabled when inputs are empty
    expect(submitButton).toBeDisabled();

    // Directly invoking click if enabled
    fireEvent.click(submitButton);

    expect(axios.post).not.toHaveBeenCalled();
    expect(axios.get).not.toHaveBeenCalled();
  });

  test('3. Successful Create Class calls backend once, refetches user details, updates createdClasses in Redux, sets isEnrolled(false), and shows success toast without reload', async () => {
    const originalReload = window.location.reload;
    const mockReload = jest.fn();
    Object.defineProperty(window, 'location', {
      writable: true,
      value: { ...window.location, reload: mockReload, pathname: '/classes' }
    });

    axios.post.mockResolvedValueOnce({
      data: {
        success: true,
        message: 'Class created successfully!',
        classroom: {
          _id: 'class_new_1',
          name: 'Physics 101',
          subject: 'Physics',
          privacy: 'public',
          code: 'PHY101',
          teacher: 'teacher123',
          students: []
        }
      }
    });

    const mockOnClose = jest.fn();
    render(<Modal1 onClose={mockOnClose} />);

    // Fill Class Name
    const nameInput = screen.getByPlaceholderText('Class Name');
    fireEvent.change(nameInput, { target: { value: 'Physics' } });

    // Fill Subject
    const subjectInput = screen.getByPlaceholderText('Subject');
    fireEvent.change(subjectInput, { target: { value: 'Physics' } });

    // Open Privacy dropdown and select 'Public'
    const privacyButton = screen.getByText('Class Privacy');
    fireEvent.click(privacyButton);

    const publicOption = screen.getByText('Public');
    fireEvent.click(publicOption);

    // Click 'Create Class'
    const submitButton = screen.getByRole('button', { name: 'Create Class' });
    fireEvent.click(submitButton);

    await waitFor(() => {
      // 1. Calls backend POST /classroom/create once
      expect(axios.post).toHaveBeenCalledTimes(1);
      expect(axios.post).toHaveBeenCalledWith(
        expect.stringContaining('/classroom/create'),
        { name: 'Physics', subject: 'Physics', privacy: 'public' },
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: 'Bearer mock-teacher-token'
          })
        })
      );

      // 2. Authoritative refetch of user details
      expect(axios.get).toHaveBeenCalledWith(
        expect.stringContaining('/user/details'),
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: 'Bearer mock-teacher-token'
          })
        })
      );

      // 3. Newly created class goes to createdClasses in Redux, NOT joinedClasses
      expect(mockDispatch).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'createdClasses/setCreatedClasses',
          payload: [
            expect.objectContaining({
              _id: 'class_new_1',
              name: 'Physics 101',
              code: 'PHY101'
            })
          ]
        })
      );

      // 4. Sets isEnrolled to false (teacher-owned view)
      expect(mockDispatch).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'toggleState/setIsEnrolled',
          payload: false
        })
      );

      // 5. Success toast appears
      expect(toast.success).toHaveBeenCalledWith(
        'Class created successfully!',
        expect.objectContaining({
          className: 'custom-toastS',
          hideProgressBar: true,
          autoClose: 3000
        })
      );
    });

    // 6. No window.location.reload called
    expect(mockReload).not.toHaveBeenCalled();

    // 7. No parameterless toast.dismiss()
    expect(toast.dismiss).not.toHaveBeenCalled();

    window.location.reload = originalReload;
  });

  test('4. Failed class creation shows error feedback, does not set createdClasses, and does not show success toast', async () => {
    axios.post.mockRejectedValueOnce({
      response: {
        status: 400,
        data: {
          error: 'Please fill in all fields.'
        }
      }
    });

    render(<Modal1 onClose={jest.fn()} />);

    // Fill Class Name
    const nameInput = screen.getByPlaceholderText('Class Name');
    fireEvent.change(nameInput, { target: { value: 'Chemistry' } });

    // Fill Subject
    const subjectInput = screen.getByPlaceholderText('Subject');
    fireEvent.change(subjectInput, { target: { value: 'Chem' } });

    // Select Privacy
    const privacyButton = screen.getByText('Class Privacy');
    fireEvent.click(privacyButton);
    const privateOption = screen.getByText('Private');
    fireEvent.click(privateOption);

    // Submit
    const submitButton = screen.getByRole('button', { name: 'Create Class' });
    fireEvent.click(submitButton);

    await waitFor(() => {
      expect(axios.post).toHaveBeenCalledTimes(1);
      expect(toast.error).toHaveBeenCalledWith(
        'Please fill in all fields.',
        expect.any(Object)
      );
    });

    // Does not refetch or update createdClasses
    expect(axios.get).not.toHaveBeenCalled();
    expect(mockDispatch).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: 'createdClasses/setCreatedClasses' })
    );

    // Does not show success toast
    expect(toast.success).not.toHaveBeenCalled();
    // Does not dismiss toasts
    expect(toast.dismiss).not.toHaveBeenCalled();
  });

  test('5. Creating first class from /dashsignup navigates to /dashboard', async () => {
    Object.defineProperty(window, 'location', {
      writable: true,
      value: { ...window.location, pathname: '/dashsignup' }
    });

    axios.post.mockResolvedValueOnce({
      data: {
        success: true,
        message: 'Class created successfully!',
        classroom: { _id: 'c1', name: 'Bio', subject: 'Biology', privacy: 'public' }
      }
    });

    render(<Modal1 onClose={jest.fn()} />);

    fireEvent.change(screen.getByPlaceholderText('Class Name'), { target: { value: 'Biology' } });
    fireEvent.change(screen.getByPlaceholderText('Subject'), { target: { value: 'Bio' } });
    fireEvent.click(screen.getByText('Class Privacy'));
    fireEvent.click(screen.getByText('Public'));
    fireEvent.click(screen.getByRole('button', { name: 'Create Class' }));

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith('/dashboard');
    });
  });
});
