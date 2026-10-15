import React, { useState, useEffect } from 'react';
import card1 from '../assets/recent.svg';
import PeopleIcon from '@mui/icons-material/People';
import { useSelector } from 'react-redux';
import { useNavigate } from 'react-router-dom';
import image from '../assets/cuate.svg';

const RecentClasses = ({ recentClasses }) => {
    const [isMobile, setIsMobile] = useState(window.innerWidth <= 1024);
    const createdClasses = useSelector((state) => state.createdClasses.createdClasses);
    const joinedClasses = useSelector((state) => state.joinedClasses.joinedClasses);
    const isEnrolled = useSelector((state) => state.toggleState.isEnrolled);
    const Navigate = useNavigate();
    const classesData = recentClasses || [];

    useEffect(() => {
        const handleResize = () => {
            setIsMobile(window.innerWidth <= 1024);
        };

        window.addEventListener('resize', handleResize);
        return () => window.removeEventListener('resize', handleResize);
    }, []);

    const getInitials = (name) => {
        if (!name) return 'C';
        const nameArray = name.trim().split(' ');
        const initials = nameArray.map(word => word[0]).join('');
        return initials.toUpperCase();
    };

    const handleCardClick = (classItem) => {
        const targetId = classItem.classroomId || classItem.classroom?._id || classItem._id;
        const targetCode = classItem.classCode || classItem.classroom?.code;

        const classPool = isEnrolled ? joinedClasses : createdClasses;
        let classInfo = classPool.find((c) => c._id === targetId || (targetCode && c.code === targetCode));
        if (!classInfo) {
            classInfo = (isEnrolled ? createdClasses : joinedClasses).find(
                (c) => c._id === targetId || (targetCode && c.code === targetCode)
            );
        }

        const finalCode = targetCode || classInfo?.code;
        const finalId = targetId || classInfo?._id;

        if (finalCode && finalId) {
            Navigate("/announcement", { state: { code: finalCode, _id: finalId } });
        }
    };

    return (
        <div className={`bg-white p-6 border border-[#BCE2DF] rounded-lg ${isMobile ? 'w-[100%]' : 'w-[45%]'} h-[100%] mt-[20px]`}>
            <h2 className="text-2xl mb-6 h-[10%]">Upcoming Classes</h2>
            <div className="space-y-4 h-[90%]">
                {classesData.length > 0 ? (
                    classesData.map((classItem, index) => (
                        <div
                            key={index}
                            className="flex items-center min-h-[120px] bg-[#F7F8F8] p-[6px] border border-[#D9DEDE] rounded-lg shadow-sm h-[45%] cursor-pointer hover:bg-[#EFF3F3] transition-colors"
                            onClick={() => handleCardClick(classItem)}
                        >
                            <div className="rounded-lg w-[50%] h-[100%] p-2 flex flex-col justify-center">
                                <img
                                    src={card1}
                                    alt={classItem.title || classItem.subject || 'Class'}
                                    className="w-[100%] rounded-md"
                                />
                            </div>
                            <div className="w-3/4 flex flex-col h-[100%] justify-between p-4">
                                <div>
                                    <h3 className="text-xl font-semibold text-gray-800 truncate">
                                        {classItem.title || classItem.subject}
                                    </h3>
                                    <p className="text-sm font-medium text-teal-700 truncate">
                                        {classItem.classroomSubject || classItem.subject || classItem.classroom?.name}
                                    </p>
                                </div>
                                <div className="flex flex-col text-gray-600 text-sm mt-1 justify-between gap-1">
                                    <span className="text-xs text-gray-500 font-medium">
                                        {classItem.date ? `${classItem.date}${classItem.time ? ` • ${classItem.time}` : ''}` : ''}
                                    </span>
                                    {classItem.teacher?.name && (
                                        <div className="flex items-center mt-1">
                                            <span className="bg-gray-200 text-gray-700 rounded-full px-2 py-0.5 text-xs mr-2 font-medium">
                                                {getInitials(classItem.teacher.name)}
                                            </span>
                                            <span className="text-xs text-gray-600 truncate">{classItem.teacher.name}</span>
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>
                    ))
                ) : (
                    <div className="flex flex-col items-center justify-center h-full text-gray-500">
                        <img src={image} alt="" className='w-1/2' />
                        <h1 className='font-semibold text-xl'>No upcoming classes scheduled</h1>
                        <p className='text-center'>You're all set for now. Check back later or use the calendar to plan ahead.</p>
                    </div>
                )}
            </div>
        </div>
    );
};

export default RecentClasses;