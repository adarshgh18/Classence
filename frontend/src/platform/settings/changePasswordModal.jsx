import React, { useState, useEffect } from "react";
import axios from "axios";
import tick from '../../auth/assets/tick.svg';
import cross from '../../auth/assets/cross.svg';

const ChangePasswordModal = ({ isOpen, onClose }) => {
    const [isFadingOut, setIsFadingOut] = useState(false);
    const [oldPassword, setOldPassword] = useState("");
    const [newPassword, setNewPassword] = useState("");
    const [confirmPassword, setConfirmPassword] = useState("");
    const [error, setError] = useState("");
    const [success, setSuccess] = useState("");
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [validation, setValidation] = useState({
        uppercase: false,
        number: false,
        specialChar: false,
        minLength: false,
    });

    const resetForm = () => {
        setOldPassword("");
        setNewPassword("");
        setConfirmPassword("");
        setError("");
        setSuccess("");
        setIsSubmitting(false);
        setValidation({
            uppercase: false,
            number: false,
            specialChar: false,
            minLength: false,
        });
    };

    const handleClose = () => {
        setIsFadingOut(true);
        setTimeout(() => {
            setIsFadingOut(false);
            resetForm();
            onClose();
        }, 300);
    };

    useEffect(() => {
        if (isOpen) {
            setIsFadingOut(false);
            resetForm();
        }
    }, [isOpen]);

    // Password validation logic
    const validatePassword = (password) => {
        setValidation({
            uppercase: /[A-Z]/.test(password),
            number: /[0-9]/.test(password),
            specialChar: /[@#$%^&*()_+\-=[\]{};':"\\|,.<>/?]/.test(password),
            minLength: password.length >= 8,
        });
    };

    const handlePasswordChange = (e) => {
        const password = e.target.value;
        setNewPassword(password);
        validatePassword(password);
    };

    const calculateStrength = () => {
        const validCriteria = Object.values(validation).filter(Boolean).length;
        const strength = (validCriteria / 4) * 100;
        return strength;
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        setError("");
        setSuccess("");

        if (!oldPassword) {
            setError("Please enter your old password.");
            return;
        }

        if (!Object.values(validation).every(Boolean)) {
            setError("Please ensure your password meets all the requirements.");
            return;
        }

        if (newPassword !== confirmPassword) {
            setError("New password and confirm password do not match.");
            return;
        }

        // Determine where current auth token is stored to preserve remember-me semantics
        const token = sessionStorage.getItem("authToken") || localStorage.getItem("authToken");
        const hadLocalStorageToken = Boolean(localStorage.getItem("authToken"));

        const axiosConfig = {
            headers: {
                Authorization: `Bearer ${token}`,
            },
        };

        setIsSubmitting(true);
        try {
            const response = await axios.post(
                `${process.env.REACT_APP_API_URL}/user/settings/change-password`,
                { oldPassword, newPassword },
                axiosConfig
            );

            // Preserve existing session storage semantics:
            // If token came from localStorage -> write replacement to localStorage
            // If token came from sessionStorage -> write replacement to sessionStorage
            const newToken = response.data.token;
            if (hadLocalStorageToken) {
                localStorage.setItem("authToken", newToken);
                sessionStorage.removeItem("authToken");
            } else {
                sessionStorage.setItem("authToken", newToken);
                localStorage.removeItem("authToken");
            }

            setSuccess(response.data.message || "Password changed successfully!");
            setOldPassword("");
            setNewPassword("");
            setConfirmPassword("");
            setTimeout(handleClose, 2000);
        } catch (err) {
            if (err.response) {
                setError(err.response.data?.message || err.response.data?.error || "Failed to change password.");
            } else if (err.request) {
                setError("No response from the server. Please try again later.");
            } else {
                setError("An unexpected error occurred. Please try again.");
            }
        } finally {
            setIsSubmitting(false);
        }
    };

    const showModal = isOpen && !isFadingOut;
    const isPasswordValid = Object.values(validation).every(Boolean);

    return (
        <div
            className={`fixed inset-0 z-10 flex items-center justify-center bg-black bg-opacity-50 transition-opacity duration-300 ${
                showModal ? "opacity-100" : "opacity-0 pointer-events-none"
            }`}
        >
            <div
                className={`bg-white px-8 py-12 w-[90%] max-w-lg relative transform transition-all duration-300 ${
                    showModal ? "scale-100" : "scale-95"
                }`}
            >
                <button
                    className="absolute top-7 right-5 text-4xl text-gray-700"
                    onClick={handleClose}
                    aria-label="Close modal"
                >
                    &times;
                </button>
                <h2 className="text-2xl font-semibold mb-6">Change Password</h2>

                {error && <div className="text-red-500 mb-4" role="alert">{error}</div>}
                {success && <div className="text-green-500 mb-4" role="status">{success}</div>}

                <form onSubmit={handleSubmit}>
                    <label className="block mb-4">
                        <input
                            type="password"
                            className="w-full mt-1 p-2 border rounded-lg"
                            placeholder="Enter old password"
                            value={oldPassword}
                            onChange={(e) => setOldPassword(e.target.value)}
                            required
                        />
                    </label>
                    <label className="block mb-4">
                        <input
                            type="password"
                            className="w-full mt-1 p-2 border rounded-lg"
                            placeholder="Enter new password"
                            value={newPassword}
                            onChange={handlePasswordChange}
                            required
                        />
                    </label>
                    <label className="block mb-4">
                        <input
                            type="password"
                            className="w-full mt-1 p-2 border rounded-lg"
                            placeholder="Confirm new password"
                            value={confirmPassword}
                            onChange={(e) => {
                                setConfirmPassword(e.target.value);
                                if (error && e.target.value === newPassword) {
                                    setError("");
                                }
                            }}
                            required
                        />
                        {confirmPassword && newPassword && confirmPassword !== newPassword && (
                            <span className="text-red-500 text-sm mt-1 block">Passwords do not match</span>
                        )}
                    </label>

                    {/* Show validation indicators only if password is not empty and invalid */}
                    {newPassword && !isPasswordValid && (
                        <div className="mb-8">
                            <div className="w-full bg-gray-200 rounded-full h-2 overflow-hidden">
                                <div
                                    className="h-2 rounded-full transition-all duration-300"
                                    style={{
                                        width: `${calculateStrength()}%`,
                                        backgroundColor:
                                            calculateStrength() < 40
                                                ? "#C63C3C"
                                                : calculateStrength() < 70
                                                    ? "#FFB74D"
                                                    : "#358439",
                                    }}
                                ></div>
                            </div>
                        </div>
                    )}
                    {newPassword && !isPasswordValid && (
                        <div className="mb-4 text-sm text-gray-600 flex flex-col gap-2">
                            <p className="flex items-center gap-2">
                                {validation.uppercase ? <img src={tick} alt="" /> : <img src={cross} alt="" />} One uppercase letter
                            </p>
                            <p className="flex items-center gap-2">
                                {validation.number ? <img src={tick} alt="" /> : <img src={cross} alt="" />} One number
                            </p>
                            <p className="flex items-center gap-2">
                                {validation.specialChar ? <img src={tick} alt="" /> : <img src={cross} alt="" />} One special character (@#$% etc.)
                            </p>
                            <p className="flex items-center gap-2">
                                {validation.minLength ? <img src={tick} alt="" /> : <img src={cross} alt="" />} At least 8 characters
                            </p>
                        </div>
                    )}

                    <button
                        type="submit"
                        disabled={isSubmitting}
                        className={`bg-[#066769] w-full text-white px-4 py-4 rounded-lg mt-4 transition-opacity ${
                            isSubmitting ? "opacity-70 cursor-not-allowed" : "hover:bg-[#055657]"
                        }`}
                    >
                        {isSubmitting ? "Changing Password..." : "Change Password"}
                    </button>
                </form>
            </div>
        </div>
    );
};

export default ChangePasswordModal;
