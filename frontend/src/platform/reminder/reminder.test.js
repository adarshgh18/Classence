import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import Reminders from './reminder';
import axios from 'axios';

jest.mock('axios');

describe('Reminders Component Tests', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  const mockReminders = [
    {
      _id: 'rem_123',
      lecture: {
        _id: 'lec_456',
        title: 'Modern Physics Class'
      },
      scheduledTime: '2026-10-25T14:30:00.000Z'
    }
  ];

  test('9. Displays human-readable formatted date/time instead of raw ISO timestamp', async () => {
    axios.get.mockResolvedValueOnce({
      data: {
        success: true,
        reminders: mockReminders
      }
    });

    render(<Reminders />);

    await waitFor(() => {
      expect(screen.getByText('Modern Physics Class')).toBeInTheDocument();
    });

    // Should NOT display raw ISO string
    expect(screen.queryByText('2026-10-25T14:30:00.000Z')).not.toBeInTheDocument();

    // Should display human-readable formatted string containing '25 Oct 2026'
    expect(screen.getByText(/25 Oct 2026/)).toBeInTheDocument();
  });

  test('16. Reminder edit pre-populates scheduledTime, sends ISO to PUT, and updates UI immediately', async () => {
    axios.get.mockResolvedValueOnce({
      data: {
        success: true,
        reminders: mockReminders
      }
    });

    render(<Reminders />);

    await waitFor(() => {
      expect(screen.getByText('Modern Physics Class')).toBeInTheDocument();
    });

    // Click 3-dot popup icon
    const moreIcon = screen.getByTestId('MoreVertIcon');
    fireEvent.click(moreIcon);

    // Click Edit button
    const editBtn = screen.getByText('Edit');
    fireEvent.click(editBtn);

    // Modal opens with pre-populated datetime input
    const timeInput = screen.getByLabelText(/Time/i);
    expect(timeInput).toBeInTheDocument();
    expect(timeInput.value).toContain('2026-10-25T');

    // Change the time
    fireEvent.change(timeInput, { target: { value: '2026-10-26T16:00' } });

    // Mock PUT response
    const updatedIso = new Date('2026-10-26T16:00').toISOString();
    axios.put.mockResolvedValueOnce({
      data: {
        success: true,
        time: updatedIso,
        reminder: {
          _id: 'rem_123',
          scheduledTime: updatedIso
        }
      }
    });

    // Click Save
    const saveBtn = screen.getByText('Save');
    fireEvent.click(saveBtn);

    // PUT was called with updated ISO scheduledTime
    await waitFor(() => {
      expect(axios.put).toHaveBeenCalledWith(
        expect.stringContaining('/reminder/rem_123'),
        expect.objectContaining({ scheduledTime: updatedIso }),
        expect.any(Object)
      );
    });

    // UI updates immediately without reload to show new date (26 Oct 2026)
    await waitFor(() => {
      expect(screen.getByText(/26 Oct 2026/)).toBeInTheDocument();
    });
  });
});
