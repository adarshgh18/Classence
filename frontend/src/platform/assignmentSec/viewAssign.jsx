import React, { useState, useEffect } from "react";
import { useLocation } from "react-router-dom";
import axios from "axios";
import Sidebar from "../sidebar/sidebar";
import Header from "../header/header";
import { useSelector } from "react-redux";
import { FaEllipsisV } from "react-icons/fa";
import card from "../assets/addWork.svg";
import StudentSubmissions from "./studentSubmission";
import MoreHorizIcon from "@mui/icons-material/MoreHoriz";
import CreateAssignmentModal from "./createAssignModal";
import { ChatBox } from "./studentSubmission";
import { motion, AnimatePresence } from "framer-motion";
import HorizontalRuleIcon from '@mui/icons-material/HorizontalRule';
import AttachFileIcon from '@mui/icons-material/AttachFile';
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

const isAssignmentPastDue = (dueDateStr) => {
    if (!dueDateStr) return false;
    const now = new Date();
    const trimmed = String(dueDateStr).trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
        const [year, month, day] = trimmed.split('-').map(Number);
        const endOfDay = new Date(year, month - 1, day, 23, 59, 59, 999);
        return now.getTime() > endOfDay.getTime();
    }
    const parsed = new Date(trimmed);
    if (isNaN(parsed.getTime())) return false;
    return now.getTime() > parsed.getTime();
};

const AssignmentDetails = () => {
    const sidebarWidth = useSelector((state) => state.sidebar.width);
    const location = useLocation();
    const initialAssignment = location.state?.assignment;
    const [assignment, setAssignment] = useState(initialAssignment || null);
    const storedAssignmentId = typeof window !== 'undefined' ? sessionStorage.getItem('currentAssignmentId') : null;
    const assignmentId = assignment?._id || initialAssignment?._id || storedAssignmentId;
    const isEnrolled = useSelector((state) => state.toggleState.isEnrolled);
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [uploadedFiles, setUploadedFiles] = useState([]);
    const [uploading, setUploading] = useState(false);
    const [menuOpen, setMenuOpen] = useState(false);
    const classCode = location.state?.classCode || assignment?.classroom?.code || (typeof window !== 'undefined' ? sessionStorage.getItem('currentClassCode') : null);
    const className = location.state?.className || assignment?.classroom?.name || (typeof window !== 'undefined' ? sessionStorage.getItem('currentClassName') : null);
    console.log(classCode)
    const [deleteModalOpen, setDeleteModalOpen] = useState(false);
    const [editModalOpen, setEditModalOpen] = useState(false);
    const [isMobile, setIsMobile] = useState(window.innerWidth <= 1024);
    const [isBottomSheetOpen, setIsBottomSheetOpen] = useState(false);
    const navigate = useNavigate();
    const [isEditing, setIsEditing] = useState(false);
    const [submission, setSubmission] = useState(assignment?.mySubmission || null);
    const [submissionLoading, setSubmissionLoading] = useState(false);

    useEffect(() => {
        if (assignment?._id) {
            sessionStorage.setItem('currentAssignmentId', assignment._id);
        }
        if (classCode) {
            sessionStorage.setItem('currentClassCode', classCode);
        }
        if (className) {
            sessionStorage.setItem('currentClassName', className);
        }
    }, [assignment?._id, classCode, className]);

    const isHistorical = Boolean(assignment?.isHistorical || (assignment && !assignment?.classroom) || (!classCode && !assignment?.classroom?.code));

    const fetchAuthoritativeAssignment = async () => {
        if (!assignmentId || isHistorical) return;
        try {
            const token = sessionStorage.getItem("authToken") || localStorage.getItem("authToken");
            const res = await axios.get(
                `${process.env.REACT_APP_API_URL}/assignment/get?assignmentId=${assignmentId}`,
                {
                    headers: {
                        Authorization: `Bearer ${token}`,
                    },
                }
            );
            if (res?.data?.success && res?.data?.assignment) {
                const authoritative = res.data.assignment;
                setAssignment((prev) => ({
                    ...prev,
                    ...authoritative,
                    name: authoritative.name || authoritative.title || prev?.name,
                    title: authoritative.name || authoritative.title || prev?.title,
                }));
                if (isEnrolled && authoritative.mySubmission) {
                    setSubmission(authoritative.mySubmission);
                }
            }
        } catch (error) {
            console.error("Error fetching authoritative assignment detail:", error);
        }
    };

    useEffect(() => {
        fetchAuthoritativeAssignment();
    }, [assignmentId, isHistorical, isEnrolled]);

    const fetchMySubmission = async () => {
        if (!assignmentId || !isEnrolled || isHistorical) return;
        try {
            setSubmissionLoading(true);
            const token = sessionStorage.getItem("authToken") || localStorage.getItem("authToken");
            const res = await axios.get(
                `${process.env.REACT_APP_API_URL}/submission/my-submission?assignmentId=${assignmentId}`,
                {
                    headers: {
                        Authorization: `Bearer ${token}`,
                    },
                }
            );
            if (res.data?.success && res.data?.submission) {
                setSubmission(res.data.submission);
            }
        } catch (error) {
            console.error("Error fetching submission:", error);
        } finally {
            setSubmissionLoading(false);
        }
    };

    useEffect(() => {
        fetchMySubmission();
    }, [assignmentId, isEnrolled, isHistorical]);

    const formatSubmissionDate = (dateStr) => {
        if (!dateStr) return "";
        try {
            const d = new Date(dateStr);
            return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
        } catch (e) {
            return dateStr;
        }
    };

    const formatCreatedDate = (dateVal) => {
        if (!dateVal) return "";
        try {
            const d = new Date(dateVal);
            if (!isNaN(d.getTime())) {
                return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
            }
            return dateVal;
        } catch (e) {
            return dateVal;
        }
    };

    const getFileName = (url, index) => {
        try {
            const name = new URL(url).pathname.split('/').pop();
            return name || `Attachment ${index + 1}`;
        } catch (e) {
            return `Attachment ${index + 1}`;
        }
    };

    useEffect(() => {
        const handleResize = () => {
            setIsMobile(window.innerWidth <= 1024);
        };
        window.addEventListener('resize', handleResize);
        return () => window.removeEventListener('resize', handleResize);
    }, []);

    useEffect(() => {
        if (!assignment && !assignmentId) {
            navigate('/dashboard');
        }
    }, [assignment, assignmentId]);

    const getComputedStatus = () => {
        const isPastDue = isAssignmentPastDue(assignment?.dueDate);
        if (!isEnrolled) {
            return isPastDue ? "Past Due" : "Active";
        }
        const isGraded = submission && Boolean(submission.isGraded || (submission.marks !== null && submission.marks !== undefined));
        if (isGraded) return "Graded";
        if (submission) return "Submitted";
        if (isPastDue) return "Missing";
        return "Due";
    };

    const status = getComputedStatus();

    const handleFileChange = (e) => {
        const files = Array.from(e.target.files);
        setUploadedFiles((prev) => [...prev, ...files]);
    };

    const handleFileSubmit = async () => {
        if (!uploadedFiles.length) {
            alert("Please upload at least one file.");
            return;
        }
        try {
            setUploading(true);
            const token = sessionStorage.getItem("authToken") || localStorage.getItem("authToken");
            const formData = new FormData();
            uploadedFiles.forEach((file) => {
                formData.append("media", file);
            });
            formData.append("assignmentId", assignment?._id);
            const response = await axios.post(
                `${process.env.REACT_APP_API_URL}/submission/create`,
                formData,
                {
                    headers: {
                        Authorization: `Bearer ${token}`,
                        "Content-Type": "multipart/form-data",
                    },
                }
            );
            if (response.data?.submission) {
                setSubmission(response.data.submission);
            }
            alert("Files submitted successfully!");
            setUploadedFiles([]);
            setIsModalOpen(false);
        } catch (error) {
            console.error("Error uploading files:", error);
            const errMsg = error.response?.data?.error || "File upload failed. Please try again.";
            alert(errMsg);
        } finally {
            setUploading(false);
        }
    };

    const handleEdit = () => {
        setEditModalOpen(true);
        setMenuOpen(false); 
    };

    const handleDelete = () => {
        setDeleteModalOpen(true); 
        setMenuOpen(false); 
    };

    const confirmDelete = async () => {
        try {
            const token = sessionStorage.getItem("authToken") || localStorage.getItem("authToken");

            const response = await axios.delete(`${process.env.REACT_APP_API_URL}/assignment/delete?id=${assignment._id}&code=${classCode}`, {
                headers: {
                  Authorization: `Bearer ${token}`,
                },
              });
              console.log(response)
            alert("Assignment deleted successfully!");
            setDeleteModalOpen(false);
            navigate("/classes")
        } catch (error) {
            console.error("Error deleting assignment:", error);
            alert("Failed to delete assignment.");
        }
    };

    const handleAddWorkClick = () => {
        setIsModalOpen(true);
        setIsBottomSheetOpen(false); 
    };

    const BottomSheet = () => (
        <AnimatePresence>
            {isBottomSheetOpen && (
                <>
                    <motion.div
                        className="fixed inset-0 bg-black/50 z-30"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        onClick={() => setIsBottomSheetOpen(false)}
                    />
                    <motion.div
                        className="fixed bottom-0 left-0 right-0 bg-white rounded-t-2xl z-40 p-6"
                        initial={{ y: "100%" }}
                        animate={{ y: 0 }}
                        exit={{ y: "100%" }}
                        transition={{ type: "spring", damping: 25, stiffness: 300 }}
                    >
                        <div className="w-12 h-1 bg-gray-300 rounded-full mx-auto mb-6" />
                        {submission ? (
                            <div className="rounded-lg p-4 bg-white flex flex-col">
                                <div className="flex items-center justify-between mb-3">
                                    <h3 className="text-xl font-bold text-gray-800">Your Work</h3>
                                    <span
                                        className={`px-3 py-1 text-xs font-semibold rounded-full ${
                                            submission.isGraded
                                                ? "bg-[#C8EAC9] text-[#1E6B20]"
                                                : "bg-[#FFF3D4] text-[#8C6B00]"
                                        }`}
                                    >
                                        {submission.isGraded
                                            ? `Graded${submission.marks !== null && submission.marks !== undefined ? `: ${submission.marks}/10` : ""}`
                                            : "Submitted"}
                                    </span>
                                </div>
                                {submission.createdAt && (
                                    <p className="text-xs text-gray-500 mb-3">
                                        Submitted on {formatSubmissionDate(submission.createdAt)}
                                    </p>
                                )}
                                <div className="max-h-60 overflow-y-auto flex flex-col gap-2">
                                    {submission.media && submission.media.length > 0 ? (
                                        submission.media.map((file, idx) => (
                                            <a
                                                key={idx}
                                                href={file}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                className="flex items-center p-2.5 bg-gray-50 border border-gray-200 rounded-lg hover:bg-gray-100 transition-colors"
                                            >
                                                <AttachFileIcon className="mr-2 text-[#066769]" fontSize="small" />
                                                <span className="text-sm text-gray-700 font-medium truncate flex-1">
                                                    {getFileName(file, idx)}
                                                </span>
                                                <span className="text-xs text-[#066769] font-semibold ml-2">
                                                    View
                                                </span>
                                            </a>
                                        ))
                                    ) : (
                                        <p className="text-sm text-gray-500">No attachments included.</p>
                                    )}
                                </div>
                            </div>
                        ) : (
                            <div className="rounded-lg p-4 bg-white flex flex-col items-center">
                                <h3 className="text-xl text-gray-800 self-start h-[10%]">Your Work</h3>
                                <img src={card} alt="" className="w-[70%] h-[60%]" />
                                <button
                                    onClick={handleAddWorkClick}
                                    className="px-8 py-3 rounded-lg bg-[#066769] text-white mt-[30px]"
                                >
                                    + Add your work
                                </button>
                            </div>
                        )}
                    </motion.div>
                </>
            )}
        </AnimatePresence>
    );

    return (
        <div className="">
            <Header />
            <Sidebar />
            <div className="bg-[#E1EAE8] min-h-screen flex p-8 pb-[70px]">
                <div
                    className={`mt-[50px] rounded-lg transition-all duration-300 w-full overflow-auto`}
                    style={{ 
                        marginLeft: isMobile ? '0' : sidebarWidth,
                    }}
                >
                    <div className={`${isMobile ? 'flex-col' : 'flex'} gap-8 h-full`}>
                        <div className={`${isMobile?'w-full  h-auto min-h-[400px]':'w-2/3 h-[100%]'}  bg-white rounded-lg relative`}>
                            <div className="absolute top-4 right-4">
                                {!isEnrolled? <button
                                    onClick={() => setMenuOpen((prev) => !prev)}
                                    className="p-2 rounded-full hover:bg-gray-100 text-gray-600"
                                >
                                    <MoreHorizIcon />
                                </button>:<></>}
                               
                                {menuOpen && (
                                    <div className="absolute right-0 mt-2 w-40 bg-white shadow-md rounded-lg">
                                        <button
                                            onClick={handleEdit}
                                            className="block w-full text-left px-4 py-2 hover:bg-gray-100 rounded-lg"
                                        >
                                            Edit
                                        </button>
                                        <button
                                            onClick={handleDelete}
                                            className="block w-full text-left px-4 py-2 text-red-500 hover:bg-gray-100 rounded-lg"
                                        >
                                            Delete
                                        </button>
                                    </div>
                                )}
                            </div>
                            <div className="p-4 rounded-lg mb-6">
                                <h1 className="text-3xl font-bold text-[#394141] mb-4">{assignment?.name}</h1>
                                <div className="flex flex-col gap-4 text-sm text-[#394141]">
                                    <p className="flex items-center gap-2">
                                        <span className="font-medium">Status: </span>
                                        <span
                                            className={`px-2.5 py-0.5 text-xs rounded font-medium ${getStatusBadgeStyle(status)}`}
                                        >
                                            {status}
                                        </span>
                                    </p>
                                    <p>
                                        <span className="font-medium">Due Date: </span>
                                        {assignment?.dueDate}
                                    </p>
                                    <p>
                                        <span className="font-medium">Created On: </span>
                                        {formatCreatedDate(assignment?.createdAt)}
                                    </p>
                                    <hr />
                                </div>
                            </div>
                            <div className="p-4 rounded-lg">
                                <h2 className="text-xl font-medium text-[#394141]">Description</h2>
    <p className="text-[#394141] mt-3 text-xl" style={{ whiteSpace: 'normal', wordWrap: 'break-word' }}>
                                    {assignment?.description}</p>
                            </div>
                            {assignment?.media && assignment?.media.length > 0 && (
                                <div className="p-4 rounded-lg">
                                    <h2 className="text-xl font-medium text-[#394141]">Attachments</h2>
                                    <div className="mt-4 flex flex-wrap gap-4">
                                        {assignment.media.map((media, mediaIndex) => (
                                            <div key={mediaIndex} className="relative group h-auto w-auto">
                                                {media && media.match(/\.(jpeg|jpg|gif|png)$/i) ? (
                                                    <div className="aspect-square overflow-hidden rounded-lg">
                                                        <img 
                                                            src={media} 
                                                            alt={media.originalName || `Image ${mediaIndex + 1}`}
                                                            className="w-20 h-20 object-cover cursor-zoom-in transition-transform group-hover:scale-105"
                                                            onClick={() => window.open(media, '_blank')}
                                                        />
                                                    </div>
                                                ) : (
                                                    <a
                                                        href={media}
                                                        download
                                                        onClick={(e) => {
                                                            if (!media) {
                                                                e.preventDefault();
                                                                alert("File URL is missing or invalid.");
                                                            }
                                                        }}
                                                        className="flex items-center p-4 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors"
                                                    >
                                                        <AttachFileIcon className="mr-3 text-gray-500" />
                                                        <div className="flex flex-col">
                                                            <span className="text-sm font-medium text-gray-700 truncate max-w-[200px]">
                                                                {media.originalName || `File ${mediaIndex + 1}`}
                                                            </span>
                                                            <span className="text-xs text-gray-500">
                                                                Click to download
                                                            </span>
                                                        </div>
                                                    </a>
                                                )}
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </div>
                        {isEnrolled ? (
                            <div className={`${isMobile?'w-full mt-5 ':'w-1/3 '}flex flex-col gap-6 overflow-y-auto`}>
                                {submission ? (
                                    <div className={`rounded-lg p-4 h-[40%] bg-white flex flex-col ${isMobile?'hidden':''}`}>
                                        <div className="flex items-center justify-between mb-3">
                                            <h3 className="text-xl font-bold text-gray-800">Your Work</h3>
                                            <span
                                                className={`px-3 py-1 text-xs font-semibold rounded-full ${
                                                    submission.isGraded
                                                        ? "bg-[#C8EAC9] text-[#1E6B20]"
                                                        : "bg-[#FFF3D4] text-[#8C6B00]"
                                                }`}
                                            >
                                                {submission.isGraded
                                                    ? `Graded${submission.marks !== null && submission.marks !== undefined ? `: ${submission.marks}/10` : ""}`
                                                    : "Submitted"}
                                            </span>
                                        </div>
                                        {submission.createdAt && (
                                            <p className="text-xs text-gray-500 mb-3">
                                                Submitted on {formatSubmissionDate(submission.createdAt)}
                                            </p>
                                        )}
                                        <div className="flex-1 overflow-y-auto flex flex-col gap-2">
                                            {submission.media && submission.media.length > 0 ? (
                                                submission.media.map((file, idx) => (
                                                    <a
                                                        key={idx}
                                                        href={file}
                                                        target="_blank"
                                                        rel="noopener noreferrer"
                                                        className="flex items-center p-2.5 bg-gray-50 border border-gray-200 rounded-lg hover:bg-gray-100 transition-colors"
                                                    >
                                                        <AttachFileIcon className="mr-2 text-[#066769]" fontSize="small" />
                                                        <span className="text-sm text-gray-700 font-medium truncate flex-1">
                                                            {getFileName(file, idx)}
                                                        </span>
                                                        <span className="text-xs text-[#066769] font-semibold ml-2">
                                                            View
                                                        </span>
                                                    </a>
                                                ))
                                            ) : (
                                                <p className="text-sm text-gray-500">No attachments included.</p>
                                            )}
                                        </div>
                                    </div>
                                ) : (
                                    <div className={`rounded-lg p-4 h-[40%] bg-white flex flex-col items-center justify-center ${isMobile?'hidden':''}`}>
                                        <h3 className="text-xl text-gray-800 self-start h-[10%]">Your Work</h3>
                                        {isHistorical ? (
                                            <p className="text-gray-500 text-sm mt-4 text-center">No submission recorded for this archived assignment.</p>
                                        ) : (
                                            <>
                                                <img src={card} alt="" className="w-[70%] h-[60%]" />
                                                <button
                                                    onClick={() => setIsModalOpen(true)}
                                                    className="px-8 py-3 rounded-lg bg-[#066769] text-white mt-[30px]"
                                                >
                                                    + Add your work
                                                </button>
                                            </>
                                        )}
                                    </div>
                                )}
                                {isHistorical ? (
                                    <div className="rounded-lg p-6 bg-white flex flex-col items-center justify-center text-center text-gray-500 h-full border border-gray-100">
                                        <p className="font-semibold text-lg text-gray-700">Archived Record</p>
                                        <p className="text-sm mt-1 text-gray-400">This class is no longer active. Comments and submissions are closed.</p>
                                    </div>
                                ) : (
                                    <div className="rounded-lg p-4 h-full bg-white flex flex-col justify-around">
                                        <ChatBox assignmentId={assignmentId}/>
                                    </div>
                                )}
                            </div>
                        ) : (
                            <StudentSubmissions assignment={assignment} />
                        )}
                    </div>
                </div>
            </div>
            {isMobile && isEnrolled && (
                <>
                    <button
                        onClick={() => setIsBottomSheetOpen(true)}
                        className="fixed  flex-col bottom-0 right-0 w-full h-[50px] bg-[#FAFAFA] rounded-t-xl flex items-center justify-center shadow-black shadow-2xl z-20"
                    >
                       <HorizontalRuleIcon fontSize="large"/>
                        <p>Your Work</p>
                    </button>
                    <BottomSheet />
                </>
            )}
            {isModalOpen && (
                <div className="fixed inset-0 bg-gray-900 bg-opacity-50 flex justify-center items-center z-20">
                    <div className="bg-white rounded-lg p-8 w-1/3 min-w-[250px]">
                        <h2 className="text-xl font-bold mb-4">Upload Your Work</h2>
                        <input
                            type="file"
                            onChange={handleFileChange}
                            multiple
                            className="mb-4 w-full border p-2 rounded-lg"
                        />
                        <ul className="mb-4">
                            {uploadedFiles.map((file, index) => (
                                <li key={index} className="text-gray-700">
                                    {file.name}
                                </li>
                            ))}
                        </ul>
                        <div className="flex justify-end gap-4">
                            <button
                                onClick={() => setIsModalOpen(false)}
                                className="px-4 py-2 bg-gray-300 text-gray-800 rounded-lg hover:bg-gray-400"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={handleFileSubmit}
                                disabled={uploading}
                                className={`px-4 py-2 rounded-lg ${uploading
                                    ? "bg-gray-300 text-gray-500 cursor-not-allowed"
                                    : "bg-blue-600 text-white hover:bg-blue-700"
                                    }`}
                            >
                                {uploading ? "Submitting..." : "Submit"}
                            </button>
                        </div>
                    </div>
                </div>
            )}
            {deleteModalOpen && (
                <div className="fixed inset-0 bg-gray-900 bg-opacity-50 flex justify-center items-center z-20">
                    <div className="bg-white rounded-lg p-8 w-1/3">
                        <h2 className="text-xl font-bold mb-4">Confirm Delete</h2>
                        <p className="mb-4">Are you sure you want to delete this assignment?</p>
                        <div className="flex justify-end gap-4">
                            <button
                                onClick={() => setDeleteModalOpen(false)}
                                className="px-4 py-2 bg-gray-300 text-gray-800 rounded-lg hover:bg-gray-400"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={confirmDelete}
                                className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700"
                            >
                                Delete
                            </button>
                        </div>
                    </div>
                </div>
            )}
            {editModalOpen && (
                <CreateAssignmentModal
                    isOpen={editModalOpen}
                    onClose={() => setEditModalOpen(false)}
                    assignment={assignment}
                    className={className}
                    classCode={classCode}
                    isEditing={true} 
                />
            )}
        </div>
    );
};

export default AssignmentDetails;