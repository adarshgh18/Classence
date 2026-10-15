import React, { useState, useEffect } from "react";
import assignmentImg from "../assets/assignCard.svg";
import axios from "axios";
import { useSelector } from "react-redux";
import { useNavigate } from "react-router-dom";

const getStatusBadgeStyle = (status) => {
  switch (status) {
    case "Graded":
      return "bg-[#C8EAC9] text-[#1E6B20]";
    case "Submitted":
      return "bg-[#E0F2FE] text-[#0369A1]";
    case "Missing":
    case "Past Due":
      return "bg-[#FEE2E2] text-[#991B1B]";
    case "Due":
    case "Active":
    default:
      return "bg-[#FFF3D4] text-[#8C6B00]";
  }
};

const YourAssignments = () => {
  const isEnrolled = useSelector((state) => state.toggleState.isEnrolled);
  const [assignments, setAssignments] = useState([]);
  const [statusFilter, setStatusFilter] = useState("All");
  const navigate = useNavigate();

  useEffect(() => {
    const fetchData = async () => {
      try {
        const token = sessionStorage.getItem("authToken") || localStorage.getItem("authToken");
        const response = await axios.get(`${process.env.REACT_APP_API_URL}/user/assignment`, {
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
          }
        });
        if (isEnrolled) {
          const list = response.data.user.joinedClassrooms.allAssignments || [];
          setAssignments(list);
        } else {
          const list = response.data.user.createdClassrooms.allAssignments || [];
          setAssignments(list);
        }
      } catch (error) {
        console.log(error);
      }
    };

    fetchData();
  }, [isEnrolled]);

  useEffect(() => {
    setStatusFilter("All");
  }, [isEnrolled]);

  const handleCardClick = (assignment) => {
    navigate("/assignment-details", {
      state: {
        assignment: {
          ...assignment,
          name: assignment.name || assignment.title,
        },
        classCode: assignment.classroom?.code,
        className: assignment.classroom?.name,
      }
    });
  };

  const handleSetReminder = (e) => {
    e.stopPropagation();
    navigate('/calendar');
  };

  const getStatusLabel = (assignment) => {
    if (isEnrolled) {
      if (assignment.status === 'Graded') {
        const hasMarks = assignment.marks !== null && assignment.marks !== undefined;
        return hasMarks ? `Graded · ${assignment.marks}/10` : 'Graded';
      }
      return assignment.status || 'Due';
    }
    return assignment.status || 'Active';
  };

  const getEmptyMessage = (filter) => {
    if (!isEnrolled) {
      return "No assignments assigned yet.";
    }
    switch (filter) {
      case "Due":
        return "No assignments currently due.";
      case "Submitted":
        return "No submitted assignments.";
      case "Graded":
        return "No graded assignments.";
      case "Missing":
        return "No missing assignments.";
      case "All":
      default:
        return "No assignments available.";
    }
  };

  // Filter full list BEFORE display (filter by status only in student/enrolled mode)
  const filteredAssignments = assignments.filter((assignment) => {
    if (!isEnrolled || statusFilter === "All") return true;
    return assignment.status === statusFilter;
  });

  return (
    <div className="p-6 h-[60%] flex flex-col gap-[10px] min-h-[50vh]">
      <div className="flex w-full items-center justify-between h-[7%] mb-1">
        <h2 className="text-xl font-medium text-gray-800">Your Assignments</h2>
        {isEnrolled && (
          <div className="flex items-center gap-2">
            <select
              aria-label="Filter assignments by status"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="bg-white border border-[#BCE2DF] text-gray-700 text-sm font-medium rounded-lg px-3 py-1.5 focus:outline-none focus:ring-1 focus:ring-[#008080] cursor-pointer shadow-sm hover:border-[#008080] transition-colors"
            >
              <option value="All">All</option>
              <option value="Due">Due</option>
              <option value="Submitted">Submitted</option>
              <option value="Graded">Graded</option>
              <option value="Missing">Missing</option>
            </select>
          </div>
        )}
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-2 gap-4 h-[80%] overflow-y-auto pr-1">
        {filteredAssignments.length > 0 ? (
          filteredAssignments.map((assignment) => (
            <div
              key={assignment._id}
              onClick={() => handleCardClick(assignment)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  handleCardClick(assignment);
                }
              }}
              className="bg-white p-4 rounded-lg border border-[#BCE2DF] flex gap-4 items-center justify-between max-h-[160px] cursor-pointer hover:shadow-md transition-shadow"
            >
              <div className="flex flex-col h-full justify-between w-2/3">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="text-2xl truncate">{assignment.title || assignment.name}</h3>
                  <span
                    className={`px-2.5 py-0.5 text-xs rounded-full font-medium shrink-0 ${getStatusBadgeStyle(assignment.status)}`}
                  >
                    {getStatusLabel(assignment)}
                  </span>
                </div>
                <p className="text-lg text-gray-600 truncate">{assignment.classroomSubject}</p>
                <p className="text-lg text-gray-600 flex items-center truncate">
                  <span className="w-4 h-4 bg-[#00A8A5] rounded-full mr-2"></span>
                  Due Date: {assignment.dueDate}
                </p>
                <div className="flex gap-2 mt-[10px]">
                  <button
                    type="button"
                    className="bg-[#EAF2F1] border border-[#145A5E] text-[#145A5E] px-4 py-2 text-lg rounded-md shadow-md hover:bg-[#d6eae7] transition-colors"
                    onClick={handleSetReminder}
                  >
                    Set Reminder
                  </button>
                </div>
              </div>
              <div className="w-1/3 h-full flex items-center justify-center">
                <img
                  src={assignmentImg}
                  alt="Assignment Illustration"
                  className="object-contain h-full"
                />
              </div>
            </div>
          ))
        ) : (
          <div className="col-span-full flex flex-col items-center justify-center p-8 bg-white rounded-lg border border-[#BCE2DF] text-gray-500 my-auto">
            <p className="text-lg font-medium text-gray-600">{getEmptyMessage(statusFilter)}</p>
            <p className="text-sm text-gray-400 mt-1">Assignments will appear here once they match this status.</p>
          </div>
        )}
      </div>
    </div>
  );
};

export default YourAssignments;
