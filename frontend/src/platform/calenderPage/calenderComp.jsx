import React, { useState, useEffect } from 'react';
import { format, startOfMonth, endOfMonth, addMonths, subMonths, startOfWeek, endOfWeek, addDays, isSameMonth, subDays } from 'date-fns';
import { useSelector } from 'react-redux';
import { useNavigate } from 'react-router-dom';
import Reminders from '../reminder/reminder';
import { Add, Close } from '@mui/icons-material'; 
import ScheduleLectureModal from '../schedule/scheduleModal';
import './calender.css';
import axios from 'axios';
import image from '../assets/calendar_day.svg';

const getDateKey = (dateVal) => {
  if (!dateVal) return '';
  if (typeof dateVal === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(dateVal)) {
    return dateVal;
  }
  try {
    const d = new Date(dateVal);
    if (isNaN(d.getTime())) return '';
    return format(d, 'yyyy-MM-dd');
  } catch {
    return '';
  }
};

const getEventBadgeClasses = (event) => {
  if (event.type === 'assignment') {
    return {
      dot: 'bg-red-500',
      badge: 'border-[#E57373] bg-[#FDF3F3] text-red-700',
      label: event.semanticLabel || 'Assignment Deadline'
    };
  }

  switch (event.status) {
    case 'live':
      return {
        dot: 'bg-emerald-500 animate-pulse',
        badge: 'border-emerald-500 bg-emerald-50 text-emerald-800',
        label: 'Live'
      };
    case 'paused':
      return {
        dot: 'bg-amber-500',
        badge: 'border-amber-500 bg-amber-50 text-amber-800',
        label: 'Paused'
      };
    case 'completed':
      return {
        dot: 'bg-gray-400',
        badge: 'border-gray-400 bg-gray-100 text-gray-600',
        label: 'Completed'
      };
    case 'upcoming':
    default:
      return {
        dot: 'bg-yellow-400',
        badge: 'border-[#FFB74D] bg-[#FFFAED] text-[#B45309]',
        label: 'Upcoming'
      };
  }
};

const Calendar = ({ initialDate }) => {
  const navigate = useNavigate();
  // Canonical selected date shared across Month, Week, and Day views
  const [selectedDate, setSelectedDate] = useState(initialDate ? new Date(initialDate) : new Date());
  const [currentView, setCurrentView] = useState('month');
  const [isPageLoaded, setIsPageLoaded] = useState(false);
  const [isModalOpen, setModalOpen] = useState(false);
  const [selectedEvent, setSelectedEvent] = useState(null);
  const [isMobile, setIsMobile] = useState(window.innerWidth <= 1024);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const sidebarWidth = useSelector((state) => state.sidebar.width);
  const isEnrolled = useSelector((state) => state.toggleState.isEnrolled); 
  const [joinedEvents, setJoinedEvents] = useState([]);
  const [createdEvents, setCreatedEvents] = useState([]);
  const [joinedClasses, setJoinedClasses] = useState([]);
  const [createdClasses, setCreatedClasses] = useState([]);
  const [events, setEvents] = useState({});

  const fetchData = async () => {
    setLoading(true);
    setError(null);
    try {
      const token = sessionStorage.getItem('authToken') || localStorage.getItem('authToken');
      const headers = {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      };
      const response = await axios.get(`${process.env.REACT_APP_API_URL}/user/calendar`, { headers });
      setJoinedClasses(response.data.details?.joined || []);
      setCreatedClasses(response.data.details?.created || []);
    } catch (err) {
      console.error('Error fetching calendar data:', err);
      setError('Failed to load calendar events. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  useEffect(() => {
    const tempJoined = [];
    const tempCreated = [];

    (joinedClasses || []).forEach((joinClass) => {
      if (!joinClass) return;

      (joinClass.assignments || []).forEach((assignment) => {
        if (!assignment) return;
        tempJoined.push({
          id: assignment._id,
          type: 'assignment',
          title: assignment.title || assignment.name || 'Untitled Assignment',
          classroomId: joinClass._id,
          classroomName: joinClass.name,
          classCode: joinClass.code,
          date: assignment.dueDate,
          dueDate: assignment.dueDate,
          semanticLabel: 'Due Assignment'
        });
      });

      (joinClass.lectures || []).forEach((lecture) => {
        if (!lecture) return;
        const lectureDate = lecture.date || (lecture.startTime ? getDateKey(lecture.startTime) : '');
        tempJoined.push({
          id: lecture._id,
          type: 'lecture',
          title: lecture.title || 'Untitled Lecture',
          description: lecture.description || '',
          classroomId: joinClass._id,
          classroomName: joinClass.name,
          classCode: joinClass.code,
          date: lectureDate,
          time: lecture.time || lecture.formattedStartTime || '',
          startTime: lecture.startTime,
          status: lecture.status || 'upcoming',
          semanticLabel: 'Scheduled Class'
        });
      });
    });

    (createdClasses || []).forEach((createClass) => {
      if (!createClass) return;

      (createClass.lectures || []).forEach((lecture) => {
        if (!lecture) return;
        const lectureDate = lecture.date || (lecture.startTime ? getDateKey(lecture.startTime) : '');
        tempCreated.push({
          id: lecture._id,
          type: 'lecture',
          title: lecture.title || 'Untitled Lecture',
          description: lecture.description || '',
          classroomId: createClass._id,
          classroomName: createClass.name,
          classCode: createClass.code,
          date: lectureDate,
          time: lecture.time || lecture.formattedStartTime || '',
          startTime: lecture.startTime,
          status: lecture.status || 'upcoming',
          semanticLabel: 'Scheduled Class'
        });
      });

      // Teacher assignment deadlines included
      (createClass.assignments || []).forEach((assignment) => {
        if (!assignment) return;
        tempCreated.push({
          id: assignment._id,
          type: 'assignment',
          title: assignment.title || assignment.name || 'Untitled Assignment',
          classroomId: createClass._id,
          classroomName: createClass.name,
          classCode: createClass.code,
          date: assignment.dueDate,
          dueDate: assignment.dueDate,
          semanticLabel: 'Assignment Deadline'
        });
      });
    });

    setJoinedEvents(tempJoined);
    setCreatedEvents(tempCreated);
  }, [joinedClasses, createdClasses]);

  useEffect(() => {
    const activeEvents = isEnrolled ? joinedEvents : createdEvents;
    const grouped = {};
    activeEvents.forEach((evt) => {
      const key = getDateKey(evt.date);
      if (!key) return;
      if (!grouped[key]) grouped[key] = [];
      grouped[key].push(evt);
    });
    setEvents(grouped);
  }, [joinedEvents, createdEvents, isEnrolled]);

  const handleEventClick = (event) => {
    if (event.type === 'assignment') {
      navigate('/assignment-details', {
        state: {
          assignmentId: event.id,
          assignment: {
            _id: event.id,
            title: event.title,
            dueDate: event.dueDate
          },
          classCode: event.classCode,
          className: event.classroomName
        }
      });
      return;
    }

    if (event.type === 'lecture' && event.status === 'live') {
      navigate('/live', {
        state: {
          lectureId: event.id,
          classCode: event.classCode,
          initialStatus: event.status,
          initialIsLive: true
        }
      });
      return;
    }

    setSelectedEvent(event);
  };

  const nextMonth = () => setSelectedDate((prev) => addMonths(prev, 1));
  const prevMonth = () => setSelectedDate((prev) => subMonths(prev, 1));

  const nextWeek = () => setSelectedDate((prev) => addDays(prev, 7));
  const prevWeek = () => setSelectedDate((prev) => subDays(prev, 7));

  const nextDay = () => setSelectedDate((prev) => addDays(prev, 1));
  const prevDay = () => setSelectedDate((prev) => subDays(prev, 1));

  const renderDaysOfWeek = () => {
    const daysOfWeek = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    return daysOfWeek.map((day) => (
      <div key={day} className="p-4 h-full flex items-center justify-center border-[0.5px] border-[#ADB8B8] bg-[#D9DEDE] text-black font-medium text-sm">
        {day}
      </div>
    ));
  };

  const renderMonthView = () => {
    const monthStart = startOfMonth(selectedDate);
    const monthEnd = endOfMonth(monthStart);
    const startDate = startOfWeek(monthStart);
    const endDate = endOfWeek(monthEnd);

    const rows = [];
    let days = [];
    let day = startDate;

    while (day <= endDate) {
      for (let i = 0; i < 7; i++) {
        const formattedDate = format(day, 'yyyy-MM-dd');
        const isCurrentMonth = isSameMonth(day, monthStart);
        const dayEvents = events[formattedDate] || [];
        const currentDayCopy = new Date(day);

        days.push(
          <div
            key={formattedDate}
            onClick={() => setSelectedDate(currentDayCopy)}
            className={`relative p-3 h-[100px] flex items-start justify-end border-[0.5px] border-[#ADB8B8] bg-white cursor-pointer hover:bg-gray-50 transition-colors`}
          >
            {isCurrentMonth && (
              <>
                <span className="text-gray-800 font-semibold text-sm">{format(day, 'd')}</span>
                <div className="absolute bottom-1 left-1 flex flex-wrap gap-1 max-w-[85%]">
                  {dayEvents.map((evt) => {
                    const badgeStyles = getEventBadgeClasses(evt);
                    return (
                      <span
                        key={evt.id || `${evt.type}-${evt.title}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          handleEventClick(evt);
                        }}
                        className={`w-2 h-2 rounded-full cursor-pointer hover:scale-125 transition-transform ${badgeStyles.dot}`}
                        title={`${evt.title} ${evt.time ? `(${evt.time})` : ''} • ${badgeStyles.label} • ${evt.classroomName || ''}`}
                      ></span>
                    );
                  })}
                </div>
              </>
            )}
          </div>
        );
        day = addDays(day, 1);
      }
      rows.push(<div key={day.toISOString()} className="grid grid-cols-7 h-[100px]">{days}</div>);
      days = [];
    }
    return rows;
  };

  const renderWeekView = () => {
    const weekStart = startOfWeek(selectedDate);
    const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));

    return (
      <div className="grid grid-cols-7 text-center h-full">
        {days.map((day) => {
          const formattedDate = format(day, 'yyyy-MM-dd');
          const dayEvents = events[formattedDate] || [];
          const currentDayCopy = new Date(day);

          return (
            <div key={formattedDate} className="border-[0.5px] bg-white border-[#ADB8B8] flex flex-col">
              <div
                onClick={() => setSelectedDate(currentDayCopy)}
                className="relative p-3 h-[80px] flex flex-col items-center justify-center cursor-pointer hover:bg-gray-50 transition-colors"
              >
                <span className="text-gray-800 font-semibold text-sm">{format(day, 'E d')}</span>
                <div className="flex space-x-1 mt-1">
                  {dayEvents.map((evt) => {
                    const badgeStyles = getEventBadgeClasses(evt);
                    return (
                      <span
                        key={evt.id || `${evt.type}-${evt.title}`}
                        className={`w-2 h-2 rounded-full ${badgeStyles.dot}`}
                        title={`${evt.title} (${badgeStyles.label})`}
                      ></span>
                    );
                  })}
                </div>
              </div>

              <div className="border-t-[0.5px] h-[350px] bg-white border-[#ADB8B8] p-2 overflow-y-auto custom-scrollbar space-y-2">
                {dayEvents.length > 0 ? (
                  dayEvents.map((evt) => {
                    const badgeStyles = getEventBadgeClasses(evt);
                    return (
                      <div
                        key={evt.id || `${evt.type}-${evt.title}`}
                        onClick={() => handleEventClick(evt)}
                        className={`cursor-pointer flex flex-col p-2 border-l-4 rounded shadow-sm text-left ${badgeStyles.badge} hover:opacity-90 transition-opacity`}
                      >
                        <span className="text-xs font-semibold truncate" title={evt.title}>
                          {evt.title}
                        </span>
                        <div className="flex items-center justify-between text-[11px] text-gray-600 mt-1">
                          <span>{evt.type === 'assignment' ? (evt.dueDate ? `Due: ${evt.dueDate}` : 'Due') : (evt.time || 'Class')}</span>
                          <span className="text-[10px] uppercase font-bold tracking-wider">{badgeStyles.label}</span>
                        </div>
                        {evt.classroomName && (
                          <span className="text-[10px] text-gray-500 truncate mt-0.5">{evt.classroomName}</span>
                        )}
                      </div>
                    );
                  })
                ) : (
                  <div className="text-center text-gray-400 text-xs py-4">No events</div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    );
  };

  const renderDayView = () => {
    const formattedDate = format(selectedDate, 'yyyy-MM-dd');
    const dayEvents = events[formattedDate] || [];

    return (
      <div className="p-6 bg-white border border-gray-200 h-[500px] overflow-y-auto custom-scrollbar">
        <div className="text-center mb-6">
          <h2 className="text-2xl font-semibold text-gray-800">
            {format(selectedDate, 'EEEE, MMMM d, yyyy')}
          </h2>
        </div>

        <div className="space-y-4">
          {dayEvents.length > 0 ? (
            dayEvents.map((evt) => {
              const badgeStyles = getEventBadgeClasses(evt);
              return (
                <div
                  key={evt.id || `${evt.type}-${evt.title}`}
                  className={`flex justify-between items-center p-4 border-l-4 rounded-lg shadow-sm ${badgeStyles.badge}`}
                >
                  <div className="flex flex-col text-left pr-4">
                    <div className="flex items-center space-x-2">
                      <span className="text-lg font-semibold text-gray-900">{evt.title}</span>
                      <span className={`px-2 py-0.5 text-xs font-bold rounded uppercase ${badgeStyles.badge}`}>
                        {badgeStyles.label}
                      </span>
                    </div>
                    <div className="text-sm text-gray-600 mt-1">
                      {evt.type === 'assignment' ? (
                        <span>Deadline: {evt.dueDate}</span>
                      ) : (
                        <span>Time: {evt.time || 'Scheduled'}</span>
                      )}
                      {evt.classroomName && <span> • Class: {evt.classroomName} ({evt.classCode})</span>}
                    </div>
                    {evt.description && (
                      <p className="text-xs text-gray-500 mt-1 italic">{evt.description}</p>
                    )}
                  </div>
                  <button
                    className="px-4 py-2 bg-[#107D7E] text-white rounded-lg hover:bg-[#0B6061] text-sm font-medium whitespace-nowrap shadow-sm"
                    onClick={() => handleEventClick(evt)}
                  >
                    {evt.type === 'assignment' ? 'View Assignment' : (evt.status === 'live' ? 'Join Live Class' : 'View Details')}
                  </button>
                </div>
              );
            })
          ) : (
            <div className="text-center text-gray-500 text-lg flex flex-col justify-center items-center h-[350px]">
              <img src={image} alt="" className="w-24 h-24 mb-4 opacity-80" />
              <p className="text-gray-600 font-semibold text-xl">You're All Caught Up!</p>
              <p className="text-gray-500 mt-2 text-sm">No classes or assignments are scheduled for this date.</p>
            </div>
          )}
        </div>
      </div>
    );
  };

  useEffect(() => {
    setIsPageLoaded(true);
  }, []);

  useEffect(() => {
    const handleResize = () => {
      setIsMobile(window.innerWidth <= 1024);
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  return (
    <div>
      <div
        className={`h-[100vh] mt-[50px] pt-[15px] bg-[#E1EAE8] transition-all duration-500 ease-in-out ${
          isPageLoaded ? 'opacity-100 translate-x-0' : 'opacity-0 translate-x-10'
        }`}
        style={{ marginLeft: isMobile ? '0' : sidebarWidth, transition: 'margin-left 0.3s ease, translate 0.3s ease' }}
      >
        <div className="flex space-x-4 mb-4 ml-[40px]">
          {['month', 'week', 'day'].map((view) => (
            <button
              key={view}
              onClick={() => setCurrentView(view)}
              className={`px-3 py-1 rounded-lg font-semibold ${
                currentView === view ? 'bg-[#ADB8B8] text-[#394141]' : 'bg-none text-[#394141]'
              }`}
            >
              {view.charAt(0).toUpperCase() + view.slice(1)}
            </button>
          ))}
        </div>

        <div className={`flex ${isMobile ? 'flex-col ' : ''}`}>
          <div className={`rounded-lg p-4 ${isMobile ? 'w-full' : 'w-[70%] ml-[28px]'} h-[550px]`}>
            <div className="flex items-center mb-4 h-[7%]">
              <h2 className="text-lg font-semibold text-gray-800 w-[180px]">
                {currentView === 'month'
                  ? format(selectedDate, 'MMMM yyyy')
                  : currentView === 'week'
                  ? format(startOfWeek(selectedDate), 'MMMM yyyy')
                  : format(selectedDate, 'MMMM yyyy')}
              </h2>

              {currentView === 'month' && (
                <>
                  <button onClick={prevMonth} className="text-gray-500 px-2 py-0.5 mx-1 my-0.5 bg-[#D9DEDE] rounded-2xl hover:bg-gray-300">
                    {'<'}
                  </button>
                  <button onClick={nextMonth} className="text-gray-500 px-2 py-0.5 mx-1 my-0.5 bg-[#D9DEDE] rounded-2xl hover:bg-gray-300">
                    {'>'}
                  </button>
                </>
              )}
              {currentView === 'week' && (
                <>
                  <button onClick={prevWeek} className="text-gray-500 px-2 py-0.5 mx-1 my-0.5 bg-[#D9DEDE] rounded-2xl hover:bg-gray-300">
                    {'<'}
                  </button>
                  <button onClick={nextWeek} className="text-gray-500 px-2 py-0.5 mx-1 my-0.5 bg-[#D9DEDE] rounded-2xl hover:bg-gray-300">
                    {'>'}
                  </button>
                </>
              )}
              {currentView === 'day' && (
                <>
                  <button onClick={prevDay} className="text-gray-500 px-2 py-0.5 mx-1 my-0.5 bg-[#D9DEDE] rounded-2xl hover:bg-gray-300">
                    {'<'}
                  </button>
                  <button onClick={nextDay} className="text-gray-500 px-2 py-0.5 mx-1 my-0.5 bg-[#D9DEDE] rounded-2xl hover:bg-gray-300">
                    {'>'}
                  </button>
                </>
              )}

              <div className="flex items-center justify-end space-x-4 w-[100%]">
                <div className="flex items-center space-x-1">
                  <span className="w-2 h-2 bg-red-500 rounded-full"></span>
                  <span className="text-gray-600 text-sm">
                    {isEnrolled ? 'Due Assignment' : 'Assignment Deadline'}
                  </span>
                </div>

                <div className="flex items-center space-x-1">
                  <span className="w-2 h-2 bg-yellow-400 rounded-full"></span>
                  <span className="text-gray-600 text-sm">Scheduled Class</span>
                </div>

                {!isEnrolled && (
                  <button
                    onClick={() => setModalOpen(true)}
                    className="w-[85px] h-[35px] pr-[10px] pl-[10px] bg-[#066769] hover:bg-[#055355] rounded-xl text-white ml-[10px] flex items-center justify-center text-sm font-medium shadow-sm transition-colors"
                  >
                    <Add className="mr-1 text-sm" /> Add
                  </button>
                )}
              </div>
            </div>

            {loading && (
              <div className="text-xs text-gray-500 mb-2">Loading calendar events...</div>
            )}
            {error && (
              <div className="text-xs text-red-500 mb-2 flex items-center space-x-2">
                <span>{error}</span>
                <button onClick={fetchData} className="underline text-blue-600">Retry</button>
              </div>
            )}

            <div className="grid grid-cols-7 h-[10%]">{renderDaysOfWeek()}</div>

            <div className="h-[500px]">
              {currentView === 'month' && renderMonthView()}
              {currentView === 'week' && renderWeekView()}
              {currentView === 'day' && renderDayView()}
            </div>
          </div>
          <Reminders />
        </div>
      </div>

      <ScheduleLectureModal
        isOpen={isModalOpen}
        onClose={() => setModalOpen(false)}
        fromCalendar={true}
        onSuccess={fetchData}
      />

      {/* Lightweight Lecture Details Modal */}
      {selectedEvent && (
        <div className="fixed inset-0 bg-black bg-opacity-40 flex justify-center items-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl max-w-md w-full p-6 relative">
            <button
              onClick={() => setSelectedEvent(null)}
              className="absolute top-4 right-4 text-gray-400 hover:text-gray-600"
            >
              <Close />
            </button>
            <div className="flex items-center space-x-2 mb-3">
              <span className={`px-2 py-0.5 text-xs font-bold rounded uppercase ${getEventBadgeClasses(selectedEvent).badge}`}>
                {getEventBadgeClasses(selectedEvent).label}
              </span>
              <span className="text-xs text-gray-500">{selectedEvent.classroomName} ({selectedEvent.classCode})</span>
            </div>
            <h3 className="text-xl font-bold text-gray-800 mb-2">{selectedEvent.title}</h3>
            <p className="text-sm text-gray-600 mb-4">{selectedEvent.description || 'No description provided.'}</p>
            <div className="bg-gray-50 rounded-lg p-3 text-sm text-gray-700 space-y-1 mb-5">
              <div><span className="font-medium">Date:</span> {selectedEvent.date}</div>
              <div><span className="font-medium">Time:</span> {selectedEvent.time || 'Not specified'}</div>
              <div><span className="font-medium">Status:</span> <span className="capitalize">{selectedEvent.status}</span></div>
            </div>
            <div className="flex justify-end space-x-3">
              {selectedEvent.status === 'live' && (
                <button
                  onClick={() => {
                    navigate('/live', {
                      state: {
                        lectureId: selectedEvent.id,
                        classCode: selectedEvent.classCode,
                        initialStatus: selectedEvent.status,
                        initialIsLive: true
                      }
                    });
                    setSelectedEvent(null);
                  }}
                  className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-sm font-medium"
                >
                  Join Live Class
                </button>
              )}
              <button
                onClick={() => setSelectedEvent(null)}
                className="px-4 py-2 bg-gray-200 hover:bg-gray-300 text-gray-700 rounded-lg text-sm font-medium"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Calendar;
