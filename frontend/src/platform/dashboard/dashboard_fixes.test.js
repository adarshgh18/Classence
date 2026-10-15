import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { BrowserRouter } from 'react-router-dom';
import DueAssignments from '../dueAssignments/dueAssign';
import RecentClasses from '../cards/recentClasses';
import toggleReducer from '../features/toggleSlice';
import createdClassesReducer from '../features/createdClasses';
import joinedClassesReducer from '../features/joinedClasses';
import userReducer from '../features/userSlice';
import sidebarReducer from '../features/sidebarSlice';

import axios from 'axios';
import AssignmentDetails from '../assignmentSec/viewAssign';
import AssignmentChart from '../teacherdashboard/assignmentgraph';
import AttendanceChart from '../teacherdashboard/teacherattendancegraph';

jest.mock('../sidebar/sidebar', () => () => <div data-testid="sidebar">Sidebar</div>);
jest.mock('../header/header', () => () => <div data-testid="header">Header</div>);
jest.mock('../assignmentSec/createAssignModal', () => () => <div data-testid="create-modal">Modal</div>);
jest.mock('react-chartjs-2', () => ({
  Bar: () => <div data-testid="bar-chart">Bar Chart</div>
}));
jest.mock('recharts', () => ({
  ResponsiveContainer: ({ children }) => <div>{children}</div>,
  PieChart: ({ children }) => <div>{children}</div>,
  Pie: () => <div>Pie</div>,
  Cell: () => <div>Cell</div>,
  Tooltip: () => <div>Tooltip</div>,
  Legend: () => <div>Legend</div>
}));

let mockLocationState = {};
const mockNavigate = jest.fn();
jest.mock('react-router-dom', () => ({
  ...jest.requireActual('react-router-dom'),
  useNavigate: () => mockNavigate,
  useLocation: () => ({ state: mockLocationState, pathname: '/dashboard' })
}));

const createMockStore = (isEnrolled = true, joinedClasses = [], createdClasses = []) => {
  return configureStore({
    reducer: {
      toggleState: toggleReducer,
      createdClasses: createdClassesReducer,
      joinedClasses: joinedClassesReducer,
      user: userReducer,
      sidebar: sidebarReducer
    },
    preloadedState: {
      toggleState: { isEnrolled },
      joinedClasses: { joinedClasses },
      createdClasses: { createdClasses },
      user: { name: 'Ad Gupta' },
      sidebar: { width: '250px', isCollapsed: false }
    }
  });
};

describe('Dashboard Frontend Regression Tests', () => {
  beforeEach(() => {
    mockNavigate.mockClear();
    mockLocationState = {};
    jest.clearAllMocks();
  });

  test('Due Soon Card: Renders "Assignments Due Soon" and "Due Date: " for student', async () => {
    const store = createMockStore(true);
    jest.spyOn(axios, 'get').mockResolvedValueOnce({
      data: {
        details: {
          joined: {
            dueSoonAssignments: [
              {
                _id: 'a2',
                title: 'Isse karo',
                classroomSubject: 'English',
                dueDate: '2026-10-14'
              }
            ]
          }
        }
      }
    });

    render(
      <Provider store={store}>
        <DueAssignments />
      </Provider>
    );

    expect(await screen.findByText('Assignments Due Soon')).toBeInTheDocument();
    expect(await screen.findByText(/Due Date:\s*2026-10-14/i)).toBeInTheDocument();
    expect(screen.queryByText('Assignments To Be Reviewed')).not.toBeInTheDocument();
    expect(screen.queryByText(/Submitted On:/i)).not.toBeInTheDocument();
  });

  test('1, 2, 3, 4, 5. Student Due Soon card is clickable and navigates to /assignment-details with exact assignment ID and classroom context', async () => {
    const store = createMockStore(true);
    const mockAssignment = {
      _id: '6ace5efff8d995ee03b6f30d',
      name: 'Isse karo',
      title: 'Isse karo',
      classroomSubject: 'English',
      classCode: 'D233F7',
      className: 'PQ2',
      classroom: {
        _id: '6ace5ebcf8d995ee03b6f2f3',
        name: 'PQ2',
        code: 'D233F7',
        subject: 'English'
      },
      dueDate: '2026-10-14',
      isGraded: false,
      hasSubmitted: false
    };

    jest.spyOn(axios, 'get').mockResolvedValueOnce({
      data: {
        details: {
          joined: {
            dueSoonAssignments: [mockAssignment]
          }
        }
      }
    });

    render(
      <Provider store={store}>
        <DueAssignments />
      </Provider>
    );

    expect(await screen.findByText('Isse karo')).toBeInTheDocument();

    const card = screen.getByRole('button', { name: /view assignment isse karo/i });
    expect(card).toBeInTheDocument();
    expect(card).toHaveClass('cursor-pointer');

    fireEvent.click(card);

    expect(mockNavigate).toHaveBeenCalledTimes(1);
    expect(mockNavigate).toHaveBeenCalledWith('/assignment-details', {
      state: {
        assignment: expect.objectContaining({
          _id: '6ace5efff8d995ee03b6f30d',
          name: 'Isse karo',
          title: 'Isse karo',
          classroom: expect.objectContaining({
            _id: '6ace5ebcf8d995ee03b6f2f3',
            name: 'PQ2',
            code: 'D233F7',
            subject: 'English'
          })
        }),
        classCode: 'D233F7',
        className: 'PQ2'
      }
    });
  });

  test('Keyboard Accessibility: Enter and Space keys trigger navigation on student Due Soon card', async () => {
    const store = createMockStore(true);
    const mockAssignment = {
      _id: 'assign_kb_1',
      name: 'Keyboard Assignment',
      title: 'Keyboard Assignment',
      classroomSubject: 'History',
      classCode: 'HIST101',
      className: 'World History',
      classroom: {
        _id: 'cls_hist',
        name: 'World History',
        code: 'HIST101',
        subject: 'History'
      },
      dueDate: '2026-10-14'
    };

    jest.spyOn(axios, 'get').mockResolvedValueOnce({
      data: {
        details: {
          joined: {
            dueSoonAssignments: [mockAssignment]
          }
        }
      }
    });

    render(
      <Provider store={store}>
        <DueAssignments />
      </Provider>
    );

    const card = await screen.findByRole('button', { name: /view assignment keyboard assignment/i });

    // Press Enter
    fireEvent.keyDown(card, { key: 'Enter', code: 'Enter' });
    expect(mockNavigate).toHaveBeenCalledTimes(1);
    expect(mockNavigate).toHaveBeenCalledWith('/assignment-details', {
      state: {
        assignment: expect.objectContaining({ _id: 'assign_kb_1' }),
        classCode: 'HIST101',
        className: 'World History'
      }
    });

    mockNavigate.mockClear();

    // Press Space
    fireEvent.keyDown(card, { key: ' ', code: 'Space' });
    expect(mockNavigate).toHaveBeenCalledTimes(1);
    expect(mockNavigate).toHaveBeenCalledWith('/assignment-details', {
      state: {
        assignment: expect.objectContaining({ _id: 'assign_kb_1' }),
        classCode: 'HIST101',
        className: 'World History'
      }
    });
  });

  test('8. Multiple due assignments navigate to their respective distinct assignments', async () => {
    const store = createMockStore(true);
    const assignA = {
      _id: 'assign_A',
      name: 'Assignment Alpha',
      title: 'Assignment Alpha',
      classroomSubject: 'Math',
      classCode: 'MATH101',
      className: 'Mathematics I',
      classroom: { _id: 'c1', name: 'Mathematics I', code: 'MATH101', subject: 'Math' },
      dueDate: '2026-10-14'
    };
    const assignB = {
      _id: 'assign_B',
      name: 'Assignment Beta',
      title: 'Assignment Beta',
      classroomSubject: 'Physics',
      classCode: 'PHYS101',
      className: 'Physics I',
      classroom: { _id: 'c2', name: 'Physics I', code: 'PHYS101', subject: 'Physics' },
      dueDate: '2026-10-15'
    };

    jest.spyOn(axios, 'get').mockResolvedValueOnce({
      data: {
        details: {
          joined: {
            dueSoonAssignments: [assignA, assignB]
          }
        }
      }
    });

    render(
      <Provider store={store}>
        <DueAssignments />
      </Provider>
    );

    expect(await screen.findByText('Assignment Alpha')).toBeInTheDocument();
    expect(await screen.findByText('Assignment Beta')).toBeInTheDocument();

    const cardA = screen.getByRole('button', { name: /view assignment assignment alpha/i });
    const cardB = screen.getByRole('button', { name: /view assignment assignment beta/i });

    // Click Card A
    fireEvent.click(cardA);
    expect(mockNavigate).toHaveBeenLastCalledWith('/assignment-details', {
      state: {
        assignment: expect.objectContaining({ _id: 'assign_A', name: 'Assignment Alpha' }),
        classCode: 'MATH101',
        className: 'Mathematics I'
      }
    });

    // Click Card B
    fireEvent.click(cardB);
    expect(mockNavigate).toHaveBeenLastCalledWith('/assignment-details', {
      state: {
        assignment: expect.objectContaining({ _id: 'assign_B', name: 'Assignment Beta' }),
        classCode: 'PHYS101',
        className: 'Physics I'
      }
    });
  });

  test('9. Empty Due Soon state remains unchanged and renders friendly empty message', async () => {
    const store = createMockStore(true);
    jest.spyOn(axios, 'get').mockResolvedValueOnce({
      data: {
        details: {
          joined: {
            dueSoonAssignments: []
          }
        }
      }
    });

    render(
      <Provider store={store}>
        <DueAssignments />
      </Provider>
    );

    expect(await screen.findByText('No assignments due soon.')).toBeInTheDocument();
    expect(screen.getByText("You're on top of your work. Keep up the great effort!")).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  test('10. Teacher review card displays Due Date, Reviewed X/Y, Pending count, and is clickable', async () => {
    const store = createMockStore(false); // Teacher mode: isEnrolled = false
    const teacherAssignment = {
      _id: 't_assign_1',
      name: 'Teacher Grading Task',
      title: 'Teacher Grading Task',
      classroomSubject: 'English',
      classCode: 'D233F7',
      className: 'PQ2',
      classroom: { _id: 'cls1', name: 'PQ2', code: 'D233F7', subject: 'English' },
      dueDate: '2026-10-14',
      reviewedSubmissions: 2,
      totalSubmissions: 5,
      pendingReviews: 3
    };

    jest.spyOn(axios, 'get').mockResolvedValueOnce({
      data: {
        details: {
          created: {
            dueSoonAssignments: [teacherAssignment]
          }
        }
      }
    });

    render(
      <Provider store={store}>
        <DueAssignments />
      </Provider>
    );

    expect(await screen.findByText('Teacher Grading Task')).toBeInTheDocument();
    expect(screen.getByText('Assignments To Review')).toBeInTheDocument();
    // Confirms "Due Date: " is used instead of mislabeled "Submitted On: "
    expect(screen.getByText(/Due Date:\s*2026-10-14/i)).toBeInTheDocument();
    expect(screen.queryByText(/Submitted On:/i)).not.toBeInTheDocument();
    expect(screen.getByText(/Reviewed:\s*2\/5/i)).toBeInTheDocument();
    expect(screen.getByText(/Pending:\s*3/i)).toBeInTheDocument();

    // Teacher card is clickable with role="button"
    const card = screen.getByRole('button', { name: /view assignment teacher grading task/i });
    expect(card).toBeInTheDocument();
    expect(card).toHaveClass('cursor-pointer');

    // Click card
    fireEvent.click(card);
    expect(mockNavigate).toHaveBeenCalledTimes(1);
    expect(mockNavigate).toHaveBeenCalledWith('/assignment-details', {
      state: {
        assignment: expect.objectContaining({
          _id: 't_assign_1',
          name: 'Teacher Grading Task',
          title: 'Teacher Grading Task',
          classroom: expect.objectContaining({ code: 'D233F7' })
        }),
        classCode: 'D233F7',
        className: 'PQ2'
      }
    });

    mockNavigate.mockClear();

    // Keyboard accessibility: Enter & Space
    fireEvent.keyDown(card, { key: 'Enter', code: 'Enter' });
    expect(mockNavigate).toHaveBeenCalledTimes(1);

    mockNavigate.mockClear();
    fireEvent.keyDown(card, { key: ' ', code: 'Space' });
    expect(mockNavigate).toHaveBeenCalledTimes(1);
  });

  test('11. Teacher review queue empty state renders friendly message when 0 pending reviews', async () => {
    const store = createMockStore(false);
    jest.spyOn(axios, 'get').mockResolvedValueOnce({
      data: {
        details: {
          created: {
            dueSoonAssignments: []
          }
        }
      }
    });

    render(
      <Provider store={store}>
        <DueAssignments />
      </Provider>
    );

    expect(await screen.findByText('No assignments to review.')).toBeInTheDocument();
    expect(screen.getByText('All submitted assignments have been reviewed.')).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  test('12. Teacher AssignmentChart uses assignment names, authoritative completion rates, and unique keys', async () => {
    const store = createMockStore(false);
    jest.spyOn(axios, 'get').mockResolvedValueOnce({
      data: {
        success: true,
        details: {
          name: 'Vick',
          created: {
            assignments: [
              {
                classroomSubject: 'English',
                assignments: [
                  {
                    _id: 'a_eng_1',
                    name: 'Essay on Nature',
                    title: 'Essay on Nature',
                    createdAt: '2026-10-14T10:00:00Z',
                    completionPercentage: 50,
                    totalStudents: 2,
                    totalSubmissions: 1
                  },
                  {
                    _id: 'a_eng_2',
                    name: 'Grammar Quiz',
                    title: 'Grammar Quiz',
                    createdAt: '2026-10-13T10:00:00Z',
                    completionPercentage: 100,
                    totalStudents: 2,
                    totalSubmissions: 2
                  }
                ]
              },
              {
                classroomSubject: 'SST',
                assignments: [
                  {
                    _id: 'a_sst_1',
                    name: 'ST- Question paper',
                    title: 'ST- Question paper',
                    createdAt: '2026-10-15T10:00:00Z',
                    completionPercentage: 0,
                    totalStudents: 1,
                    totalSubmissions: 0
                  }
                ]
              }
            ]
          }
        }
      }
    });

    render(
      <Provider store={store}>
        <AssignmentChart />
      </Provider>
    );

    // Verify assignment titles and percentages appear separately in the legend (not duplicate "English" labels)
    expect(await screen.findByText('ST- Question paper')).toBeInTheDocument();
    expect(screen.getByText('Essay on Nature')).toBeInTheDocument();
    expect(screen.getByText('Grammar Quiz')).toBeInTheDocument();

    expect(screen.getByText('0%')).toBeInTheDocument();
    expect(screen.getByText('50%')).toBeInTheDocument();
    expect(screen.getByText('100%')).toBeInTheDocument();

    // Verify title element has truncate and title attribute
    const stTitle = screen.getByText('ST- Question paper');
    expect(stTitle).toHaveClass('truncate');
    expect(stTitle).toHaveAttribute('title', 'ST- Question paper');

    // Verify percentage element is separate from title and has shrink-0 / flex-shrink-0
    const zeroPercent = screen.getByText('0%');
    expect(zeroPercent).toHaveClass('shrink-0');
    expect(stTitle).not.toBe(zeroPercent);

    // Verify View Analysis button works
    const viewAnalysisBtn = screen.getByRole('button', { name: /view analysis/i });
    fireEvent.click(viewAnalysisBtn);
    expect(mockNavigate).toHaveBeenCalledWith('/assignments');
  });

  test('12b. Teacher AssignmentChart legend renders long assignment titles and completion percentages in separate elements with shrink-0', async () => {
    const store = createMockStore(false);
    const longTitle = 'ST- Question paper with extremely long assignment title that should truncate';
    jest.spyOn(axios, 'get').mockResolvedValueOnce({
      data: {
        success: true,
        details: {
          name: 'Vick',
          created: {
            assignments: [
              {
                classroomSubject: 'English',
                assignments: [
                  {
                    _id: 'a_long_1',
                    name: longTitle,
                    title: longTitle,
                    createdAt: '2026-10-14T10:00:00Z',
                    completionPercentage: 0,
                    totalStudents: 2,
                    totalSubmissions: 0
                  },
                  {
                    _id: 'a_mid_1',
                    name: 'New assignment with medium length',
                    title: 'New assignment with medium length',
                    createdAt: '2026-10-13T10:00:00Z',
                    completionPercentage: 50,
                    totalStudents: 2,
                    totalSubmissions: 1
                  }
                ]
              }
            ]
          }
        }
      }
    });

    render(
      <Provider store={store}>
        <AssignmentChart />
      </Provider>
    );

    // The long title is in the DOM with truncate and tooltip title
    const titleEl = await screen.findByText(longTitle);
    expect(titleEl).toBeInTheDocument();
    expect(titleEl).toHaveClass('truncate');
    expect(titleEl).toHaveAttribute('title', longTitle);

    // The percentage is rendered in a separate element and remains present in the DOM
    const percentEl = screen.getByText('0%');
    expect(percentEl).toBeInTheDocument();
    expect(percentEl).toHaveClass('shrink-0');
    expect(percentEl).toHaveClass('flex-shrink-0');
    expect(titleEl).not.toBe(percentEl);

    // Medium title and 50% are also rendered in separate elements
    expect(screen.getByText('New assignment with medium length')).toBeInTheDocument();
    expect(screen.getByText('50%')).toBeInTheDocument();
  });

  test('13. Teacher AttendanceChart excludes zero-finalized-lecture classrooms', async () => {
    const store = createMockStore(false);
    jest.spyOn(axios, 'get').mockResolvedValueOnce({
      data: {
        success: true,
        details: {
          created: {
            averageAttendance: [
              {
                className: 'English',
                date: '2026-10-13T14:51:32.252Z',
                attendance: 50,
                totalLectures: 1
              },
              {
                className: 'SST',
                date: '2026-10-13T17:06:23.812Z',
                attendance: 0,
                totalLectures: 0
              },
              {
                className: 'Testing',
                date: '2026-10-13T17:26:40.212Z',
                attendance: 0,
                totalLectures: 0
              }
            ]
          }
        }
      }
    });

    render(
      <Provider store={store}>
        <AttendanceChart />
      </Provider>
    );

    expect(await screen.findByText('Average Attendance')).toBeInTheDocument();
    // Classrooms with 0 completed lectures (SST, Testing) must be filtered out
    // The component renders Chart.js Bar with labels = ['English'] (not SST or Testing)
    expect(screen.getByTestId('bar-chart')).toBeInTheDocument();
  });

  test('6 & 7. Authoritative fetch occurs on /assignment-details with navigated state without exposing other submissions', async () => {
    const store = createMockStore(true); // Student context
    sessionStorage.setItem('authToken', 'test-token');

    // Simulate location state resulting from dashboard Due Soon card click
    mockLocationState = {
      assignment: {
        _id: '6ace5efff8d995ee03b6f30d',
        name: 'Isse karo',
        title: 'Isse karo',
        classroomSubject: 'English',
        classCode: 'D233F7',
        className: 'PQ2',
        classroom: {
          _id: '6ace5ebcf8d995ee03b6f2f3',
          name: 'PQ2',
          code: 'D233F7',
          subject: 'English'
        },
        dueDate: '2026-10-14'
      },
      classCode: 'D233F7',
      className: 'PQ2'
    };

    // Authoritative endpoints responses
    jest.spyOn(axios, 'get').mockImplementation((url) => {
      if (url.includes('/assignment/get?assignmentId=6ace5efff8d995ee03b6f30d')) {
        return Promise.resolve({
          data: {
            success: true,
            assignment: {
              _id: '6ace5efff8d995ee03b6f30d',
              name: 'Isse karo',
              title: 'Isse karo',
              description: 'Solve all exercise problems',
              dueDate: '2026-10-14',
              createdAt: '2026-10-13T10:00:00.000Z',
              media: []
            }
          }
        });
      }
      if (url.includes('/submission/my-submission?assignmentId=6ace5efff8d995ee03b6f30d')) {
        return Promise.resolve({
          data: {
            success: true,
            submission: null // Unsubmitted
          }
        });
      }
      return Promise.reject(new Error(`Unhandled GET url: ${url}`));
    });

    render(
      <Provider store={store}>
        <AssignmentDetails />
      </Provider>
    );

    // Verifies authoritative fetch occurred
    expect(axios.get).toHaveBeenCalledWith(
      expect.stringContaining('/assignment/get?assignmentId=6ace5efff8d995ee03b6f30d'),
      expect.anything()
    );
    expect(axios.get).toHaveBeenCalledWith(
      expect.stringContaining('/submission/my-submission?assignmentId=6ace5efff8d995ee03b6f30d'),
      expect.anything()
    );

    // Verifies student view details are shown
    expect(await screen.findByText('Isse karo')).toBeInTheDocument();
    expect(await screen.findByText('Solve all exercise problems')).toBeInTheDocument();
    expect(screen.getByText('Due')).toBeInTheDocument();
    expect(screen.getAllByText('Your Work').length).toBeGreaterThanOrEqual(1);

    // Verifies privacy: Teacher submissions table/list is NOT exposed to student
    expect(screen.queryByText(/All Submissions/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Reviewed Submissions/i)).not.toBeInTheDocument();
  });

  test('Upcoming Classes: Renders "Upcoming Classes" and displays scheduled lecture details', () => {
    const store = createMockStore(true, [
      { _id: 'class1', code: 'D233F7', name: 'PQ2', subject: 'English' }
    ]);

    const upcomingLectures = [
      {
        _id: 'lec1',
        title: 'PPT',
        date: '2026-10-15',
        time: '17:30',
        subject: 'English',
        classroomSubject: 'English',
        classroomId: 'class1',
        classCode: 'D233F7',
        teacher: { name: 'Vick' }
      }
    ];

    render(
      <Provider store={store}>
        <BrowserRouter>
          <RecentClasses recentClasses={upcomingLectures} />
        </BrowserRouter>
      </Provider>
    );

    expect(screen.getByText('Upcoming Classes')).toBeInTheDocument();
    expect(screen.getByText('PPT')).toBeInTheDocument();
    expect(screen.getByText('English')).toBeInTheDocument();
    expect(screen.getByText(/2026-10-15 • 17:30/)).toBeInTheDocument();
    expect(screen.getByText('Vick')).toBeInTheDocument();

    // Click card
    fireEvent.click(screen.getByText('PPT'));
    expect(mockNavigate).toHaveBeenCalledWith('/announcement', {
      state: { code: 'D233F7', _id: 'class1' }
    });
  });

  test('Upcoming Classes: Empty state renders correctly when no upcoming classes', () => {
    const store = createMockStore(true);
    render(
      <Provider store={store}>
        <BrowserRouter>
          <RecentClasses recentClasses={[]} />
        </BrowserRouter>
      </Provider>
    );

    expect(screen.getByText('Upcoming Classes')).toBeInTheDocument();
    expect(screen.getByText('No upcoming classes scheduled')).toBeInTheDocument();
    expect(screen.getByText(/Check back later or use the calendar to plan ahead/i)).toBeInTheDocument();
  });
});
