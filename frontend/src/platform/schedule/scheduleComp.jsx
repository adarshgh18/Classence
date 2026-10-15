import React, { useState, useEffect, useRef } from "react";
import axios from "axios";
import { useSelector } from "react-redux";
import { FaEllipsisV } from "react-icons/fa";
import ScheduleLectureModal from "./scheduleModal";
import pana2 from "../assets/pana2.svg";
import { useLocation, useNavigate } from "react-router-dom";
import io from 'socket.io-client';

const ReminderModal = ({ isOpen, onClose, title, lectureId }) => {
  const [reminderTime, setReminderTime] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const popupRef = useRef(null);

  const handleSetReminder = async () => {
    if (!reminderTime) {
      setError("Please select a valid time.");
      return;
    }

    setLoading(true);
    setError("");
    setSuccess("");

    try {
      const utcTime = new Date(reminderTime).toISOString();

      const token =
        sessionStorage.getItem("authToken") || localStorage.getItem("authToken");

      const axiosConfig = {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      };

      const response = await axios.post(
        `${process.env.REACT_APP_API_URL}/reminder`,
        {
          lectureId,
          scheduledTime: utcTime,
        },
        axiosConfig
      );
      console.log(response)
      if (response.data.success) {
        setSuccess("Reminder set successfully!");
        setTimeout(() => {
          onClose();
        }, 1000);
      } else {
        setError("Failed to set the reminder. Please try again.");
      }
    } catch (error) {
      console.error("Error setting reminder:", error);
      setError("An error occurred while setting the reminder.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (popupRef.current && !popupRef.current.contains(event.target)) {
        onClose();
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [onClose]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-30 flex justify-center items-center z-50">
      <div ref={popupRef} className="flex flex-col justify-around bg-white min-w-[300px] w-[90%] max-w-[400px] p-6 h-[40%]">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-3xl">Set Reminder</h2>
          <button
            onClick={onClose}
            className="text-gray-500 text-4xl hover:text-gray-800"
          >
            &times;
          </button>
        </div>
        <div className="mb-6">
          <p className="text-gray-600 mb-4 text-xl">
            We will remind you about your <strong>{`'${title}'`}</strong> lecture via mail.
          </p>
          <input
            type="datetime-local"
            className="w-full border border-gray-300 h-[60px] rounded-lg p-2 focus:outline-none focus:ring-2 focus:ring-[#066769]"
            value={reminderTime}
            onChange={(e) => setReminderTime(e.target.value)}
          />
        </div>
       
        {success && <p className="text-green-500 text-sm">{success}</p>}
        <div className="flex justify-between space-x-4">
          <button
            onClick={onClose}
            className="px-4 py-4 w-1/2 border border-[#066769] text-gray-600 rounded-lg hover:bg-gray-300"
          >
            Cancel
          </button>
          <button
            className="w-1/2 px-4 py-2 bg-[#066769] text-white rounded-lg hover:bg-teal-800"
            onClick={handleSetReminder}
            disabled={loading}
          >
            {loading ? "Setting..." : "Set Reminder"}
          </button>
        </div>
      </div>
    </div>
  );
};

const RevisionClassCard = ({ title }) => {
  const location = useLocation();
  const navigate = useNavigate();
  const isEnrolled = useSelector((state) => state.toggleState.isEnrolled);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isReminderModalOpen, setIsReminderModalOpen] = useState(false);
  const [openMenuId, setOpenMenuId] = useState(null);
  const [lectures, setLectures] = useState([]);
  const [completedLectures, setCompletedLectures] = useState([]);
  const [editingLecture, setEditingLecture] = useState(null);
  const [selectedLectureId, setSelectedLectureId] = useState(null); 
  const popupRef = useRef(null);

  const classCode = location.state?.code;

  const formatDateTime = (dateStr, timeStr) => {
    if (!dateStr && !timeStr) return "";
    const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    let formattedDate = "";
    if (dateStr && typeof dateStr === "string") {
      const parts = dateStr.split("-");
      if (parts.length === 3) {
        const year = parts[0];
        const monthIdx = parseInt(parts[1], 10) - 1;
        const day = parseInt(parts[2], 10);
        if (!isNaN(day) && monthIdx >= 0 && monthIdx < 12) {
          formattedDate = `${day} ${months[monthIdx]} ${year}`;
        } else {
          formattedDate = dateStr;
        }
      } else {
        formattedDate = dateStr;
      }
    }

    let formattedTime = "";
    if (timeStr && typeof timeStr === "string") {
      const timeParts = timeStr.split(":");
      if (timeParts.length >= 2) {
        const hours = parseInt(timeParts[0], 10);
        const minutes = timeParts[1];
        if (!isNaN(hours)) {
          const ampm = hours >= 12 ? "PM" : "AM";
          const h12 = hours % 12 || 12;
          formattedTime = `${String(h12).padStart(2, "0")}:${minutes} ${ampm}`;
        } else {
          formattedTime = timeStr;
        }
      } else {
        formattedTime = timeStr;
      }
    }

    if (formattedDate && formattedTime) {
      return `${formattedDate} • ${formattedTime}`;
    }
    return formattedDate || formattedTime;
  };

  const isStartAllowed = (startTimeStr) => {
    if (!startTimeStr) return true;
    const startMs = new Date(startTimeStr).getTime();
    const earliestAllowed = startMs - (15 * 60 * 1000);
    return Date.now() >= earliestAllowed;
  };

  const fetchLectures = async () => {
    try {
      const token =
        sessionStorage.getItem("authToken") || localStorage.getItem("authToken");
      const axiosConfig = {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      };
      const response = await axios.get(
        `${process.env.REACT_APP_API_URL}/lecture/?code=${classCode}`,
        axiosConfig
      );
      console.log(response.data)
      if (response.status === 200) {
        const futureLectures = Array.isArray(response.data?.futureLectures)
          ? response.data.futureLectures
          : [];
        setLectures(futureLectures);

        const completed = Array.isArray(response.data?.completedLectures)
          ? response.data.completedLectures
          : [];
        setCompletedLectures(completed);
      }
    } catch (error) {
      console.error("Error fetching lectures:", error);
    }
  };

  useEffect(() => {
    fetchLectures();

    const token = sessionStorage.getItem("authToken") || localStorage.getItem("authToken");
    if (!token || !classCode) return;

    const socket = io(process.env.REACT_APP_SOCKET_URL || 'http://localhost:5000', {
      query: { token },
      autoConnect: true
    });

    socket.on('connect', () => {
      socket.emit('join-classroom', { classCode });
    });

    const handleLectureStateChange = () => {
      fetchLectures();
    };

    socket.on('lecture-started', handleLectureStateChange);
    socket.on('lecture-paused', handleLectureStateChange);
    socket.on('lecture-resumed', handleLectureStateChange);
    socket.on('lecture-completed', handleLectureStateChange);

    return () => {
      socket.emit('leave-classroom', { classCode });
      socket.off('lecture-started', handleLectureStateChange);
      socket.off('lecture-paused', handleLectureStateChange);
      socket.off('lecture-resumed', handleLectureStateChange);
      socket.off('lecture-completed', handleLectureStateChange);
      socket.disconnect();
    };
  }, [classCode]);

  const handleDelete = async (lectureId) => {
    try {
      const token =
        sessionStorage.getItem("authToken") || localStorage.getItem("authToken");
      const axiosConfig = {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      };

      const response = await axios.delete(
        `${process.env.REACT_APP_API_URL}/lecture/delete?lectureId=${lectureId}`,
        axiosConfig
      );

      if (response.status === 200) {
        setLectures((prevLectures) =>
          prevLectures.filter((lecture) => lecture._id !== lectureId)
        );
      }
    } catch (error) {
      console.error("Error deleting lecture:", error);
    } finally {
      setOpenMenuId(null);
    }
  };

  const openModal = (lecture = null) => {
    setEditingLecture(lecture);
    setIsModalOpen(true);
  };

  const closeModal = () => {
    setIsModalOpen(false);
    setEditingLecture(null);
    fetchLectures(); // Fetch lectures when the modal is closed
  };

  const toggleMenu = (id) => {
    setOpenMenuId((prev) => (prev === id ? null : id));
  };

  const openReminderModal = (lectureId) => {
    setSelectedLectureId(lectureId);
    setIsReminderModalOpen(true);
  };

  const closeReminderModal = () => {
    setIsReminderModalOpen(false);
    setSelectedLectureId(null);
  };

  const handleJoinLecture = (lectureId, lecture) => {
    navigate('/live', { 
      state: { 
        lectureId,
        classCode,
        teacherId: lecture?.teacher?._id,
        initialStatus: lecture?.status,
        initialIsLive: lecture?.isLive
      }
    });
  };

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (popupRef.current && !popupRef.current.contains(event.target)) {
        setOpenMenuId(null);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, []);

  return (
    <div>
      {!isEnrolled && (
        <button
          className="bg-[#066769] text-white font-medium mb-4 py-4 px-8 rounded-lg"
          onClick={() => openModal()}
        >
          Schedule Lecture
        </button>
      )}

      {/* Upcoming Lectures Section */}
      <div className="mb-6">
        <h2 className="text-xl font-semibold text-gray-800 mb-4">Upcoming Lectures</h2>
        {Array.isArray(lectures) && lectures.length > 0 ? (
          lectures.map((lecture) => (
            <div
              key={lecture._id}
              className="flex justify-between mb-[10px] items-center bg-white rounded-lg px-6 py-4 h-[150px] border border-[#D9DEDE] relative"
            >
              <div className="flex items-center h-full max-w-[60%] overflow-x-auto">
                <img src={pana2} alt="Class Illustration" className="h-full mr-4" />
                <div className="flex flex-col gap-5  h-full justify-around sm:ml-[50px]">
                  <h3 className="text-xl text-gray-800">{lecture.title}</h3>
                  <p className="text-sm text-gray-600">{lecture.description}</p>
                  <div className="flex flex-col text-sm text-gray-500 gap-2">
                    <span>
                      <i className="far fa-clock mr-2"></i> {formatDateTime(lecture.date, lecture.time)}
                    </span>
                  </div>
                </div>
              </div>
              <div className={`flex flex-col ${isEnrolled?'justify-end':'justify-between'} items-end h-full`}>
                {!isEnrolled && (
                <button
                  onClick={() => toggleMenu(lecture._id)}
                  className="p-2 text-gray-600 hover:bg-gray-100 rounded-full"
                >
                  <FaEllipsisV />
                </button>)}
                {openMenuId === lecture._id && (
                  <div ref={popupRef} className="absolute right-0 top-8 bg-white shadow-lg border rounded-lg w-40">
                    <button
                      className="w-full text-left px-4 py-2 hover:bg-gray-100 text-gray-500 rounded-lg"
                      onClick={() => openModal(lecture)}
                    >
                      Edit Lecture
                    </button>
                    <button
                      className="w-full text-left px-4 py-2 hover:bg-gray-100 text-gray-500 rounded-lg"
                      onClick={() => handleDelete(lecture._id)}
                    >
                      Delete Lecture
                    </button>
                  </div>
                )}
                <div className="flex gap-4 items-center">
                  {/* Reminder: Only for upcoming and non-live lectures */}
                  {(!lecture.status || lecture.status === 'upcoming') && !lecture.isLive && (
                    <button
                      className="px-4 py-2 border border-[#066769] text-[#066769] rounded-lg"
                      onClick={() => openReminderModal(lecture._id)}
                    >
                      Set Reminder
                    </button>
                  )}

                  {isEnrolled ? (
                    // Student Actions
                    lecture.isLive ? (
                      <button 
                        className="px-4 py-2 bg-[#066769] text-white rounded-lg hover:bg-teal-800 transition-colors"
                        onClick={() => handleJoinLecture(lecture._id, lecture)}
                      >
                        Join Lecture
                      </button>
                    ) : lecture.status === 'paused' ? (
                      <span className="px-4 py-2 bg-yellow-100 text-yellow-800 rounded-lg text-sm font-medium border border-yellow-300">
                        Session Paused
                      </span>
                    ) : null
                  ) : (
                    // Teacher Actions
                    lecture.isLive ? (
                      <button 
                        className="px-4 py-2 bg-[#066769] text-white rounded-lg hover:bg-teal-800 transition-colors font-medium"
                        onClick={() => handleJoinLecture(lecture._id, lecture)}
                      >
                        Open Live Session
                      </button>
                    ) : lecture.status === 'paused' ? (
                      <button 
                        className="px-4 py-2 bg-[#066769] text-white rounded-lg hover:bg-teal-800 transition-colors font-medium"
                        onClick={() => handleJoinLecture(lecture._id, lecture)}
                      >
                        Resume Lecture
                      </button>
                    ) : (
                      (() => {
                        const allowed = isStartAllowed(lecture.startTime);
                        return (
                          <div className="flex flex-col items-end">
                            <button 
                              className={`px-4 py-2 rounded-lg font-medium transition-colors ${
                                allowed 
                                  ? "bg-[#066769] text-white hover:bg-teal-800" 
                                  : "bg-gray-300 text-gray-500 cursor-not-allowed"
                              }`}
                              disabled={!allowed}
                              onClick={() => allowed && handleJoinLecture(lecture._id, lecture)}
                            >
                              Start Lecture
                            </button>
                            {!allowed && (
                              <span className="text-xs text-gray-400 mt-1">
                                Available 15 mins before start
                              </span>
                            )}
                          </div>
                        );
                      })()
                    )
                  )}
                </div>
              </div>
            </div>
          ))
        ) : (
          <div className="flex flex-col items-center justify-center bg-white rounded-lg p-6 border border-[#D9DEDE] text-center">
            <p className="text-base font-semibold text-gray-600">No upcoming lectures scheduled</p>
            <p className="text-sm text-gray-400 mt-1">You're all caught up! Stay tuned for new lecture schedules.</p>
          </div>
        )}
      </div>

      {/* Lecture History Section */}
      <div className="mt-8 mb-6">
        <h2 className="text-xl font-semibold text-gray-800 mb-4">Lecture History</h2>
        {Array.isArray(completedLectures) && completedLectures.length > 0 ? (
          completedLectures.map((lecture) => (
            <div
              key={lecture._id}
              className="flex justify-between mb-[10px] items-center bg-white rounded-lg px-6 py-4 h-[150px] border border-[#D9DEDE] relative"
            >
              <div className="flex items-center h-full max-w-[60%] overflow-x-auto">
                <img src={pana2} alt="Class Illustration" className="h-full mr-4" />
                <div className="flex flex-col gap-5 h-full justify-around sm:ml-[50px]">
                  <h3 className="text-xl text-gray-800">{lecture.title}</h3>
                  <p className="text-sm text-gray-600">{lecture.description}</p>
                  <div className="flex flex-col text-sm text-gray-500 gap-2">
                    <span>
                      <i className="far fa-clock mr-2"></i> {formatDateTime(lecture.date, lecture.time)}
                    </span>
                  </div>
                </div>
              </div>
              <div className="flex flex-col justify-center items-end h-full">
                <span className="px-4 py-2 bg-gray-100 text-gray-600 rounded-lg text-sm font-medium border border-gray-300">
                  Completed
                </span>
              </div>
            </div>
          ))
        ) : (
          <div className="bg-white rounded-lg p-6 text-center border border-[#D9DEDE]">
            <p className="text-sm text-gray-500 italic">No completed lectures yet.</p>
          </div>
        )}
      </div>

      <ScheduleLectureModal
        isOpen={isModalOpen}
        onClose={closeModal}
        initialData={editingLecture}
      />
      <ReminderModal
        isOpen={isReminderModalOpen}
        onClose={closeReminderModal}
        title={title}
        lectureId={selectedLectureId}
      />
    </div>
  );
};

export default RevisionClassCard;
