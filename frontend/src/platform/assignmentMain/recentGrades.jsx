import React, { useEffect, useState } from "react";
import cardimg from "../assets/bro.svg";
import axios from "axios";
import { useNavigate } from "react-router-dom";

const RecentGrades = () => {
  const [assignmentData, setAssignmentData] = useState(null);
  const navigate = useNavigate();

  useEffect(() => {
    const fetchAssignments = async () => {
      try {
        const token = sessionStorage.getItem('authToken') || localStorage.getItem('authToken');
        const response = await axios.get(`${process.env.REACT_APP_API_URL}/user/assignment`, {
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
          }
        });

        const grades = response.data.user.recentGradesDetails || response.data.user.recentGrades;
        setAssignmentData(grades);
      } catch (error) {
        console.error('Failed to fetch assignments:', error);
      }
    };
    fetchAssignments();
  }, []);

  const handleRowClick = (gradeItem) => {
    const isObj = typeof gradeItem === 'object' && gradeItem !== null;
    if (isObj && gradeItem.assignment) {
      navigate("/assignment-details", {
        state: {
          assignment: gradeItem.assignment,
          classCode: gradeItem.assignment?.classroom?.code,
          className: gradeItem.assignment?.classroom?.name
        }
      });
    } else if (isObj && gradeItem.assignmentId) {
      navigate("/assignment-details", {
        state: {
          assignment: {
            _id: gradeItem.assignmentId,
            name: gradeItem.title,
            title: gradeItem.title,
            status: 'Graded',
            submissionStatus: 'Graded',
            marks: gradeItem.marks
          }
        }
      });
    }
  };

  return (
    <div className="flex flex-col gap-5 h-full">
      <h2 className="text-xl w-[95%] mx-auto">Recent Grades</h2>
      <div className="bg-[#FAFAFA] border border-[#BCE2DF] p-4 rounded-md mx-auto w-[95%] h-[80%] overflow-y-auto">
        <div className="space-y-4 h-full">
          {assignmentData && assignmentData.length > 0 ? (
            assignmentData.map((gradeItem, index) => {
              const isObj = typeof gradeItem === 'object' && gradeItem !== null;
              const displayText = isObj
                ? (gradeItem.formattedGrade || (gradeItem.marks !== null && gradeItem.marks !== undefined
                    ? `${gradeItem.title}: ${gradeItem.marks}/10`
                    : gradeItem.title))
                : gradeItem;
              const itemKey = (isObj && gradeItem.assignmentId) ? gradeItem.assignmentId : index;

              return (
                <div
                  key={itemKey}
                  onClick={() => handleRowClick(gradeItem)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      handleRowClick(gradeItem);
                    }
                  }}
                  className="flex items-center justify-between bg-white rounded-md border border-[#D9DEDE] p-4 transition-all hover:shadow-md hover:border-[#BCE2DF] cursor-pointer"
                >
                  <div className="flex items-center space-x-4 truncate">
                    <img
                      src={cardimg}
                      alt="Grade Icon"
                      className="w-12 h-12 object-contain shrink-0"
                    />
                    <span className="text-lg text-gray-700 truncate font-medium">
                      {displayText}
                    </span>
                  </div>
                  <div className="text-gray-400 shrink-0 ml-2">
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      fill="none"
                      viewBox="0 0 24 24"
                      strokeWidth="2"
                      stroke="currentColor"
                      className="w-5 h-5 text-gray-500 hover:text-gray-700 transition-colors"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M9 5l7 7-7 7"
                      />
                    </svg>
                  </div>
                </div>
              );
            })
          ) : (
            <div className="flex flex-col items-center justify-center h-full text-gray-500">
              <p className="text-xl font-semibold">No grades available.</p>
              <p>Grades will appear here once they are available.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default RecentGrades;