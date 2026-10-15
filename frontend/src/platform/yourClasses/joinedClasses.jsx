import React, { useEffect, useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { MoreHorizontal, Users } from 'lucide-react';
import { useSelector, useDispatch } from 'react-redux';
import './joined.css';
import axios from 'axios';
import { setJoinedClasses } from '../features/joinedClasses';
import { setCreatedClasses } from '../features/createdClasses';
import { setNoOfJoinedClasses } from '../features/userSlice';
import { setIsEnrolled } from '../features/toggleSlice';
import { toast } from 'react-toastify';
import 'react-toastify/dist/ReactToastify.css';
import card from '../assets/cardImg.svg';
import image from '../assets/noclass.svg';

const JoinedClasses = () => {
  const navigate = useNavigate();
  const dispatch = useDispatch();
  const sidebarWidth = useSelector((state) => state.sidebar.width);
  const joinedClasses = useSelector((state) => state.joinedClasses.joinedClasses);
  const createdClasses = useSelector((state) => state.createdClasses.createdClasses);
  const noOfJoinedClasses = useSelector((state) => state.user.noOfJoinedClasses);
  const isEnrolled = useSelector((state) => state.toggleState.isEnrolled);

  const [activePopupIndex, setActivePopupIndex] = useState(null);
  const [deletedClassIndex, setDeletedClassIndex] = useState(null);
  const [isMobile, setIsMobile] = useState(window.innerWidth <= 1024);
  const [selectedClassForLeave, setSelectedClassForLeave] = useState(null);
  const [leaveModalOpen, setLeaveModalOpen] = useState(false);
  const [isLeaving, setIsLeaving] = useState(false);

  const handlePopupToggle = (index) => {
    setActivePopupIndex((prevIndex) => (prevIndex === index ? null : index));
  };

  const handleOpenLeaveModal = (classInfo) => {
    setSelectedClassForLeave(classInfo);
    setLeaveModalOpen(true);
    setActivePopupIndex(null);
  };

  const handleConfirmLeave = async () => {
    if (!selectedClassForLeave) return;
    setIsLeaving(true);
    const token = sessionStorage.getItem('authToken') || localStorage.getItem('authToken');

    try {
      const headers = {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      };

      const response = await axios.post(
        `${process.env.REACT_APP_API_URL}/classroom/leave`,
        { code: selectedClassForLeave.code },
        { headers }
      );

      if (response.status === 200) {
        dispatch(setJoinedClasses(joinedClasses.filter((c) => c.code !== selectedClassForLeave.code)));
        dispatch(setNoOfJoinedClasses(Math.max(0, (noOfJoinedClasses || 1) - 1)));
        toast.success('You have left the class successfully.', {
          className: 'custom-toastS',
          hideProgressBar: true,
          autoClose: 3000,
        });
        setLeaveModalOpen(false);
        setSelectedClassForLeave(null);
      }
    } catch (error) {
      toast.error(error.response?.data?.error || 'Failed to leave class. Please try again.');
    } finally {
      setIsLeaving(false);
    }
  };

  const handleDeleteClass = async (classCode, index) => {
    const token = sessionStorage.getItem('authToken') || localStorage.getItem('authToken');
    setDeletedClassIndex(index);

    try {
      const headers = {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      };

      const response = await axios.post(
        `${process.env.REACT_APP_API_URL}/classroom/delete`,
        { code: classCode },
        { headers }
      );

      if (response.status === 200) {
        dispatch(setCreatedClasses(createdClasses.filter((classInfo) => classInfo.code !== classCode)));
        toast.success('Class deleted successfully!', {
          className: 'custom-toastS',
          hideProgressBar: true,
          autoClose: 3000,
        });
        setDeletedClassIndex(null);
      }
    } catch (error) {
      console.log(error);
    }
  };

  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;

    const fetchData = async () => {
      const token = sessionStorage.getItem('authToken') || localStorage.getItem('authToken');

      try {
        const headers = {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        };

        const response = await axios.get(
          `${process.env.REACT_APP_API_URL}/user/details`,
          { headers, signal }
        );

        if (response.data.success) {
          const { joinedClasses, createdClasses } = response.data.user;
          dispatch(setJoinedClasses(joinedClasses));
          dispatch(setCreatedClasses(createdClasses));


          if (createdClasses.length > 0 && joinedClasses.length === 0) {
            dispatch(setIsEnrolled(false));
          } else if (createdClasses.length === 0 && joinedClasses.length > 0) {
            dispatch(setIsEnrolled(true));
          }
        }
      } catch (error) {
        if (axios.isCancel(error)) {
          console.log('Request canceled');
        } else {
          console.log(error);
        }
      }
    };

    fetchData();

    return () => controller.abort();
  }, [dispatch, navigate]);

  useEffect(() => {
    const handleResize = () => {
      setIsMobile(window.innerWidth <= 1024);
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);
  

  const isEmpty = joinedClasses.length === 0 && createdClasses.length === 0;

  return (
    <div
      className="p-8 bg-[#E1EAE8] min-h-screen"
      style={{ 
        marginLeft: isMobile ? '0' : sidebarWidth,
        transition: 'margin-left 0.3s ease' 
      }}
    >
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {isEmpty ? (
          <div className="text-center text-gray-500 text-lg col-span-full flex flex-col items-center justify-center h-[100vh]">
            <img src={image} alt="" />
            <p className='font-semibold mt-5 text-xl'> You Haven't Joined or Created Any Classes Yet! </p>
            <p>Start your learning journey by joining or creating a class. All your classes will appear here once added.</p>
          </div>
        ) : (
          <>
            <h2 className="text-3xl font-semibold mb-4 mt-[50px] col-span-full">
              {isEnrolled ? 'Your Joined Classes' : 'Your Created Classes'}
            </h2>
            {isEnrolled ? (
              joinedClasses.map((classInfo, index) => (
                <ClassCard
                  key={index}
                  {...classInfo}
                  index={index}
                  activePopupIndex={activePopupIndex}
                  onPopupToggle={handlePopupToggle}
                  onLeave={() => handleOpenLeaveModal(classInfo)}
                  navigate={navigate}
                />
              ))
            ) : (
              createdClasses.map((classInfo, index) => (
                <ClassCard
                  key={index}
                  {...classInfo}
                  index={index}
                  activePopupIndex={activePopupIndex}
                  onPopupToggle={handlePopupToggle}
                  onDelete={() => handleDeleteClass(classInfo.code, index)}
                  isDeleting={deletedClassIndex === index}
                  navigate={navigate}
                />
              ))
            )}
          </>
        )}
      </div>

      {leaveModalOpen && (
        <div className="fixed inset-0 flex items-center justify-center bg-black bg-opacity-50 z-50">
          <div className="bg-white rounded-lg w-[400px] p-6 shadow-xl">
            <h2 className="text-xl font-semibold mb-4 text-gray-800">Leave Class?</h2>
            <p className="text-gray-700 mb-6">
              Are you sure you want to leave "<strong>{selectedClassForLeave?.name}</strong>"? You will no longer have access to this class unless you join it again.
            </p>
            <div className="flex justify-end gap-4">
              <button
                onClick={() => {
                  setLeaveModalOpen(false);
                  setSelectedClassForLeave(null);
                }}
                disabled={isLeaving}
                className="bg-gray-200 px-4 py-2 rounded-lg hover:bg-gray-300 text-gray-800 transition"
              >
                Cancel
              </button>
              <button
                onClick={handleConfirmLeave}
                disabled={isLeaving}
                className="bg-red-500 text-white px-4 py-2 rounded-lg hover:bg-red-600 transition disabled:opacity-50"
              >
                {isLeaving ? 'Leaving...' : 'Leave Class'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

const ClassCard = ({
  name,
  noOfStudents,
  teacher,
  code,
  index,
  onDelete,
  onLeave,
  activePopupIndex,
  onPopupToggle,
  isDeleting,
  navigate,
  _id,
}) => {
  const isEnrolled = useSelector((state) => state.toggleState.isEnrolled);
  const popupRef = useRef(null);

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (popupRef.current && !popupRef.current.contains(event.target)) {
        onPopupToggle(null);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [onPopupToggle]);

  const handleCardClick = () => {
    if (activePopupIndex !== index) {
      navigate(`/announcement`, { state: { code, _id,name } });
    }
  };

  return (
    <div
      className={`relative rounded-xl overflow-hidden ${
        isDeleting ? 'fade-out' : 'fade-in-up'
      }`}
      style={{ animationDelay: `${index * 0.2}s` }}
      onClick={handleCardClick}
    >
      <div className="w-full bg-gradient-to-l from-[#339999] via-[#339999] to-teal-700 text-white p-6 hover:shadow-lg transition-shadow duration-300">
        <div className="flex flex-col h-48">
          <div className="absolute top-4 right-4 z-10">
            <button
              onClick={(e) => {
                e.stopPropagation();
                onPopupToggle(index);
              }}
              className="p-1 hover:bg-white/10 rounded-full transition-colors"
            >
              <MoreHorizontal className="text-white" size={20} />
            </button>
            {activePopupIndex === index && (
              <PopupMenu
                onClose={() => onPopupToggle(null)}
                onDelete={onDelete}
                onLeave={onLeave}
                isEnrolled={isEnrolled}
                ref={popupRef}
              />
            )}
          </div>

          <div className="mb-4 mt-auto flex justify-between">
            <h2 className="text-3xl font-medium">{name}</h2>
            <img src={card} alt="" className='absolute bottom-[20px] right-[20px] w-[140px]'/>
          </div>

          <div className="">
            <div className="flex items-center gap-5">
              <div className="flex items-center gap-2">
                <Users size={20} />
                <span className="text-xl">{noOfStudents}</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 bg-white/20 rounded-full flex items-center justify-center">
                  <span className="text-sm font-medium">
                    {teacher.name.charAt(0).toUpperCase()}
                  </span>
                </div>
                <span className="text-xl">{teacher.name}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

const PopupMenu = React.forwardRef(({ onClose, onDelete, onLeave, isEnrolled }, ref) => (
  <div 
    ref={ref} 
    className="popup absolute right-0 top-12 bg-white border rounded-lg shadow-lg w-40 z-20"
  >
    <ul>
      {!isEnrolled ? (
        <li 
          className="p-2 hover:bg-gray-100 cursor-pointer text-gray-700" 
          onClick={(e) => {
            e.stopPropagation();
            onDelete && onDelete();
          }}
        >
          Delete Class
        </li>
      ) : (
        <li 
          className="p-2 hover:bg-gray-100 cursor-pointer text-red-600 font-medium" 
          onClick={(e) => {
            e.stopPropagation();
            onLeave && onLeave();
          }}
        >
          Leave Class
        </li>
      )}
    </ul>
  </div>
));

export default JoinedClasses;