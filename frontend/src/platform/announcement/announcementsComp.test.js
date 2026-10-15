import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import axios from 'axios';
import AnnouncementComponent from './announcementsComp';

jest.mock('axios');
jest.mock('react-toastify', () => ({
  toast: {
    success: jest.fn(),
    error: jest.fn(),
    dismiss: jest.fn()
  }
}));

// Mock child components that are not relevant to Announcement tab
jest.mock('../assignmentSec/assignment', () => () => <div data-testid="assignments-tab">Assignments</div>);
jest.mock('../schedule/scheduleComp', () => () => <div data-testid="schedule-tab">Schedule</div>);
jest.mock('../People/classDetails', () => () => <div data-testid="people-tab">People</div>);
jest.mock('../attendanceSec/attendance', () => () => <div data-testid="attendance-tab">Attendance</div>);

const mockNavigate = jest.fn();
jest.mock('react-router-dom', () => ({
  ...jest.requireActual('react-router-dom'),
  useNavigate: () => mockNavigate,
  useLocation: () => ({
    state: { code: 'TEST_CLASS_101' },
    pathname: '/announcement'
  })
}));

let mockState = {};
const mockDispatch = jest.fn();

jest.mock('react-redux', () => ({
  useSelector: (selector) => selector(mockState),
  useDispatch: () => mockDispatch
}));

describe('Announcement Component Role-Based Authorization & Visibility', () => {
  const sampleClassroomData = {
    _id: 'classroom_1',
    code: 'TEST_CLASS_101',
    name: 'Physics 101',
    subject: 'Physics',
    teacher: { _id: 'teacher_id_123', name: 'Dr. Smith', email: 'smith@example.com' },
    students: [{ _id: 'student_id_456', name: 'Alice Student', email: 'alice@example.com' }],
    announcements: [
      {
        _id: 'ann_1',
        title: 'Exam Announcement',
        description: 'Midterm will be on Friday.',
        media: [],
        createdAt: new Date().toISOString()
      }
    ]
  };

  beforeEach(() => {
    jest.clearAllMocks();
    sessionStorage.setItem('authToken', 'mock-token');
    axios.get.mockResolvedValue({
      data: {
        success: true,
        classroom: sampleClassroomData
      }
    });
  });

  afterEach(() => {
    sessionStorage.clear();
  });

  test('9 & 10. Teacher / Owner sees announcement 3-dot kebab menu and can open Edit / Delete options', async () => {
    // Current user is the teacher
    sessionStorage.setItem('userId', 'teacher_id_123');
    mockState = {
      sidebar: { width: '200px' },
      toggleState: { isEnrolled: false },
      createdClasses: { createdClasses: [{ code: 'TEST_CLASS_101', _id: 'classroom_1' }] },
      joinedClasses: { joinedClasses: [] },
      user: { userId: 'teacher_id_123', noOfJoinedClasses: 0 },
      auth: { user: { _id: 'teacher_id_123' } }
    };

    render(
      <MemoryRouter>
        <AnnouncementComponent />
      </MemoryRouter>
    );

    // Wait for announcement to load
    await waitFor(() => {
      expect(screen.getByText('Exam Announcement')).toBeInTheDocument();
    });

    // Post announcement button should be visible for teacher
    expect(screen.getByText(/Post a new announcement/i)).toBeInTheDocument();

    // Announcement 3-dot menu button should be present for teacher
    const moreBtns = screen.getAllByRole('button');
    // Find the announcement kebab button (inside the announcement card)
    const announcementCardHeader = screen.getByText('Exam Announcement').parentElement;
    const kebabBtn = announcementCardHeader.querySelector('button');
    expect(kebabBtn).not.toBeNull();

    // Click the announcement kebab button to open Menu
    fireEvent.click(kebabBtn);

    // Edit and Delete must be visible
    expect(screen.getByText('Edit')).toBeInTheDocument();
    expect(screen.getByText('Delete')).toBeInTheDocument();
  });

  test('11, 12, 13. Student / Enrolled member does NOT see announcement kebab button or Edit/Delete actions', async () => {
    // Current user is a student, NOT the owner
    sessionStorage.setItem('userId', 'student_id_456');
    mockState = {
      sidebar: { width: '200px' },
      toggleState: { isEnrolled: true },
      createdClasses: { createdClasses: [] },
      joinedClasses: { joinedClasses: [{ code: 'TEST_CLASS_101', _id: 'classroom_1' }] },
      user: { userId: 'student_id_456', noOfJoinedClasses: 1 },
      auth: { user: { _id: 'student_id_456' } }
    };

    render(
      <MemoryRouter>
        <AnnouncementComponent />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText('Exam Announcement')).toBeInTheDocument();
    });

    // Post a new announcement must NOT be visible for student
    expect(screen.queryByText(/Post a new announcement/i)).toBeNull();

    // Announcement card kebab menu button must NOT exist for student
    const announcementCardHeader = screen.getByText('Exam Announcement').parentElement;
    const kebabBtn = announcementCardHeader.querySelector('button');
    expect(kebabBtn).toBeNull();

    // Edit and Delete must NOT exist in document
    expect(screen.queryByText('Edit')).toBeNull();
    expect(screen.queryByText('Delete')).toBeNull();
  });

  test('14. Classroom-level menu shows Leave Class for Student (and Delete Class is NOT shown)', async () => {
    // Student enrolled
    sessionStorage.setItem('userId', 'student_id_456');
    mockState = {
      sidebar: { width: '200px' },
      toggleState: { isEnrolled: true },
      createdClasses: { createdClasses: [] },
      joinedClasses: { joinedClasses: [{ code: 'TEST_CLASS_101', _id: 'classroom_1' }] },
      user: { userId: 'student_id_456', noOfJoinedClasses: 1 },
      auth: { user: { _id: 'student_id_456' } }
    };

    render(
      <MemoryRouter>
        <AnnouncementComponent />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText('Exam Announcement')).toBeInTheDocument();
    });

    // Find classroom-level options button
    const classOptionsBtns = screen.getAllByTitle('Class Options');
    expect(classOptionsBtns.length).toBeGreaterThan(0);

    // Click classroom-level options button
    fireEvent.click(classOptionsBtns[0]);

    // Student must see Leave Class
    expect(screen.getByText('Leave Class')).toBeInTheDocument();
    // Student must NOT see Delete Class
    expect(screen.queryByText('Delete Class')).toBeNull();
  });

  test('15. Classroom-level menu shows Delete Class for Teacher (and Leave Class is NOT shown)', async () => {
    // Teacher owner
    sessionStorage.setItem('userId', 'teacher_id_123');
    mockState = {
      sidebar: { width: '200px' },
      toggleState: { isEnrolled: false },
      createdClasses: { createdClasses: [{ code: 'TEST_CLASS_101', _id: 'classroom_1' }] },
      joinedClasses: { joinedClasses: [] },
      user: { userId: 'teacher_id_123', noOfJoinedClasses: 0 },
      auth: { user: { _id: 'teacher_id_123' } }
    };

    render(
      <MemoryRouter>
        <AnnouncementComponent />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText('Exam Announcement')).toBeInTheDocument();
    });

    // Find classroom-level options button
    const classOptionsBtns = screen.getAllByTitle('Class Options');
    expect(classOptionsBtns.length).toBeGreaterThan(0);

    // Click classroom-level options button
    fireEvent.click(classOptionsBtns[0]);

    // Teacher must see Delete Class
    expect(screen.getByText('Delete Class')).toBeInTheDocument();
    // Teacher must NOT see Leave Class
    expect(screen.queryByText('Leave Class')).toBeNull();
  });
});
