import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import axios from 'axios';
import YourAssignments from './yourAssingSec';
import RecentGrades from './recentGrades';
import AssignmentDetails from '../assignmentSec/viewAssign';
import AssignmentAnalysis from './assignmentAnalysis';
import Newassignment from './newassignment';

jest.mock('axios');

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

const mockNavigate = jest.fn();
let mockLocationState = {};
jest.mock('react-router-dom', () => ({
  useNavigate: () => mockNavigate,
  useLocation: () => ({ state: mockLocationState, pathname: '/assignment-details' })
}));

let mockIsEnrolled = true;
let mockState = {
  user: { name: 'User Test', noOfJoinedClasses: 2, noOfCreatedClasses: 2 },
  toggleState: { isEnrolled: true },
  sidebar: { width: '250px' },
  createdClasses: {
    createdClasses: [
      { _id: 'cls_owned_1', name: 'Math 101', code: 'MATH101', noOfStudents: 15 },
      { _id: 'cls_owned_2', name: 'Physics 201', code: 'PHYS201', noOfStudents: 20 }
    ]
  },
  joinedClasses: {
    joinedClasses: [
      { _id: 'cls_joined_1', name: 'History 301', code: 'HIST301', noOfStudents: 12 }
    ]
  }
};
const mockDispatch = jest.fn();

jest.mock('react-redux', () => ({
  useSelector: (selector) => selector(mockState),
  useDispatch: () => mockDispatch
}));

describe('Global Student Assignments UX, Status Filtering & Historical Retention', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockIsEnrolled = true;
    mockState = {
      user: { name: 'User Test', noOfJoinedClasses: 2, noOfCreatedClasses: 2 },
      toggleState: { isEnrolled: true },
      sidebar: { width: '250px' },
      createdClasses: {
        createdClasses: [
          { _id: 'cls_owned_1', name: 'Math 101', code: 'MATH101', noOfStudents: 15 },
          { _id: 'cls_owned_2', name: 'Physics 201', code: 'PHYS201', noOfStudents: 20 }
        ]
      },
      joinedClasses: {
        joinedClasses: [
          { _id: 'cls_joined_1', name: 'History 301', code: 'HIST301', noOfStudents: 12 }
        ]
      }
    };
    mockLocationState = {};
    sessionStorage.setItem('authToken', 'test-token');
  });

  afterEach(() => {
    sessionStorage.clear();
  });

  describe('YourAssignments Component & Status Filter', () => {
    const multiAssignments = [
      { _id: 'a1', name: 'Task 1', title: 'Task 1', classroomSubject: 'CS', dueDate: '2026-11-20', status: 'Due' },
      { _id: 'a2', name: 'Task 2', title: 'Task 2', classroomSubject: 'CS', dueDate: '2026-11-21', status: 'Due' },
      { _id: 'a3', name: 'Task 3', title: 'Task 3', classroomSubject: 'CS', dueDate: '2026-10-10', status: 'Submitted' },
      { _id: 'a4', name: 'Task 4', title: 'Task 4', classroomSubject: 'CS', dueDate: '2026-10-01', status: 'Graded', marks: 8 },
      { _id: 'a5', name: 'Task 5 (Grade 0)', title: 'Task 5 (Grade 0)', classroomSubject: 'CS', dueDate: '2026-10-02', status: 'Graded', marks: 0 },
      { _id: 'a6', name: 'Task 6', title: 'Task 6', classroomSubject: 'CS', dueDate: '2026-09-01', status: 'Missing' }
    ];

    test('1, 2, 3, 4, 5, 6. Renders accurate student status badges and displays Grade 0 correctly', async () => {
      axios.get.mockResolvedValueOnce({
        data: {
          user: {
            joinedClassrooms: {
              allAssignments: multiAssignments
            }
          }
        }
      });

      render(<YourAssignments />);

      await waitFor(() => {
        expect(screen.getByText('Task 1')).toBeInTheDocument();
      });

      // 1. Future unsubmitted displays Due
      expect(screen.getAllByText('Due').length).toBeGreaterThan(0);

      // 2 & 6. Submitted displays Submitted
      expect(screen.getAllByText('Submitted').length).toBeGreaterThan(0);

      // 3 & 4. Graded displays Graded and recognizes Grade 0
      expect(screen.getByText('Graded · 0/10')).toBeInTheDocument();
      expect(screen.getByText('Graded · 8/10')).toBeInTheDocument();

      // 5. Past unsubmitted displays Missing
      expect(screen.getAllByText('Missing').length).toBeGreaterThan(0);
    });

    test('15, 16, 17, 18, 19, 20, 21, 22, 23, 24. Status filter works: Default All, Due, Submitted, Graded (with Grade 0), Missing, and Empty State', async () => {
      axios.get.mockResolvedValueOnce({
        data: {
          user: {
            joinedClassrooms: {
              allAssignments: multiAssignments
            }
          }
        }
      });

      render(<YourAssignments />);

      await waitFor(() => {
        expect(screen.getByText('Task 1')).toBeInTheDocument();
      });

      const filterSelect = screen.getByLabelText('Filter assignments by status');

      // 15 & 16. Default filter is All and shows all assignments
      expect(filterSelect.value).toBe('All');
      expect(screen.getByText('Task 1')).toBeInTheDocument();
      expect(screen.getByText('Task 6')).toBeInTheDocument();

      // 17. Filter by Due
      fireEvent.change(filterSelect, { target: { value: 'Due' } });
      expect(screen.getByText('Task 1')).toBeInTheDocument();
      expect(screen.getByText('Task 2')).toBeInTheDocument();
      expect(screen.queryByText('Task 3')).not.toBeInTheDocument();
      expect(screen.queryByText('Task 6')).not.toBeInTheDocument();

      // 18. Filter by Submitted
      fireEvent.change(filterSelect, { target: { value: 'Submitted' } });
      expect(screen.getByText('Task 3')).toBeInTheDocument();
      expect(screen.queryByText('Task 1')).not.toBeInTheDocument();
      expect(screen.queryByText('Task 6')).not.toBeInTheDocument();

      // 19 & 21. Filter by Graded: includes Task 4 and Task 5 (Grade 0)
      fireEvent.change(filterSelect, { target: { value: 'Graded' } });
      expect(screen.getByText('Task 4')).toBeInTheDocument();
      expect(screen.getByText('Task 5 (Grade 0)')).toBeInTheDocument();
      expect(screen.getByText('Graded · 0/10')).toBeInTheDocument();
      expect(screen.queryByText('Task 1')).not.toBeInTheDocument();

      // 20 & 23. Filter by Missing (item #6 was beyond first 4 items, verified that filter applies before any slicing)
      fireEvent.change(filterSelect, { target: { value: 'Missing' } });
      expect(screen.getByText('Task 6')).toBeInTheDocument();
      expect(screen.queryByText('Task 1')).not.toBeInTheDocument();

    });

    test('24. Displays clear empty state message when no assignments match the selected filter', async () => {
      const assignmentsWithoutMissing = multiAssignments.filter(a => a.status !== 'Missing');
      axios.get.mockResolvedValueOnce({
        data: {
          user: {
            joinedClassrooms: {
              allAssignments: assignmentsWithoutMissing
            }
          }
        }
      });

      render(<YourAssignments />);
      await waitFor(() => {
        expect(screen.getByText('Task 1')).toBeInTheDocument();
      });

      const newFilterSelect = screen.getByLabelText('Filter assignments by status');
      fireEvent.change(newFilterSelect, { target: { value: 'Missing' } });
      expect(screen.getByText('No missing assignments.')).toBeInTheDocument();
      expect(screen.queryByText('Task 1')).not.toBeInTheDocument();
    });

    test('7, 8, 26. Clicking filtered assignment card navigates to /assignment-details with real assignment ID', async () => {
      const mockAssignment = {
        _id: 'assign_unique_id_999',
        name: 'Calculus Quiz',
        title: 'Calculus Quiz',
        classroomSubject: 'Math',
        dueDate: '2026-12-01',
        status: 'Due',
        classroom: {
          _id: 'cls_123',
          code: 'CALC101',
          name: 'Calculus'
        }
      };

      axios.get.mockResolvedValueOnce({
        data: {
          user: {
            joinedClassrooms: {
              allAssignments: [mockAssignment]
            }
          }
        }
      });

      render(<YourAssignments />);

      await waitFor(() => {
        expect(screen.getByText('Calculus Quiz')).toBeInTheDocument();
      });

      const titleElement = screen.getByText('Calculus Quiz');
      const card = titleElement.closest('[role="button"]');
      fireEvent.click(card);

      expect(mockNavigate).toHaveBeenCalledTimes(1);
      expect(mockNavigate).toHaveBeenCalledWith('/assignment-details', {
        state: {
          assignment: expect.objectContaining({
            _id: 'assign_unique_id_999',
            name: 'Calculus Quiz'
          }),
          classCode: 'CALC101',
          className: 'Calculus'
        }
      });
    });

    test('9, 18, 27. Set Reminder click only navigates to /calendar and stops parent card navigation', async () => {
      const mockAssignment = {
        _id: 'assign_reminder_test',
        name: 'Literature Essay',
        title: 'Literature Essay',
        classroomSubject: 'English',
        dueDate: '2026-10-30',
        status: 'Due'
      };

      axios.get.mockResolvedValueOnce({
        data: {
          user: {
            joinedClassrooms: {
              allAssignments: [mockAssignment]
            }
          }
        }
      });

      render(<YourAssignments />);

      await waitFor(() => {
        expect(screen.getByText('Literature Essay')).toBeInTheDocument();
      });

      const reminderButton = screen.getByRole('button', { name: 'Set Reminder' });
      fireEvent.click(reminderButton);

      expect(mockNavigate).toHaveBeenCalledTimes(1);
      expect(mockNavigate).toHaveBeenCalledWith('/calendar');
      expect(mockNavigate).not.toHaveBeenCalledWith('/assignment-details', expect.anything());
    });
  });

  describe('RecentGrades & Historical Assignment View', () => {
    test('10, 11, 12, 13, 28. Recent Grade row is clickable, navigates to assignment details, and handles Grade 0', async () => {
      const mockRecentGradesDetails = [
        {
          assignmentId: 'assign_graded_grade0',
          title: 'Physics Lab Report',
          marks: 0,
          formattedGrade: 'Physics Lab Report: 0/10',
          assignment: {
            _id: 'assign_graded_grade0',
            name: 'Physics Lab Report',
            title: 'Physics Lab Report',
            dueDate: '2026-10-10',
            status: 'Graded',
            marks: 0,
            classroom: {
              _id: 'cls_physics',
              code: 'PHY201',
              name: 'Physics II'
            }
          }
        }
      ];

      axios.get.mockResolvedValueOnce({
        data: {
          user: {
            recentGradesDetails: mockRecentGradesDetails,
            recentGrades: ['Physics Lab Report: 0/10']
          }
        }
      });

      render(<RecentGrades />);

      await waitFor(() => {
        expect(screen.getByText('Physics Lab Report: 0/10')).toBeInTheDocument();
      });

      const firstRow = screen.getByText('Physics Lab Report: 0/10').closest('[role="button"]');
      fireEvent.click(firstRow);

      expect(mockNavigate).toHaveBeenCalledTimes(1);
      expect(mockNavigate).toHaveBeenCalledWith('/assignment-details', {
        state: {
          assignment: expect.objectContaining({
            _id: 'assign_graded_grade0',
            name: 'Physics Lab Report',
            marks: 0
          }),
          classCode: 'PHY201',
          className: 'Physics II'
        }
      });
    });

    test('Historical Assignment View renders student attachments from deleted class without calling active-class endpoints or showing "No attachments included"', async () => {
      mockLocationState = {
        assignment: {
          _id: 'hist_assign_1',
          name: 'Algorithms Final Paper',
          dueDate: '2026-09-30',
          description: 'Sorting algorithms study',
          isHistorical: true,
          classroom: null,
          status: 'Graded',
          mySubmission: {
            _id: 'sub_hist_1',
            isGraded: true,
            marks: 8,
            createdAt: '2026-09-29T10:00:00.000Z',
            media: ['https://example.com/student_sorting_paper.pdf']
          }
        }
      };

      render(<AssignmentDetails />);

      // Should render the assignment title
      expect(screen.getByText('Algorithms Final Paper')).toBeInTheDocument();

      // Should display the student's submission grade
      expect(screen.getAllByText(/Graded: 8\/10/i).length).toBeGreaterThan(0);

      // Should render the student's submitted attachment
      expect(screen.getAllByText('student_sorting_paper.pdf').length).toBeGreaterThan(0);

      // Should NOT say "No attachments included."
      expect(screen.queryByText('No attachments included.')).not.toBeInTheDocument();

      // Should display Archived Record indicator in place of active ChatBox
      expect(screen.getByText('Archived Record')).toBeInTheDocument();

      // Should NOT make an unauthorized network call to /submission/my-submission
      expect(axios.get).not.toHaveBeenCalledWith(
        expect.stringContaining('/submission/my-submission'),
        expect.anything()
      );
    });
  });

  describe('Teacher / Created Mode Assignments, Performance Analysis & Create Flow', () => {
    const teacherAssignments = [
      {
        _id: 't_assign_1',
        name: 'Math Midterm Exam',
        title: 'Math Midterm Exam',
        classroomSubject: 'Mathematics',
        dueDate: '2026-12-15',
        status: 'Active',
        classroom: { _id: 'cls_owned_1', name: 'Math 101', code: 'MATH101', subject: 'Mathematics' }
      },
      {
        _id: 't_assign_2',
        name: 'Physics Lab 1',
        title: 'Physics Lab 1',
        classroomSubject: 'Physics',
        dueDate: '2020-01-01',
        status: 'Past Due',
        classroom: { _id: 'cls_owned_2', name: 'Physics 201', code: 'PHYS201', subject: 'Physics' }
      }
    ];

    test('1 & 2. Joined mode renders status filter, while Created mode strictly hides the filter dropdown', async () => {
      // 1. Joined mode (isEnrolled: true) shows filter select
      mockState.toggleState.isEnrolled = true;
      axios.get.mockResolvedValueOnce({
        data: {
          user: {
            joinedClassrooms: { allAssignments: [] },
            createdClassrooms: { allAssignments: teacherAssignments }
          }
        }
      });

      const { unmount } = render(<YourAssignments />);
      expect(screen.getByLabelText('Filter assignments by status')).toBeInTheDocument();
      unmount();

      // 2. Created mode (isEnrolled: false) does NOT render filter select
      mockState.toggleState.isEnrolled = false;
      axios.get.mockResolvedValueOnce({
        data: {
          user: {
            joinedClassrooms: { allAssignments: [] },
            createdClassrooms: { allAssignments: teacherAssignments }
          }
        }
      });

      render(<YourAssignments />);
      await waitFor(() => {
        expect(screen.getByText('Math Midterm Exam')).toBeInTheDocument();
      });
      expect(screen.queryByLabelText('Filter assignments by status')).not.toBeInTheDocument();
    });

    test('3, 4, 5. Switching between Joined and Created modes toggles filter visibility and prevents status filter leakage', async () => {
      // Start in Joined mode with filter selected
      mockState.toggleState.isEnrolled = true;
      axios.get.mockResolvedValueOnce({
        data: {
          user: {
            joinedClassrooms: {
              allAssignments: [
                { _id: 'j1', name: 'Student Task 1', title: 'Student Task 1', classroomSubject: 'CS', dueDate: '2026-11-20', status: 'Due' }
              ]
            },
            createdClassrooms: { allAssignments: teacherAssignments }
          }
        }
      });

      const { rerender } = render(<YourAssignments />);
      await waitFor(() => {
        expect(screen.getByText('Student Task 1')).toBeInTheDocument();
      });
      const filterSelect = screen.getByLabelText('Filter assignments by status');
      fireEvent.change(filterSelect, { target: { value: 'Due' } });

      // Switch to Created mode (isEnrolled: false)
      mockState.toggleState.isEnrolled = false;
      axios.get.mockResolvedValueOnce({
        data: {
          user: {
            joinedClassrooms: { allAssignments: [] },
            createdClassrooms: { allAssignments: teacherAssignments }
          }
        }
      });

      rerender(<YourAssignments />);
      await waitFor(() => {
        expect(screen.getByText('Math Midterm Exam')).toBeInTheDocument();
        expect(screen.getByText('Physics Lab 1')).toBeInTheDocument();
      });
      // Filter must be hidden and teacher assignments must not be corrupted by previous student "Due" filter
      expect(screen.queryByLabelText('Filter assignments by status')).not.toBeInTheDocument();
      expect(screen.getByText('Math Midterm Exam')).toBeInTheDocument();
      expect(screen.getByText('Physics Lab 1')).toBeInTheDocument();
    });

    test('6, 7, 8. Teacher assignments display Active and Past Due badges, and never student statuses (Due/Submitted/Graded/Missing)', async () => {
      mockState.toggleState.isEnrolled = false;
      axios.get.mockResolvedValueOnce({
        data: {
          user: {
            createdClassrooms: { allAssignments: teacherAssignments }
          }
        }
      });

      render(<YourAssignments />);
      await waitFor(() => {
        expect(screen.getByText('Math Midterm Exam')).toBeInTheDocument();
      });

      expect(screen.getByText('Active')).toBeInTheDocument();
      expect(screen.getByText('Past Due')).toBeInTheDocument();
      expect(screen.queryByText('Due')).not.toBeInTheDocument();
      expect(screen.queryByText('Submitted')).not.toBeInTheDocument();
      expect(screen.queryByText('Graded')).not.toBeInTheDocument();
      expect(screen.queryByText('Missing')).not.toBeInTheDocument();
    });

    test('9, 10, 19. Clicking teacher assignment card navigates to /assignment-details with real ID, and Set Reminder works', async () => {
      mockState.toggleState.isEnrolled = false;
      axios.get.mockResolvedValueOnce({
        data: {
          user: {
            createdClassrooms: { allAssignments: [teacherAssignments[0]] }
          }
        }
      });

      render(<YourAssignments />);
      await waitFor(() => {
        expect(screen.getByText('Math Midterm Exam')).toBeInTheDocument();
      });

      // Clicking reminder navigates to /calendar and stops propagation
      const reminderBtn = screen.getByText('Set Reminder');
      fireEvent.click(reminderBtn);
      expect(mockNavigate).toHaveBeenCalledWith('/calendar');
      expect(mockNavigate).not.toHaveBeenCalledWith('/assignment-details', expect.anything());

      // Clicking card navigates to /assignment-details
      const card = screen.getByText('Math Midterm Exam').closest('[role="button"]');
      fireEvent.click(card);
      expect(mockNavigate).toHaveBeenCalledWith('/assignment-details', {
        state: {
          assignment: expect.objectContaining({
            _id: 't_assign_1',
            name: 'Math Midterm Exam'
          }),
          classCode: 'MATH101',
          className: 'Math 101'
        }
      });
    });

    test('11 & 12. Create New Assignment dropdown lists only owned classrooms, never joined classrooms', () => {
      render(<Newassignment />);
      
      const select = screen.getByRole('combobox');
      expect(select).toBeInTheDocument();

      // Should contain owned classrooms
      expect(screen.getByText('Math 101')).toBeInTheDocument();
      expect(screen.getByText('Physics 201')).toBeInTheDocument();

      // Joined classroom (History 301) must NOT be present
      expect(screen.queryByText('History 301')).not.toBeInTheDocument();
    });

    test('13, 14, 18. Teacher assignment details page retains teacher actions (Edit/Delete, Submissions) and does not show student work or 403 calls', async () => {
      mockState.toggleState.isEnrolled = false;
      mockLocationState = {
        assignment: {
          _id: 't_assign_1',
          name: 'Math Midterm Exam',
          dueDate: '2026-12-15',
          description: 'Midterm exam questions',
          status: 'Active',
          classroom: { _id: 'cls_owned_1', name: 'Math 101', code: 'MATH101' },
          submissions: []
        },
        classCode: 'MATH101',
        className: 'Math 101'
      };

      render(<AssignmentDetails />);

      // Teacher sees assignment name
      expect(screen.getByText('Math Midterm Exam')).toBeInTheDocument();

      // Teacher sees Active status
      expect(screen.getByText('Active')).toBeInTheDocument();

      // Teacher does NOT have "Your Work" or "+ Add your work"
      expect(screen.queryByText('Your Work')).not.toBeInTheDocument();
      expect(screen.queryByText('+ Add your work')).not.toBeInTheDocument();

      // Teacher does NOT trigger fetchMySubmission
      expect(axios.get).not.toHaveBeenCalledWith(
        expect.stringContaining('/submission/my-submission'),
        expect.anything()
      );

      // Teacher sees student submissions section
      expect(screen.getByText('Student Submissions')).toBeInTheDocument();
    });

    test('15 & 16. Performance Analysis renders context-aware teacher lifecycle labels in Created mode and student labels in Joined mode', async () => {
      // 1. Created mode (isEnrolled: false)
      mockState.toggleState.isEnrolled = false;
      axios.get.mockResolvedValueOnce({
        data: {
          user: {
            createdClassrooms: {
              activeAssignments: 4,
              dueSoonAssignments: 2,
              overdueAssignments: 1
            }
          }
        }
      });

      const { unmount } = render(<AssignmentAnalysis />);
      await waitFor(() => {
        expect(screen.getByText('Active Assignments (4)')).toBeInTheDocument();
        expect(screen.getByText('Assignments due soon (2)')).toBeInTheDocument();
        expect(screen.getByText('Past Due Assignments (1)')).toBeInTheDocument();
      });
      unmount();

      // 2. Joined mode (isEnrolled: true)
      mockState.toggleState.isEnrolled = true;
      axios.get.mockResolvedValueOnce({
        data: {
          user: {
            joinedClassrooms: {
              completedAssignments: 5,
              dueSoonAssignments: 1,
              overdueAssignments: 0
            }
          }
        }
      });

      render(<AssignmentAnalysis />);
      await waitFor(() => {
        expect(screen.getByText('Completed Assignments (5)')).toBeInTheDocument();
        expect(screen.getByText('Assignments due soon (1)')).toBeInTheDocument();
        expect(screen.getByText('Overdue Assignments (0)')).toBeInTheDocument();
      });
    });

    test('20 & 21. Both Path A and Path B entry payloads resolve to the exact same authoritative detail data: 50% Completed / 50% Not Completed and identical real Created On', async () => {
      mockState.toggleState.isEnrolled = false;
      const expectedDate = 'Oct 12, 2026';

      // Path A Initial State (from global Created assignments)
      const pathAState = {
        assignment: {
          _id: 't_assign_same_1',
          name: 'Same Assignment Test',
          dueDate: '2026-12-20',
          createdAt: expectedDate,
          description: 'Testing entry path consistency',
          classroom: { _id: 'cls_owned_1', name: 'Math 101', code: 'MATH101' },
          status: 'Active',
          submissions: [] // Initially empty in summary
        },
        classCode: 'MATH101',
        className: 'Math 101'
      };

      // Mock authoritative response from GET /api/assignment/get?assignmentId=t_assign_same_1
      axios.get.mockImplementation((url) => {
        if (url.includes('/assignment/get?assignmentId=t_assign_same_1')) {
          return Promise.resolve({
            data: {
              success: true,
              assignment: {
                _id: 't_assign_same_1',
                name: 'Same Assignment Test',
                dueDate: '2026-12-20',
                createdAt: expectedDate,
                description: 'Testing entry path consistency',
                classroom: {
                  _id: 'cls_owned_1',
                  name: 'Math 101',
                  code: 'MATH101',
                  students: ['student_1', 'student_2']
                },
                status: 'Active',
                totalSubmissions: 1,
                submissions: [
                  {
                    _id: 'sub_1',
                    student: { name: 'Student One', email: 's1@test.com' },
                    isGraded: false,
                    marks: null,
                    createdAt: 'Oct 13, 2026'
                  }
                ]
              }
            }
          });
        }
        return Promise.reject(new Error('Unknown url: ' + url));
      });

      // 1. Render through Path A
      mockLocationState = pathAState;
      // In mockState, cls_owned_1 has noOfStudents: 15. Let's set cls_owned_test with 2 students.
      mockState.createdClasses.createdClasses = [
        { _id: 'cls_owned_1', name: 'Math 101', code: 'MATH101', noOfStudents: 2 }
      ];

      const { unmount: unmountA } = render(<AssignmentDetails />);
      
      // Authoritative detail fetch resolves
      await waitFor(() => {
        // Created On date is visible and matches
        expect(screen.getByText('Created On:')).toBeInTheDocument();
        expect(screen.getByText(expectedDate)).toBeInTheDocument();
        // 50.0% Completed and 50.0% Not Completed
        expect(screen.getByText(/50(\.0)?% Completed/i)).toBeInTheDocument();
        expect(screen.getByText(/50(\.0)?% Not Completed/i)).toBeInTheDocument();
      });
      unmountA();

      // 2. Render through Path B
      const pathBState = {
        assignment: {
          _id: 't_assign_same_1',
          name: 'Same Assignment Test',
          dueDate: '2026-12-20',
          createdAt: expectedDate,
          description: 'Testing entry path consistency',
          classroom: 'cls_owned_1',
          status: 'Active',
          submissions: [
            {
              _id: 'sub_1',
              student: { name: 'Student One', email: 's1@test.com' },
              isGraded: false,
              marks: null,
              createdAt: 'Oct 13, 2026'
            }
          ]
        },
        classCode: 'MATH101',
        className: 'Math 101'
      };

      mockLocationState = pathBState;
      const { unmount: unmountB } = render(<AssignmentDetails />);

      await waitFor(() => {
        expect(screen.getByText('Created On:')).toBeInTheDocument();
        expect(screen.getByText(expectedDate)).toBeInTheDocument();
        expect(screen.getByText(/50(\.0)?% Completed/i)).toBeInTheDocument();
        expect(screen.getByText(/50(\.0)?% Not Completed/i)).toBeInTheDocument();
      });
      unmountB();
    });

    test('22. Direct refresh / location.state recovery via sessionStorage recovers assignment', async () => {
      mockState.toggleState.isEnrolled = false;
      sessionStorage.setItem('currentAssignmentId', 't_assign_refresh_1');
      sessionStorage.setItem('currentClassCode', 'MATH101');
      sessionStorage.setItem('currentClassName', 'Math 101');
      mockLocationState = {}; // simulate refresh losing state

      axios.get.mockImplementation((url) => {
        if (url.includes('/assignment/get?assignmentId=t_assign_refresh_1')) {
          return Promise.resolve({
            data: {
              success: true,
              assignment: {
                _id: 't_assign_refresh_1',
                name: 'Refreshed Assignment',
                dueDate: '2026-12-25',
                createdAt: 'Oct 14, 2026',
                description: 'Refreshed description',
                classroom: { _id: 'cls_owned_1', name: 'Math 101', code: 'MATH101', students: ['s1', 's2'] },
                status: 'Active',
                submissions: []
              }
            }
          });
        }
        return Promise.reject(new Error('Unknown url: ' + url));
      });

      render(<AssignmentDetails />);

      await waitFor(() => {
        expect(screen.getByText('Refreshed Assignment')).toBeInTheDocument();
        expect(screen.getByText('Oct 14, 2026')).toBeInTheDocument();
      });
      sessionStorage.clear();
    });
  });
});
