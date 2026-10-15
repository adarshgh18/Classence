import React, { useEffect, useState, useRef } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import axios from 'axios';
import AddIcon from '@mui/icons-material/AddOutlined';
import AccountIcon from '@mui/icons-material/AccountCircleOutlined';
import NotificationsNoneOutlinedIcon from '@mui/icons-material/NotificationsNoneOutlined';
import { useSelector, useDispatch } from 'react-redux';
import { setIsEnrolled } from '../features/toggleSlice';
import CreateClassModal from '../modals/modal1';
import JoinClassModal from '../modals/modal2';
import { getSharedSocket, disconnectSharedSocket } from '../../services/socket';
import './popup.css';
import created from '../assets/created.svg';  
import joined from '../assets/joined.svg';
import logout from '../assets/logoutImg.svg';

const formatTimeAgo = (dateStr) => {
  if (!dateStr) return '';
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  if (isNaN(diffMs) || diffMs < 0) return 'Just now';
  const diffSec = Math.floor(diffMs / 1000);
  if (diffSec < 60) return 'Just now';
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHours = Math.floor(diffMin / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
};

const Header = () => {
  const [isPopupVisible, setIsPopupVisible] = useState(false);
  const [isAddMenuVisible, setIsAddMenuVisible] = useState(false);
  const [isNotificationOpen, setIsNotificationOpen] = useState(false);
  const [notifications, setNotifications] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [isLoadingNotifications, setIsLoadingNotifications] = useState(false);
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [isJoinModalOpen, setIsJoinModalOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(window.innerWidth <= 1024);

  const name = useSelector(state => state.user.name);
  const joinedClasses = useSelector(state => state.user.noOfJoinedClasses);
  const createdClasses = useSelector(state => state.user.noOfCreatedClasses);

  const popupRef = useRef(null);
  const addMenuRef = useRef(null);
  const notificationRef = useRef(null);
  const seenNotificationIdsRef = useRef(new Set());

  const sidebarWidth = useSelector((state) => state.sidebar.width);
  const location = useLocation();
  const navigate = useNavigate();
  const dispatch = useDispatch();
  const isEnrolled = useSelector((state) => state?.toggleState.isEnrolled);

  const toggleSwitch = () => {
    const newEnrolledState = !isEnrolled;
    dispatch(setIsEnrolled(newEnrolledState));
    sessionStorage.setItem('isEnrolled', JSON.stringify(newEnrolledState));
  };

  const fetchNotifications = async () => {
    try {
      const token = sessionStorage.getItem('authToken') || localStorage.getItem('authToken');
      if (!token) return;
      setIsLoadingNotifications(true);
      const apiUrl = process.env.REACT_APP_API_URL || 'http://localhost:5000/api';
      const res = await axios.get(`${apiUrl}/notification`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res?.data?.success) {
        const notifs = res.data.notifications || [];
        setNotifications(notifs);
        setUnreadCount(res.data.unreadCount || 0);
        seenNotificationIdsRef.current = new Set(notifs.map(n => n._id));
      }
    } catch (err) {
      console.error('Error fetching notifications:', err);
    } finally {
      setIsLoadingNotifications(false);
    }
  };

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (popupRef.current && !popupRef.current.contains(event.target)) {
        setIsPopupVisible(false);
      }
      if (addMenuRef.current && !addMenuRef.current.contains(event.target)) {
        setIsAddMenuVisible(false);
      }
      if (notificationRef.current && !notificationRef.current.contains(event.target)) {
        setIsNotificationOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  useEffect(() => {
    const handleResize = () => {
      setIsMobile(window.innerWidth <= 1024);
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  useEffect(() => {
    const token = sessionStorage.getItem('authToken') || localStorage.getItem('authToken');
    if (!token) return;

    fetchNotifications();

    const socket = getSharedSocket(token);
    if (!socket) return;

    const handleNewNotification = (newNotif) => {
      if (!newNotif || !newNotif._id) return;
      if (seenNotificationIdsRef.current.has(newNotif._id)) {
        return;
      }
      seenNotificationIdsRef.current.add(newNotif._id);

      setUnreadCount(c => c + 1);
      setNotifications(prev => [newNotif, ...prev.filter(n => n._id !== newNotif._id)].slice(0, 30));
    };

    socket.on('notification:new', handleNewNotification);

    return () => {
      socket.off('notification:new', handleNewNotification);
    };
  }, []);

  const handleProfileClick = () => {
    setIsPopupVisible(prev => !prev);
    setIsNotificationOpen(false);
  };

  const toggleNotifications = () => {
    setIsNotificationOpen(prev => !prev);
    setIsPopupVisible(false);
  };

  const handleLogout = () => {
    disconnectSharedSocket();
    localStorage.removeItem('authToken');
    sessionStorage.removeItem('authToken');
    navigate('/login');
  };

  const openCreateClassModal = () => {
    setIsCreateModalOpen(true);
    setIsAddMenuVisible(false);
  };

  const openJoinClassModal = () => {
    setIsJoinModalOpen(true);
    setIsAddMenuVisible(false);
  };

  const toggleAddMenu = () => {
    setIsAddMenuVisible(prevState => !prevState);
  };

  const handleMarkAllAsRead = async () => {
    if (unreadCount === 0) return;

    setNotifications(prev => prev.map(n => ({ ...n, isRead: true })));
    setUnreadCount(0);

    try {
      const token = sessionStorage.getItem('authToken') || localStorage.getItem('authToken');
      const apiUrl = process.env.REACT_APP_API_URL || 'http://localhost:5000/api';
      await axios.patch(
        `${apiUrl}/notification/read-all`,
        {},
        { headers: { Authorization: `Bearer ${token}` } }
      );
    } catch (err) {
      console.error('Failed to mark all as read:', err);
      fetchNotifications();
    }
  };

  const handleNotificationClick = async (notif) => {
    if (!notif.isRead) {
      setNotifications(prev =>
        prev.map(n => (n._id === notif._id ? { ...n, isRead: true } : n))
      );
      setUnreadCount(prev => Math.max(0, prev - 1));

      const token = sessionStorage.getItem('authToken') || localStorage.getItem('authToken');
      const apiUrl = process.env.REACT_APP_API_URL || 'http://localhost:5000/api';
      axios.patch(
        `${apiUrl}/notification/${notif._id}/read`,
        {},
        { headers: { Authorization: `Bearer ${token}` } }
      ).catch(err => {
        console.error('Failed to mark notification as read:', err);
      });
    }

    setIsNotificationOpen(false);

    if (!notif.link) return;

    const token = sessionStorage.getItem('authToken') || localStorage.getItem('authToken');
    const apiUrl = process.env.REACT_APP_API_URL || 'http://localhost:5000/api';

    const classCode = notif.classCode || notif.classroomId?.code || (typeof window !== 'undefined' ? sessionStorage.getItem('currentClassCode') : null);
    const className = notif.className || notif.classroomId?.name || (typeof window !== 'undefined' ? sessionStorage.getItem('currentClassName') : null);
    const classroomId = notif.classroomId?._id || notif.classroomId;

    if (notif.link === '/assignment-details' && notif.assignmentId) {
      const isTeacherNotification = notif.type === 'SUBMISSION_RECEIVED';
      const targetIsEnrolled = !isTeacherNotification;

      dispatch(setIsEnrolled(targetIsEnrolled));
      sessionStorage.setItem('isEnrolled', JSON.stringify(targetIsEnrolled));
      sessionStorage.setItem('currentAssignmentId', notif.assignmentId);
      if (classCode) sessionStorage.setItem('currentClassCode', classCode);
      if (className) sessionStorage.setItem('currentClassName', className);

      try {
        const res = await axios.get(`${apiUrl}/assignment/get?assignmentId=${notif.assignmentId}`, {
          headers: { Authorization: `Bearer ${token}` }
        });

        if (res?.data?.success && res?.data?.assignment) {
          const fullAssignment = res.data.assignment;
          const finalClassCode = fullAssignment.classroom?.code || classCode;
          const finalClassName = fullAssignment.classroom?.name || className;

          if (finalClassCode) sessionStorage.setItem('currentClassCode', finalClassCode);
          if (finalClassName) sessionStorage.setItem('currentClassName', finalClassName);

          navigate('/assignment-details', {
            state: {
              assignment: fullAssignment,
              classCode: finalClassCode,
              className: finalClassName,
              assignmentId: fullAssignment._id
            }
          });
          return;
        }
      } catch (err) {
        console.error('Failed to fetch authoritative assignment before navigation:', err);
      }

      navigate('/assignment-details', {
        state: {
          assignment: {
            _id: notif.assignmentId,
            classroom: {
              _id: classroomId,
              code: classCode,
              name: className
            }
          },
          classCode,
          className,
          assignmentId: notif.assignmentId
        }
      });
    } else if (notif.link === '/announcement') {
      dispatch(setIsEnrolled(true));
      sessionStorage.setItem('isEnrolled', JSON.stringify(true));
      if (classCode) sessionStorage.setItem('currentClassCode', classCode);
      if (className) sessionStorage.setItem('currentClassName', className);

      let resolvedCode = classCode;
      let resolvedName = className;

      if (!resolvedCode && classroomId) {
        try {
          const classRes = await axios.get(`${apiUrl}/classroom/details?code=${classroomId}`, {
            headers: { Authorization: `Bearer ${token}` }
          });
          if (classRes?.data?.classroom) {
            resolvedCode = classRes.data.classroom.code;
            resolvedName = classRes.data.classroom.name;
          }
        } catch (e) {
          // ignore fallback
        }
      }

      navigate('/announcement', {
        state: {
          code: resolvedCode,
          _id: classroomId,
          name: resolvedName
        }
      });
    } else if (notif.link === '/calendar') {
      dispatch(setIsEnrolled(true));
      sessionStorage.setItem('isEnrolled', JSON.stringify(true));
      navigate('/calendar');
    } else {
      navigate(notif.link);
    }
  };

  return (
    <>
      <div
        className={`z-10 h-[50px] flex items-center gap-[2%] fixed bg-[#E1EAE8] border-b border-[rgb(218,224,223)] `}
        style={{
          width: isMobile ? '100%' : `calc(100% - ${sidebarWidth})`, 
          marginLeft: isMobile ? '0px' : `${sidebarWidth}`, 
          transition: 'margin-left 0.3s ease'
        }}
      >
        {location.pathname !== '/announcement' && 
         location.pathname !== '/assignment-details' && 
         location.pathname !== '/assignment-open' && 
         location.pathname !== '/live' && 
         !location.pathname.startsWith('/settings') && 
         !location.pathname.startsWith('/help') && 
         (joinedClasses > 0 && createdClasses > 0) && (
          <div
            onClick={toggleSwitch}
            className={`relative flex items-center bg-[#D9DEDE] rounded-lg cursor-pointer ${isMobile ? 'ml-auto mr-[50px]' : 'ml-[40px]'}`}
            style={{ width: '150px', height: '38px' }}
          >
            <div
              className={`absolute top-0 ml-[2%] mt-[4px] left-0 h-[80%] w-[48%] bg-[#008080] rounded-lg transition-transform duration-300 ${
                isEnrolled ? 'transform translate-x-0' : 'transform translate-x-full'
              }`}
            ></div>
            <div className="flex w-full text-center font-medium z-10">
              <div className={`flex-1 p-2 ${isEnrolled ? 'text-white' : 'text-gray-700'} transition-color duration-300`}>
                Joined
              </div>
              <div className={`flex-1 p-2 ${!isEnrolled ? 'text-white' : 'text-gray-700'} transition-color duration-300`}>
                Created
              </div>
            </div>
          </div>
        )}

        {!isMobile && (
          <div className="flex items-center my-auto ml-[2%] text-gray-700 h-[38px]">
            <span>
              <Link to="/" className="hover:text-black text-xl">Home</Link>
              {location.pathname.split('/').filter(Boolean).map((segment, index) => (
                <span key={index}>
                  {' > '}
                  <Link to={`/${location.pathname.split('/').slice(0, index + 1).join('/')}`} className="hover:text-black text-xl">
                    {segment.charAt(0).toUpperCase() + segment.slice(1)}
                  </Link>
                </span>
              ))}
            </span>
          </div>
        )}

        <div className="min-w-[150px] absolute right-[10px] flex justify-end items-center gap-[18px]">
          {/* Notification Bell */}
          <div className="relative" ref={notificationRef}>
            <button
              id="notification-bell-btn"
              onClick={toggleNotifications}
              className="relative p-1.5 text-gray-700 hover:text-black rounded-full hover:bg-black/5 transition-colors focus:outline-none flex items-center justify-center"
              aria-label="Notifications"
            >
              <NotificationsNoneOutlinedIcon style={{ fontSize: 26 }} />
              {unreadCount > 0 && (
                <span
                  id="notification-badge"
                  className="absolute -top-0.5 -right-0.5 bg-[#E53E3E] text-white text-[10px] font-bold rounded-full min-w-[17px] h-[17px] flex items-center justify-center px-1 shadow-sm leading-none"
                >
                  {unreadCount > 99 ? '99+' : unreadCount}
                </span>
              )}
            </button>

            {/* Notification Dropdown Panel */}
            {isNotificationOpen && (
              <div
                id="notification-dropdown"
                className="popup absolute top-[44px] right-[-45px] sm:right-0 bg-white border border-gray-200 rounded-xl shadow-xl w-[320px] sm:w-[380px] z-50 overflow-hidden flex flex-col text-gray-800"
              >
                {/* Header */}
                <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 bg-[#F8FAFA]">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-sm text-gray-800">Notifications</span>
                    {unreadCount > 0 && (
                      <span className="bg-[#E6F4F1] text-[#008080] text-xs font-semibold px-2 py-0.5 rounded-full">
                        {unreadCount} new
                      </span>
                    )}
                  </div>
                  {unreadCount > 0 && (
                    <button
                      id="mark-all-read-btn"
                      onClick={handleMarkAllAsRead}
                      className="text-xs font-medium text-[#008080] hover:text-[#005f5f] hover:underline transition-colors"
                    >
                      Mark all as read
                    </button>
                  )}
                </div>

                {/* List / Loading / Empty State */}
                <div className="max-h-[380px] overflow-y-auto divide-y divide-gray-100">
                  {isLoadingNotifications ? (
                    <div className="p-8 text-center text-sm text-gray-500">
                      Loading notifications...
                    </div>
                  ) : notifications.length === 0 ? (
                    <div className="p-8 text-center text-gray-400 flex flex-col items-center">
                      <NotificationsNoneOutlinedIcon style={{ fontSize: 40, color: '#CBD5E1' }} className="mb-2" />
                      <p className="text-sm font-medium text-gray-600">No notifications yet</p>
                      <p className="text-xs text-gray-400 mt-1">We'll notify you when important classroom updates arrive.</p>
                    </div>
                  ) : (
                    notifications.map((notif) => (
                      <div
                        key={notif._id}
                        data-notification-id={notif._id}
                        onClick={() => handleNotificationClick(notif)}
                        className={`p-3.5 flex items-start gap-3 cursor-pointer transition-colors ${
                          !notif.isRead
                            ? 'bg-[#F2F8F7] hover:bg-[#EAF3F2]'
                            : 'bg-white hover:bg-[#F9FAFB]'
                        }`}
                      >
                        {/* Unread indicator dot */}
                        <div className="mt-1 flex-shrink-0">
                          {!notif.isRead ? (
                            <span className="block w-2.5 h-2.5 rounded-full bg-[#008080]" />
                          ) : (
                            <span className="block w-2.5 h-2.5 rounded-full bg-transparent" />
                          )}
                        </div>

                        {/* Notification content */}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between gap-2 mb-1">
                            <p className={`text-xs font-semibold truncate ${!notif.isRead ? 'text-gray-900' : 'text-gray-700'}`}>
                              {notif.title}
                            </p>
                            <span className="text-[11px] text-gray-400 whitespace-nowrap flex-shrink-0">
                              {formatTimeAgo(notif.createdAt)}
                            </span>
                          </div>
                          <p className="text-xs text-gray-600 line-clamp-2 leading-relaxed">
                            {notif.message}
                          </p>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Account Profile */}
          <div className="relative">
            <div onClick={handleProfileClick} className="cursor-pointer">
              <AccountIcon style={{ fontSize: 30 }} />
            </div>
            {isPopupVisible && (
              <div
                ref={popupRef}
                className="popup absolute top-[50px] right-0 bg-[#EEF0F0] border border-gray-300 rounded-lg shadow-lg p-4 w-[200px] flex flex-col items-center text-gray-700 z-50"
              >
                <div className="flex flex-col items-center mb-4">
                  <div className="w-16 h-16 rounded-full bg-gray-200 flex items-center justify-center mb-2">
                    <AccountIcon style={{ fontSize: 40 }} />
                  </div>
                  <span className="font-medium text-lg">{name}</span>
                </div>

                <div className="flex flex-col items-center w-full mb-4 text-sm">
                  <div className="flex justify-center items-center w-full mb-2">
                    <span className="material-icons text-gray-500 mr-2"><img src={joined} alt="" /></span>
                    <span>Joined Class: {joinedClasses}</span>
                  </div>
                  <div className="flex justify-center items-center w-full mb-2">
                    <span className="material-icons text-gray-500 mr-2"><img src={created} alt="" /></span>
                    <span>Created Class: {createdClasses}</span>
                  </div>
                </div>

                <button
                  onClick={handleLogout}
                  className="flex justify-center items-center w-full text-gray-700 py-2 px-4 rounded-md hover:scale-105 transition-transform"
                >
                  <img src={logout} alt="" />
                  Logout
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="fixed bottom-8 right-8 z-50">
        <div className="relative">
        {location.pathname !== '/announcement' && 
         location.pathname !== '/assignment-details' && 
         location.pathname !== '/assignment-open' && 
         location.pathname !== '/live' && 
          <button
            onClick={toggleAddMenu}
            className={`bg-[#008080] hover:bg-[#005f5f] text-white rounded-full p-4 shadow-lg flex items-center justify-center transition-transform duration-300 ${
              isAddMenuVisible ? 'rotate-45' : ''
            }`}
            style={{ width: '60px', height: '60px', zIndex: 60 }}
          >
            <AddIcon style={{ fontSize: 30 }} />
          </button>
}
          <div 
            ref={addMenuRef} 
            className={`absolute bottom-[80px] right-0 origin-bottom-right transition-all duration-300 ease-in-out ${
              isAddMenuVisible 
                ? 'opacity-100 scale-100 pointer-events-auto' 
                : 'opacity-0 scale-95 pointer-events-none'
            }`}
          >
            <div className="    p-2 w-[180px] space-y-2">
            <button 
                onClick={openJoinClassModal} 
                className="w-full text-left bg-[#066769]  text-white p-4 rounded-md flex items-center transition-colors duration-200"
              >
                <img src={joined} alt="" className='white-image mr-4' />
                 Join Class
              </button>
              <button 
                onClick={openCreateClassModal} 
                className="w-full text-left bg-[#066769] text-white p-4 rounded-md flex items-center transition-colors duration-200"
              >
                <img src={created} alt="" className='white-image mr-4' />
                 Create Class
              </button>
              
            </div>
          </div>
        </div>
      </div>

      {isCreateModalOpen && <CreateClassModal onClose={() => setIsCreateModalOpen(false)} />}
      {isJoinModalOpen && <JoinClassModal onClose={() => setIsJoinModalOpen(false)} />}
    </>
  );
};

export default Header;