import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { MemoryRouter } from 'react-router-dom';

import HelpPage from './helpandsupp';
import Header from '../header/header';
import userReducer from '../features/userSlice';
import sidebarReducer from '../features/sidebarSlice';
import toggleReducer from '../features/toggleSlice';
import io from 'socket.io-client';

jest.mock('axios');
jest.mock('../../services/socket', () => ({
  getSharedSocket: jest.fn(() => ({
    on: jest.fn(),
    off: jest.fn(),
    emit: jest.fn(),
  })),
  disconnectSharedSocket: jest.fn(),
}));

jest.mock('socket.io-client');

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
        name: 'Jordan Lee',
        email: 'jordan@example.com',
        userId: 'u200',
        noOfJoinedClasses: 2,
        noOfCreatedClasses: 2,
        isNotification: true,
        ...initialUserState,
      },
    },
  });
};

describe('Help & Support Remediation Verification Tests', () => {
  const mockSocket = {
    on: jest.fn(),
    emit: jest.fn(),
    connect: jest.fn(),
    disconnect: jest.fn(),
    connected: true,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    io.mockReturnValue(mockSocket);
  });

  // ==========================================
  // 1. FAQ ACCURACY TESTS
  // ==========================================
  test('1. FAQs render with updated, accurate answers matching live Classence', () => {
    const store = createTestStore();
    render(
      <Provider store={store}>
        <MemoryRouter initialEntries={['/help']}>
          <HelpPage />
        </MemoryRouter>
      </Provider>
    );

    expect(screen.getByText('Frequently Asked Questions')).toBeInTheDocument();

    // Verify all 5 FAQ questions are present
    expect(screen.getByText('How to join a class?')).toBeInTheDocument();
    expect(screen.getByText('How do I reset my password?')).toBeInTheDocument();
    expect(screen.getByText('What should I do if I can’t see my class?')).toBeInTheDocument();
    expect(screen.getByText('How to schedule a class?')).toBeInTheDocument();
    expect(screen.getByText('How to join a lecture?')).toBeInTheDocument();

    // Expand "How to join a class?"
    fireEvent.click(screen.getByText('How to join a class?'));
    expect(
      screen.getByText(/Click the ‘\+’ floating button, select ‘Join Class’, and enter the class code/i)
    ).toBeInTheDocument();

    // Expand "How do I reset my password?"
    fireEvent.click(screen.getByText('How do I reset my password?'));
    expect(
      screen.getByText(/On the login page, click ‘Forgot Password\?’, enter your email to receive a verification OTP/i)
    ).toBeInTheDocument();
    // Confirm old inaccurate text is gone
    expect(screen.queryByText(/Settings > Account > Reset Password/i)).not.toBeInTheDocument();

    // Expand "What should I do if I can’t see my class?"
    fireEvent.click(screen.getByText('What should I do if I can’t see my class?'));
    expect(
      screen.getByText(/Check the ‘Joined’ \| ‘Created’ toggle in the header/i)
    ).toBeInTheDocument();

    // Expand "How to schedule a class?"
    fireEvent.click(screen.getByText('How to schedule a class?'));
    expect(
      screen.getByText(/open the Calendar or use the schedule option to set the lecture date/i)
    ).toBeInTheDocument();

    // Expand "How to join a lecture?"
    fireEvent.click(screen.getByText('How to join a lecture?'));
    expect(
      screen.getByText(/Navigate to Calendar or the Live lecture section/i)
    ).toBeInTheDocument();
  });

  // ==========================================
  // 2. STEP-BY-STEP GUIDES TESTS
  // ==========================================
  test('2. Step-by-Step guides remain present and display concise, accurate instructions', () => {
    const store = createTestStore();
    render(
      <Provider store={store}>
        <MemoryRouter initialEntries={['/help']}>
          <HelpPage />
        </MemoryRouter>
      </Provider>
    );

    expect(screen.getByText('Explore Step-by-Step Guides')).toBeInTheDocument();

    // Profile guide
    expect(screen.getByText('Setting up your profile')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Setting up your profile'));
    expect(
      screen.getByText(/Go to Settings from the sidebar to update your name, profile photo, and notification preferences/i)
    ).toBeInTheDocument();
    expect(screen.queryByText('Guide for setting up your profile')).not.toBeInTheDocument();

    // Dashboard guide
    expect(screen.getByText('Understanding the dashboard')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Understanding the dashboard'));
    expect(
      screen.getByText(/The dashboard provides a quick overview of your courses, upcoming assignments/i)
    ).toBeInTheDocument();

    // Assignments guide
    expect(screen.getByText('Managing Assignments')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Managing Assignments'));
    expect(
      screen.getByText(/Access the Assignments tab to view due dates and submit work/i)
    ).toBeInTheDocument();
  });

  // ==========================================
  // 3. VIEW ALL & FEEDBACK PRESERVATION
  // ==========================================
  test('3. View All link and Feedback UI are preserved, and clicking View All prevents default jump', () => {
    const store = createTestStore();
    render(
      <Provider store={store}>
        <MemoryRouter initialEntries={['/help']}>
          <HelpPage />
        </MemoryRouter>
      </Provider>
    );

    const viewAllLink = screen.getByText('View All >');
    expect(viewAllLink).toBeInTheDocument();

    // Clicking View All should call preventDefault
    const clickEvent = new MouseEvent('click', { bubbles: true, cancelable: true });
    viewAllLink.dispatchEvent(clickEvent);
    expect(clickEvent.defaultPrevented).toBe(true);

    // Feedback UI is preserved
    expect(screen.getByText('Share Your Feedback')).toBeInTheDocument();
    expect(screen.getByText('How Was Your Experience?')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Submit Feedback/i })).toBeInTheDocument();
  });

  // ==========================================
  // 4. CHAT COPY & INPUT VALIDATION TESTS
  // ==========================================
  test('4. Chat with us heading remains, misleading real-time copy is replaced with neutral copy', () => {
    const store = createTestStore();
    render(
      <Provider store={store}>
        <MemoryRouter initialEntries={['/help']}>
          <HelpPage />
        </MemoryRouter>
      </Provider>
    );

    expect(screen.getByText('Chat with us')).toBeInTheDocument();
    expect(screen.getByText('Send us a message for support and assistance.')).toBeInTheDocument();
    expect(screen.queryByText(/Connect with our support team in real-time/i)).not.toBeInTheDocument();
  });

  test('5. Chat file input specifies allowed MIME types for client UX', () => {
    const store = createTestStore();
    const { container } = render(
      <Provider store={store}>
        <MemoryRouter initialEntries={['/help']}>
          <HelpPage />
        </MemoryRouter>
      </Provider>
    );

    const fileInput = container.querySelector('input[type="file"]');
    expect(fileInput).toBeInTheDocument();
    expect(fileInput.getAttribute('accept')).toBe(
      'image/jpeg,image/png,image/webp,application/pdf,text/plain'
    );
  });

  // ==========================================
  // 5. HEADER JOINED | CREATED VISIBILITY ON /help
  // ==========================================
  test('6. Joined | Created header toggle is hidden on /help', () => {
    const store = createTestStore({
      noOfJoinedClasses: 2,
      noOfCreatedClasses: 2,
    });

    render(
      <Provider store={store}>
        <MemoryRouter initialEntries={['/help']}>
          <Header />
        </MemoryRouter>
      </Provider>
    );

    expect(screen.queryByText('Joined')).not.toBeInTheDocument();
    expect(screen.queryByText('Created')).not.toBeInTheDocument();
  });

  test('7. Joined | Created header toggle is still hidden on /settings', () => {
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

  test('8. Joined | Created header toggle remains visible on other routes (/dashboard) when user has both modes', () => {
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
