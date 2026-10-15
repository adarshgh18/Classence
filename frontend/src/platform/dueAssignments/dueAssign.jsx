import React, { useState, useEffect } from 'react';
import { useSelector } from 'react-redux';
import { useNavigate } from 'react-router-dom';
import MenuBookIcon from '@mui/icons-material/MenuBook';
import pana from '../assets/pana.svg';
import axios from 'axios';
import noDue from '../assets/rafiki.svg';

const AssignmentCard = ({ assignment }) => {
  const isEnrolled = useSelector((state) => state.toggleState.isEnrolled);
  const navigate = useNavigate();

  const handleCardClick = () => {
    navigate('/assignment-details', {
      state: {
        assignment: {
          ...assignment,
          name: assignment.name || assignment.title,
          title: assignment.title || assignment.name,
        },
        classCode: assignment.classCode || assignment.classroom?.code,
        className: assignment.className || assignment.classroom?.name || assignment.classroomSubject,
      }
    });
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      handleCardClick();
    }
  };

  return (
    <div
      onClick={handleCardClick}
      onKeyDown={handleKeyDown}
      role="button"
      tabIndex={0}
      aria-label={`View assignment ${assignment.title || assignment.name}`}
      className="h-[45%] min-h-[120px] flex justify-between border border-[#D9DEDE] items-center p-4 bg-white rounded-lg cursor-pointer hover:shadow-md transition-shadow focus:outline-none focus:ring-2 focus:ring-[#00A8A5]"
    >
      <div className='flex flex-col h-[95%] justify-between'>
        <h3 className="text-xl">{assignment.title || assignment.name}</h3>
        <div>
          <div className="flex items-center text-sm text-gray-500 mt-1 gap-2">
            <MenuBookIcon />
            <span>{assignment.classroomSubject}</span>
          </div>
          <div className="flex items-center text-gray-600 mt-2 text-lg">
            <span className="h-4 w-4 bg-[#00A8A5] rounded-full mr-2"></span>
            Due Date: {assignment.dueDate}
          </div>
          {!isEnrolled && (
            <div className="text-sm text-gray-600 mt-1">
              Reviewed: {assignment.reviewedSubmissions}/{assignment.totalSubmissions}
              {assignment.pendingReviews !== undefined ? ` (Pending: ${assignment.pendingReviews})` : ''}
            </div>
          )}
        </div>
      </div>
      <div className="">
        <img src={pana} alt="Illustration" className="w-full h-full object-cover rounded-md" />
      </div>
    </div>
  );
};

const DueAssignments = () => {
  const [isMobile, setIsMobile] = useState(window.innerWidth <= 1024);
  const [dashboardData, setDashboardData] = useState([]);
  const isEnrolled = useSelector((state) => state.toggleState.isEnrolled);

  useEffect(() => {
    const handleResize = () => {
      setIsMobile(window.innerWidth <= 1024);
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const token = sessionStorage.getItem("authToken") || localStorage.getItem("authToken");
        const headers = {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        };
        const response = await axios.get(`${process.env.REACT_APP_API_URL}/user/dashboard`, { headers });
        console.log(response.data.details);
        if (isEnrolled) {
          setDashboardData(response.data.details.joined.dueSoonAssignments);
        } else {
          setDashboardData(response.data.details.created.dueSoonAssignments);
        }
      } catch (error) {
        console.log(error);
      }
    };

    fetchData();
  }, [isEnrolled]);

  return (
    <div className={`bg-white p-6 border border-[#BCE2DF] rounded-lg ${isMobile ? 'w-[100%] ml-0' : 'w-[55%] ml-[20px]'} mt-[20px] h-[100%]`}>
      {isEnrolled ? <h2 className="text-2xl mb-6 h-[10%]">Assignments Due Soon</h2> : <h2 className="text-2xl mb-6 h-[10%]">Assignments To Review</h2>}
      
      <div className="h-[90%] space-y-4">
        {dashboardData.length > 0 ? (
          dashboardData.map((assignment, index) => (
            <AssignmentCard
              key={assignment._id || index}
              assignment={assignment}
              illustration={"https://via.placeholder.com/64"}
            />
          ))
        ) : (
          <div className="flex flex-col items-center justify-center h-full text-gray-500">
            <img src={noDue} alt="" className='w-1/2' />

            <p className='text-xl font-semibold'>
              {isEnrolled ? 'No assignments due soon.' : 'No assignments to review.'}
            </p>
            <p>
              {isEnrolled
                ? "You're on top of your work. Keep up the great effort!"
                : "All submitted assignments have been reviewed."}
            </p>
          </div>
        )}
      </div>
    </div>
  );
};

export default DueAssignments;