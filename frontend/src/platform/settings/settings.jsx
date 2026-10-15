import React, { useState, useRef, useEffect } from "react";
import { useSelector, useDispatch } from "react-redux";
import { useNavigate } from "react-router-dom";
import axios from "axios";
import { toast, ToastContainer } from 'react-toastify';
import 'react-toastify/dist/ReactToastify.css';

import ChangePasswordModal from "./changePasswordModal";
import image from "../assets/image.svg";
import pass from "../assets/pass.svg";
import notifications from "../assets/notifications.svg";
import logout from "../assets/logout.svg";
import modes from "../assets/nodes.svg";
import sun from "../assets/sun.svg";
import moon from "../assets/moon.svg";
import { Pencil } from 'lucide-react';
import {
  setUserName,
  setUserMail,
  setNoOfJoinedClasses,
  setNoOfCreatedClasses,
  setIsNotification
} from "../features/userSlice";

const DayNightToggle = () => {
  const [isDay, setIsDay] = useState(true);

  const toggleSwitch = () => {
    setIsDay(!isDay);
  };

  return (
    <div
      className={`relative w-20 h-10 flex items-center rounded-full cursor-pointer p-1 transition-colors duration-300 ${
        isDay ? "bg-yellow-400" : "bg-gray-700"
      }`}
      onClick={toggleSwitch}
    >
      <div
        className={`absolute w-8 h-8 bg-white rounded-full shadow-md transform transition-transform duration-300 ${
          isDay ? "translate-x-1" : "translate-x-8 md:translate-x-10"
        }`}
      ></div>

      <img
        src={sun}
        alt="Sun Icon"
        className={`absolute left-3 w-6 h-6 transition-opacity duration-300 ${
          isDay ? "opacity-100" : "opacity-0"
        }`}
      />

      <img
        src={moon}
        alt="Moon Icon"
        className={`absolute right-2 w-6 h-6 transition-opacity duration-300 ${
          isDay ? "opacity-0" : "opacity-100"
        }`}
      />
    </div>
  );
};

const ToggleSwitch = ({ isOn = false, onToggle, disabled = false }) => {
  const toggleSwitch = () => {
    if (disabled) return;
    if (onToggle) {
      onToggle(!isOn);
    }
  };

  return (
    <div
      role="switch"
      aria-checked={isOn}
      className={`w-20 h-10 flex items-center rounded-full p-1 cursor-pointer transition-colors ${
        isOn ? "bg-teal-600" : "bg-gray-300"
      } ${disabled ? "opacity-60 cursor-not-allowed" : ""}`}
      onClick={toggleSwitch}
    >
      <div
        className={`w-8 h-8 bg-white rounded-full shadow-md transform transition-transform duration-300 ${
          isOn ? "translate-x-8 sm:translate-x-10" : ""
        }`}
      ></div>
    </div>
  );
};

const SignOutModal = ({ isOpen, onClose, onConfirm }) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white p-6 rounded-lg shadow-md">
        <h2 className="text-2xl font-medium mb-4">Confirm Sign Out</h2>
        <p className="text-lg text-gray-600 mb-6">
          Are you sure you want to sign out?
        </p>
        <div className="flex justify-end space-x-4">
          <button
            className="px-4 py-2 bg-gray-300 rounded-lg text-gray-800 hover:bg-gray-400 transition-colors"
            onClick={onClose}
          >
            Cancel
          </button>
          <button
            className="px-4 py-2 bg-red-500 rounded-lg text-white hover:bg-red-600 transition-colors"
            onClick={onConfirm}
          >
            Sign Out
          </button>
        </div>
      </div>
    </div>
  );
};

const SettingsPage = () => {
  const [isMobile, setIsMobile] = useState(window.innerWidth <= 1024);
  const sidebarWidth = useSelector((state) => state.sidebar.width);
  const navigate = useNavigate();
  const dispatch = useDispatch();

  const userName = useSelector((state) => state.user.name);  
  const userMail = useSelector((state) => state.user.email);  
  const reduxIsNotification = useSelector((state) => state.user.isNotification);

  const [isNotification, setLocalNotification] = useState(
    typeof reduxIsNotification === 'boolean' ? reduxIsNotification : true
  );
  const [isUpdatingNotification, setIsUpdatingNotification] = useState(false);

  const [isModalOpen, setModalOpen] = useState(false);
  const [isSignOutModalOpen, setSignOutModalOpen] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isHydrating, setIsHydrating] = useState(false);
  const inputRef = useRef(null);
  const [editedName, setEditedName] = useState(userName || '');

  useEffect(() => {
    const handleResize = () => {
      setIsMobile(window.innerWidth <= 1024);
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const isEditingRef = useRef(false);
  isEditingRef.current = isEditing;

  // Synchronize local editedName with redux userName when not in edit mode
  useEffect(() => {
    if (!isEditing) {
      setEditedName(userName || '');
    }
  }, [userName, isEditing]);

  // Synchronize local notification toggle with redux preference
  useEffect(() => {
    if (typeof reduxIsNotification === 'boolean') {
      setLocalNotification(reduxIsNotification);
    }
  }, [reduxIsNotification]);

  // Auto-focus input when entering edit mode
  useEffect(() => {
    if (isEditing) {
      inputRef.current?.focus();
    }
  }, [isEditing]);

  // Independent initial data hydration: load authoritative user details on mount
  useEffect(() => {
    const token = sessionStorage.getItem('authToken') || localStorage.getItem('authToken');
    if (!token) {
      navigate('/login');
      return;
    }

    let isMounted = true;
    const controller = new AbortController();

    const fetchUserDetails = async () => {
      setIsHydrating(true);
      try {
        const response = await axios.get(`${process.env.REACT_APP_API_URL}/user/details`, {
          headers: {
            Authorization: `Bearer ${token}`,
          },
          signal: controller.signal,
        });

        if (isMounted && response.data?.success && response.data?.user) {
          const user = response.data.user;
          dispatch(setUserName(user.name));
          dispatch(setUserMail(user.email));
          if (user.noOfJoinedClasses !== undefined) dispatch(setNoOfJoinedClasses(user.noOfJoinedClasses));
          if (user.noOfCreatedClasses !== undefined) dispatch(setNoOfCreatedClasses(user.noOfCreatedClasses));
          if (typeof user.isNotification === 'boolean') {
            dispatch(setIsNotification(user.isNotification));
            setLocalNotification(user.isNotification);
          }
          if (!isEditingRef.current) {
            setEditedName(user.name);
          }
        }
      } catch (err) {
        if (axios.isCancel(err) || err.name === 'CanceledError') return;
        console.error('Error fetching user details in Settings:', err);
      } finally {
        if (isMounted) {
          setIsHydrating(false);
        }
      }
    };

    fetchUserDetails();

    return () => {
      isMounted = false;
      controller.abort();
    };
  }, [dispatch, navigate]);

  const handleSave = async () => {
    const trimmedName = editedName.trim();
    if (trimmedName.length < 3) {
      toast.dismiss();
      toast.error('At least 3 characters required', {
        className: 'custom-toast',
        hideProgressBar: true,
        autoClose: 3000,
      });
      // Do NOT close input on validation failure
      return;
    }

    if (trimmedName === userName) {
      setIsEditing(false);
      return;
    }

    setIsLoading(true);
    try {
      const token = sessionStorage.getItem('authToken') || localStorage.getItem('authToken');
      const axiosConfig = {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      };
      const response = await axios.post(
        `${process.env.REACT_APP_API_URL}/user/settings/change-name`,
        { name: trimmedName },
        axiosConfig
      );

      const updatedName = response.data?.user?.name || trimmedName;
      dispatch(setUserName(updatedName));
      setEditedName(updatedName);
      setIsEditing(false);
      toast.success(response.data?.message || 'Name updated successfully', {
        className: 'custom-toast',
        hideProgressBar: true,
        autoClose: 3000,
      });
    } catch (error) {
      console.error('Error updating name:', error);
      const errMsg = error.response?.data?.message || error.response?.data?.error || 'Error updating name';
      toast.error(errMsg, {
        className: 'custom-toast',
        hideProgressBar: true,
        autoClose: 3000,
      });
      // Do NOT close editing on API failure
    } finally {
      setIsLoading(false);
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleSave();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setIsEditing(false);
      setEditedName(userName || '');
    }
  };

  const handleNotificationSetting = async (newValue) => {
    if (isUpdatingNotification) return;
    const prevValue = isNotification;
    // Optimistic UI update
    setLocalNotification(newValue);
    setIsUpdatingNotification(true);

    try {
      const token = sessionStorage.getItem('authToken') || localStorage.getItem('authToken');
      const axiosConfig = {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      };
      const response = await axios.post(
        `${process.env.REACT_APP_API_URL}/user/settings/change-is-notification-enabled`,
        { isNotification: newValue },
        axiosConfig
      );

      if (response.data?.success) {
        const persistedValue = response.data.isNotification !== undefined ? response.data.isNotification : newValue;
        setLocalNotification(persistedValue);
        dispatch(setIsNotification(persistedValue));
        toast.success(response.data.message || `Notifications ${persistedValue ? 'enabled' : 'disabled'}.`, {
          className: 'custom-toast',
          hideProgressBar: true,
          autoClose: 3000,
        });
      } else {
        // Revert on unconfirmed status
        setLocalNotification(prevValue);
        toast.error('Failed to update notification settings', {
          className: 'custom-toast',
          hideProgressBar: true,
          autoClose: 3000,
        });
      }
    } catch (error) {
      console.error('Error updating notification settings:', error);
      // Revert optimistic state on failure
      setLocalNotification(prevValue);
      const errMsg = error.response?.data?.message || error.response?.data?.error || 'Failed to update notification settings';
      toast.error(errMsg, {
        className: 'custom-toast',
        hideProgressBar: true,
        autoClose: 3000,
      });
    } finally {
      setIsUpdatingNotification(false);
    }
  };

  const handleSignOut = async () => {
    try {
      const token = sessionStorage.getItem("authToken") || localStorage.getItem("authToken");
      const axiosConfig = {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      };

      const response = await axios.post(
        `${process.env.REACT_APP_API_URL}/user/settings/sign-out-all-devices`,
        {},
        axiosConfig
      );

      if (response.status === 200) {
        sessionStorage.clear();
        localStorage.clear();
        window.location.href = "/login"; 
      } else {
        toast.error("Error during sign-out", {
          className: "custom-toast",
          hideProgressBar: true,
          autoClose: 3000,
        });
      }
    } catch (error) {
      console.error("Sign-out failed:", error);
      toast.error(error.response?.data?.message || "Sign-out failed. Please try again.", {
        className: "custom-toast",
        hideProgressBar: true,
        autoClose: 3000,
      });
    }
  };

  return (
    <div
      className="mt-[50px] mx-auto bg-[#E1EAE8] p-6 rounded-lg shadow-md h-[100vh] overflow-y-auto"
      style={{ 
        marginLeft: isMobile ? '0' : sidebarWidth,
        transition: 'margin-left 0.3s ease'
      }}
    >
      <h1 className="text-3xl font-medium mb-2">Settings</h1>
      <p className="text-xl text-gray-600 mb-20">
        Customize your Classence experience to suit your preferences.
      </p>

      {/* Profile Section */}
      <div className="mb-8 p-4 bg-white rounded-lg shadow-sm h-[140px]">
        <h2 className="text-2xl mb-4">Your Profile</h2>
        <div className="flex items-center">
          <img src={image} alt="" className="mr-6" />
          <div>
            <div className="flex justify-between items-center">
              <div>
                <div className="flex items-center gap-2">
                  {isEditing ? (
                    <input
                      ref={inputRef}
                      type="text"
                      value={editedName}
                      onChange={(e) => setEditedName(e.target.value)}
                      onKeyDown={handleKeyDown}
                      className="font-medium text-xl bg-transparent border-b border-gray-300 focus:border-teal-600 outline-none w-full max-w-xs sm:max-w-sm px-1 py-1"
                      disabled={isLoading}
                      autoFocus
                    />
                  ) : (
                    <>
                      <p className="font-medium text-xl">
                        {userName || (isHydrating ? "Loading..." : "")}
                      </p>
                      <button
                        onClick={() => {
                          setIsEditing(true);
                          setEditedName(userName || "");
                        }}
                        className="text-gray-400 hover:text-gray-600 transition-colors"
                        aria-label="Edit name"
                      >
                        <Pencil size={16} />
                      </button>
                    </>
                  )}
                </div>
              </div>
            </div>
            <p className="text-gray-600 text-lg">
              {userMail || (isHydrating ? "Loading..." : "")}
            </p>
          </div>
        </div>
      </div>

      {/* Change Password */}
      <div
        className="mb-8 p-6 bg-white rounded-lg shadow-sm cursor-pointer"
        onClick={() => setModalOpen(true)}
      >
        <div className="flex items-center">
          <img src={pass} alt="" className="mr-6" />
          <div>
            <p className="font-medium text-xl">Change Password</p>
            <p className="text-gray-600 text-lg">Change your password.</p>
          </div>
        </div>
      </div>

      {/* Appearance Section */}
      <div className="mb-8 p-6 bg-white rounded-lg shadow-sm">
        <div className="flex items-center justify-between">
          <div className="flex items-center">
            <img src={modes} alt="" className="mr-6" />
            <div>
              <p className="font-medium text-xl">Appearance</p>
              <p className="text-gray-600 text-lg">
                Switch between light and dark mode.
              </p>
            </div>
          </div>
          <DayNightToggle />
        </div>
      </div>

      {/* Notifications Section */}
      <div className="mb-8 p-6 bg-white rounded-lg shadow-sm">
        <div className="flex items-center justify-between">
          <div className="flex items-center">
            <img src={notifications} alt="" className="mr-6" />
            <div>
              <p className="font-medium text-xl">Notifications</p>
              <p className="text-gray-600 text-lg">
                Get notified about assignments and updates.
              </p>
            </div>
          </div>
          <ToggleSwitch
            isOn={isNotification}
            onToggle={handleNotificationSetting}
            disabled={isUpdatingNotification}
          />
        </div>
      </div>

      {/* Log Out Section */}
      <div
        className="p-6 bg-white rounded-lg shadow-sm cursor-pointer"
        onClick={() => setSignOutModalOpen(true)}
      >
        <div className="flex items-center">
          <img src={logout} alt="" className="mr-6" />
          <div>
            <p className="font-medium text-xl">Sign Out</p>
            <p className="text-gray-600 text-lg">Sign out of all your devices.</p>
          </div>
        </div>
      </div>

      {/* Change Password Modal */}
      <ChangePasswordModal isOpen={isModalOpen} onClose={() => setModalOpen(false)} />

      <SignOutModal
        isOpen={isSignOutModalOpen}
        onClose={() => setSignOutModalOpen(false)}
        onConfirm={handleSignOut}
      />

      <ToastContainer />
    </div>
  );
};

export default SettingsPage;
