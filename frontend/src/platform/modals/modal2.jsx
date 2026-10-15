import React, { useState, useEffect } from 'react';
import axios from 'axios';
import CloseIcon from '@mui/icons-material/Close';
import { setIsEnrolled } from '../features/toggleSlice';
import { setJoinedClasses } from '../features/joinedClasses';
import { setCreatedClasses } from '../features/createdClasses';
import { setNoOfJoinedClasses, setNoOfCreatedClasses } from '../features/userSlice';
import { useDispatch } from 'react-redux';
import { toast } from 'react-toastify';
import { useNavigate } from 'react-router-dom';

// Module-level guard preventing duplicate auto-join requests across React 18 StrictMode remounts
const autoJoinedTokens = new Set();

const Modal2 = ({ onClose, joinToken, classCode }) => {
  const [code, setCode] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isVisible, setIsVisible] = useState(false); 
  const [hasSubmitted, setHasSubmitted] = useState(false);
  const dispatch = useDispatch();
  const navigate = useNavigate();

  useEffect(() => {
    setIsVisible(true); 

    if (joinToken && classCode) {
      setCode(classCode);
      if (!isLoading && !hasSubmitted) handleAutoSubmit();
    }
  }, []);

  const refreshUserDetails = async (headers) => {
    try {
      const userDetailsRes = await axios.get(
        `${process.env.REACT_APP_API_URL}/user/details`,
        { headers }
      );
      if (userDetailsRes.data?.success && userDetailsRes.data?.user) {
        const { joinedClasses, createdClasses, noOfJoinedClasses, noOfCreatedClasses } = userDetailsRes.data.user;
        dispatch(setJoinedClasses(joinedClasses || []));
        dispatch(setCreatedClasses(createdClasses || []));
        if (typeof noOfJoinedClasses === 'number') dispatch(setNoOfJoinedClasses(noOfJoinedClasses));
        if (typeof noOfCreatedClasses === 'number') dispatch(setNoOfCreatedClasses(noOfCreatedClasses));
      }
    } catch (fetchErr) {
      console.error('Failed to refresh user details after join:', fetchErr);
    }
  };

  const handleAutoSubmit = async () => {
    const autoJoinKey = `${classCode}_${joinToken || ''}`;
    if (autoJoinedTokens.has(autoJoinKey)) {
      return;
    }
    autoJoinedTokens.add(autoJoinKey);
    setTimeout(() => {
      autoJoinedTokens.delete(autoJoinKey);
    }, 4000);

    setIsLoading(true);
    setHasSubmitted(true); 

    const token = sessionStorage.getItem("authToken") || localStorage.getItem("authToken");

    try {
      const headers = {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      };
     
      const response = await axios.post(`${process.env.REACT_APP_API_URL}/classroom/join`, { code: classCode, token: joinToken }, { headers });
      if (response.data.success) {
        await refreshUserDetails(headers);
        dispatch(setIsEnrolled(true));
        toast.success("Class joined successfully!", {
          className: "custom-toastS",
          hideProgressBar: true,
          autoClose: 3000,
        });
        handleClose();
        navigate('/dashboard', { replace: true, state: {} });
      } else {
        toast.error(response.data.message || "Failed to join class.", {
          className: "custom-toast",
          hideProgressBar: true,
          autoClose: 3000,
        });
      }
    } catch (error) {
      toast.error(error.response?.data?.error || "Failed to join class.", {
        className: "custom-toast",
        hideProgressBar: true,
        autoClose: 3000,
      });
      console.error(error);
    } finally {
      setTimeout(() => {
        setIsLoading(false); // Re-enable the button after 2 seconds
      }, 2000);
    }
  };

  const handleClose = () => {
    setIsVisible(false); 
    setTimeout(onClose, 300); 
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setIsLoading(true);

    const token = sessionStorage.getItem("authToken") || localStorage.getItem("authToken");

    try {
      const headers = {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      };

      const response = await axios.post(
        `${process.env.REACT_APP_API_URL}/classroom/join`,
        { code },
        { headers }
      );

      if (response.data.success) {
        await refreshUserDetails(headers);
        dispatch(setIsEnrolled(true));
        toast.success("Class joined successfully!", {
          className: "custom-toastS",
          hideProgressBar: true,
          autoClose: 3000,
        });
        handleClose();
        if (window.location.pathname === '/dashsignup') {
          navigate('/dashboard');
        }
      } else {
        toast.error(response.data.message || "Failed to join class.", {
          className: "custom-toast",
          hideProgressBar: true,
          autoClose: 3000,
        });
      }
    } catch (error) {
      toast.error(error.response?.data?.error || "Failed to join class.", {
        className: "custom-toast",
        hideProgressBar: true,
        autoClose: 3000,
      });
      console.error(error);
    } finally {
      setTimeout(() => {
        setIsLoading(false); // Re-enable the button after 2 seconds
      }, 2000);
    }
  };

  return (
    <div
      className={`fixed top-0 left-0 w-full h-full flex justify-center items-center bg-black bg-opacity-50 z-50 transition-opacity duration-300 ${
        isVisible ? 'opacity-100' : 'opacity-0'
      }`}
    >
      <div
        className={`bg-white w-[432px] h-[398px] flex flex-col justify-center items-center relative overflow-y-auto transform transition-transform duration-300 ${
          isVisible ? 'scale-100' : 'scale-90'
        }`}
      >
        <div className="w-[80%] h-[90%] flex flex-col justify-around">
          <button
            onClick={handleClose}
            className="absolute top-4 right-4 text-4xl font-bold text-gray-600"
          >
            <CloseIcon fontSize="large" />
          </button>

          <h2 className="text-4xl font-medium">Join Class</h2>

          <form onSubmit={handleSubmit}>
            <input
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              type="text"
              placeholder="Class Code"
              className="w-full p-2 border border-gray-300 rounded-md"
            />
            <button
              type="submit"
              className="bg-[#008080] py-5 w-full text-white rounded-md text-lg font-semibold text-center grid place-content-center mt-4"
              disabled={isLoading}
            >
              {isLoading ? "Joining..." : "Join Class"}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
};

export default Modal2;