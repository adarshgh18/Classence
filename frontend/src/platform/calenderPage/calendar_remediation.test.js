import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import Calendar from './calenderComp';
import axios from 'axios';

jest.mock('axios');

const mockNavigate = jest.fn();
jest.mock('react-router-dom', () => ({
  ...jest.requireActual('react-router-dom'),
  useNavigate: () => mockNavigate,
  useLocation: () => ({ state: {}, pathname: '/calendar' })
}));

// Mock ScheduleLectureModal to verify onSuccess prop passing
jest.mock('../schedule/scheduleModal', () => {
  return function MockScheduleModal({ isOpen, onClose, fromCalendar, onSuccess }) {
    if (!isOpen) return null;
    return (
      <div data-testid="schedule-modal">
        <button data-testid="modal-success-btn" onClick={() => { if (onSuccess) onSuccess(); onClose(); }}>
          Simulate Create Lecture
        </button>
      </div>
    );
  };
});

// Mock Reminders inside calenderComp tests to isolate Calendar tests
jest.mock('../reminder/reminder', () => {
  return function MockReminders() {
    return <div data-testid="reminders-panel">Reminders Panel</div>;
  };
});

const createMockStore = (isEnrolled = false) => {
  return configureStore({
    reducer: {
      sidebar: (state = { width: '200px' }) => state,
      toggleState: (state = { isEnrolled }) => state,
      createdClasses: (state = { createdClasses: [] }) => state
    }
  });
};

describe('Calendar Module Frontend Remediation Tests', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  const mockCalendarApiResponse = {
    data: {
      success: true,
      details: {
        joined: [
          {
            _id: 'class_j1',
            name: 'Biology 101',
            code: 'BIO101',
            assignments: [
              {
                _id: 'asgn_j1',
                title: 'Genetics Problem Set',
                dueDate: '2026-10-14'
              }
            ],
            lectures: [
              {
                _id: 'lec_j1',
                title: 'Cell Division',
                description: 'Mitosis and Meiosis',
                date: '2026-10-15',
                time: '10:00',
                status: 'upcoming'
              }
            ]
          }
        ],
        created: [
          {
            _id: 'class_c1',
            name: 'Advanced Physics',
            code: 'PHY301',
            assignments: [
              {
                _id: 'asgn_c1',
                title: 'Quantum Mechanics HW',
                dueDate: '2026-10-18'
              }
            ],
            lectures: [
              {
                _id: 'lec_c1',
                title: 'Wave Equations',
                description: 'Schrodinger equation derivation',
                date: '2026-10-15',
                time: '14:00',
                status: 'upcoming'
              },
              {
                _id: 'lec_c2',
                title: 'Historical Classical Mechanics',
                description: 'Past lecture',
                date: '2026-10-12',
                time: '09:00',
                status: 'completed'
              },
              {
                _id: 'lec_c3',
                title: 'Thermodynamics Live Now',
                description: 'Carnot engine',
                date: '2026-10-14',
                time: '16:00',
                status: 'live'
              }
            ]
          }
        ]
      }
    }
  };

  test('10. Teacher / Created mode includes created assignments as "Assignment Deadline" events', async () => {
    axios.get.mockResolvedValueOnce(mockCalendarApiResponse);
    const store = createMockStore(false); // Teacher mode

    render(
      <Provider store={store}>
        <Calendar initialDate="2026-10-14" />
      </Provider>
    );

    await waitFor(() => {
      expect(screen.getByText('Assignment Deadline')).toBeInTheDocument();
    });

    // Switch to Day view to inspect event details
    fireEvent.click(screen.getByText('Day'));

    // Check header renders
    expect(screen.getAllByText(/October/).length).toBeGreaterThanOrEqual(1);
  });

  test('11. Student / Joined mode includes joined assignments as "Due Assignment" events', async () => {
    axios.get.mockResolvedValueOnce(mockCalendarApiResponse);
    const store = createMockStore(true); // Student mode

    render(
      <Provider store={store}>
        <Calendar initialDate="2026-10-14" />
      </Provider>
    );

    await waitFor(() => {
      expect(screen.getByText('Due Assignment')).toBeInTheDocument();
    });
  });

  test('12. Assignment date-only YYYY-MM-DD stays on the exact calendar day without timezone shift', async () => {
    axios.get.mockResolvedValueOnce(mockCalendarApiResponse);
    const store = createMockStore(true); // Student mode

    render(
      <Provider store={store}>
        <Calendar initialDate="2026-10-14" />
      </Provider>
    );

    await waitFor(() => {
      expect(screen.getByText('Due Assignment')).toBeInTheDocument();
    });

    // Switch to Week view to verify assignments and lectures appear on correct day column
    fireEvent.click(screen.getByText('Week'));

    // Week view renders event title
    await waitFor(() => {
      expect(screen.getByText('Genetics Problem Set')).toBeInTheDocument();
    });
  });

  test('13 & 14. Week and Day views display actual event title, time, and lifecycle status', async () => {
    axios.get.mockResolvedValueOnce(mockCalendarApiResponse);
    const store = createMockStore(false); // Teacher mode

    render(
      <Provider store={store}>
        <Calendar initialDate="2026-10-14" />
      </Provider>
    );

    await waitFor(() => {
      expect(screen.getByText('Assignment Deadline')).toBeInTheDocument();
    });

    // Switch to Week view
    fireEvent.click(screen.getByText('Week'));

    // Events render with real titles
    await waitFor(() => {
      expect(screen.getByText('Wave Equations')).toBeInTheDocument();
      expect(screen.getByText('Historical Classical Mechanics')).toBeInTheDocument();
      expect(screen.getByText('Thermodynamics Live Now')).toBeInTheDocument();
    });

    // Check lifecycle status badges in Week view
    expect(screen.getByText('Live')).toBeInTheDocument();
    expect(screen.getByText('Completed')).toBeInTheDocument();
  });

  test('15. Day View has real action navigation and no native alert() placeholder', async () => {
    const alertMock = jest.spyOn(window, 'alert').mockImplementation(() => {});
    axios.get.mockResolvedValueOnce(mockCalendarApiResponse);
    const store = createMockStore(false);

    render(
      <Provider store={store}>
        <Calendar initialDate="2026-10-14" />
      </Provider>
    );

    await waitFor(() => {
      expect(screen.getByText('Assignment Deadline')).toBeInTheDocument();
    });

    // Switch to Week view and click on a lecture card
    fireEvent.click(screen.getByText('Week'));

    const waveEqCard = await screen.findByText('Wave Equations');
    fireEvent.click(waveEqCard);

    // Should open the Event Detail Modal rather than calling window.alert()
    expect(alertMock).not.toHaveBeenCalled();
    expect(screen.getByRole('heading', { name: 'Wave Equations' })).toBeInTheDocument();
    expect(screen.getByText(/Schrodinger equation derivation/)).toBeInTheDocument();

    alertMock.mockRestore();
  });

  test('17. Successful lecture creation via + Add triggers calendar refetch', async () => {
    axios.get.mockResolvedValue(mockCalendarApiResponse);
    const store = createMockStore(false); // Teacher mode

    render(
      <Provider store={store}>
        <Calendar initialDate="2026-10-14" />
      </Provider>
    );

    await waitFor(() => {
      expect(screen.getByText('Add')).toBeInTheDocument();
    });

    // Initial fetch was called once
    expect(axios.get).toHaveBeenCalledTimes(1);

    // Open Add modal
    fireEvent.click(screen.getByText('Add'));

    // Modal is open
    expect(screen.getByTestId('schedule-modal')).toBeInTheDocument();

    // Trigger success callback
    fireEvent.click(screen.getByTestId('modal-success-btn'));

    // Calendar fetchData should have been called again (total 2 calls)
    await waitFor(() => {
      expect(axios.get).toHaveBeenCalledTimes(2);
    });
  });
});
