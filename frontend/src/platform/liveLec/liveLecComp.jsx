import React, { useEffect, useRef, useState } from 'react';
import io from 'socket.io-client';
import { useLocation } from 'react-router-dom';
import { useSelector } from 'react-redux';
import axios from 'axios';
import { useNavigate } from 'react-router-dom';
import { toast } from 'react-toastify';

import { getWebRTCConfig } from './webrtcConfig';

const LiveVideoCall = () => {
  const isEnrolled = useSelector((state) => state.toggleState.isEnrolled);

  const [isConnected, setIsConnected] = useState(false);
  const [isLive, setIsLive] = useState(false);
  const [isGoingLive, setIsGoingLive] = useState(false);
  const [error, setError] = useState('');
  const location = useLocation();
  const lectureId = location.state?.lectureId;
  const classCode = location.state?.classCode;
  
  const teacherId = location.state?.teacherId;
  const initialStatus = location.state?.initialStatus || 'upcoming';
  const [lectureStatus, setLectureStatus] = useState(initialStatus);
  const [showEndModal, setShowEndModal] = useState(false);
  const [isEnding, setIsEnding] = useState(false);

  const [youtubeUrl, setYoutubeUrl] = useState('');
  const videoRef = useRef(null);
  const studentVideoRef = useRef(null);
  const socketRef = useRef(null);
  const streamRef = useRef(null);

  // Student WebRTC state: 'idle' | 'waiting_for_teacher' | 'connecting' | 'connected' | 'paused' | 'failed' | 'ended'
  const [studentStreamStatus, setStudentStreamStatus] = useState(
    initialStatus === 'paused' ? 'paused' : 'waiting_for_teacher'
  );
  const [studentStatusMessage, setStudentStatusMessage] = useState(
    initialStatus === 'paused'
      ? 'Teacher paused the session. Waiting for the lecture to resume...'
      : 'Waiting for teacher to start stream...'
  );

  // Phase B: WebRTC peer management refs (Teacher side)
  // Map of studentSocketId -> RTCPeerConnection
  const peerConnectionsRef = useRef(new Map());
  // Map of studentSocketId -> Array of queued ICE candidates (received before remote description)
  const pendingCandidatesRef = useRef(new Map());

  // Phase C: Student WebRTC refs
  // Single RTCPeerConnection for the student receiving teacher's stream
  const studentPeerConnectionRef = useRef(null);
  // Queue of ICE candidates received from teacher before remote description is set
  const studentPendingCandidatesRef = useRef([]);
  // Track if attendance was already recorded during this mount to avoid duplicates
  const attendanceMarkedRef = useRef(false);

  const userId = sessionStorage.getItem('userId');
  const isTeacher = userId === teacherId;
  const token = sessionStorage.getItem('authToken') || localStorage.getItem('authToken');
  const navigate = useNavigate();

  // Helper: Close and delete a specific student's peer connection (Teacher side)
  const closePeer = (studentSocketId) => {
    const pc = peerConnectionsRef.current.get(studentSocketId);
    if (pc) {
      try {
        pc.onicecandidate = null;
        pc.onconnectionstatechange = null;
        pc.close();
      } catch (err) {
        console.warn(`Error closing peer connection for ${studentSocketId}:`, err);
      }
      peerConnectionsRef.current.delete(studentSocketId);
    }
    pendingCandidatesRef.current.delete(studentSocketId);
  };

  // Helper: Close all active peer connections (Teacher side)
  const closeAllPeers = () => {
    peerConnectionsRef.current.forEach((pc, studentSocketId) => {
      try {
        pc.onicecandidate = null;
        pc.onconnectionstatechange = null;
        pc.close();
      } catch (err) {
        console.warn(`Error closing peer connection for ${studentSocketId}:`, err);
      }
    });
    peerConnectionsRef.current.clear();
    pendingCandidatesRef.current.clear();
  };

  // Helper: Clean up student's WebRTC peer connection and remote stream
  const cleanupStudentPeer = () => {
    if (studentPeerConnectionRef.current) {
      try {
        studentPeerConnectionRef.current.onicecandidate = null;
        studentPeerConnectionRef.current.ontrack = null;
        studentPeerConnectionRef.current.onconnectionstatechange = null;
        studentPeerConnectionRef.current.close();
      } catch (err) {
        console.warn('Error closing student peer connection:', err);
      }
      studentPeerConnectionRef.current = null;
    }
    studentPendingCandidatesRef.current = [];
    if (studentVideoRef.current) {
      studentVideoRef.current.srcObject = null;
    }
  };

  // Helper: Create student's RTCPeerConnection to receive teacher stream
  const getOrCreateStudentPeer = (teacherSocketId) => {
    if (studentPeerConnectionRef.current) {
      return studentPeerConnectionRef.current;
    }

    try {
      const rtcConfig = getWebRTCConfig();
      const pc = new RTCPeerConnection(rtcConfig);
      studentPeerConnectionRef.current = pc;
      studentPendingCandidatesRef.current = [];
      setStudentStreamStatus('connecting');
      setStudentStatusMessage('Connecting to teacher...');

      // Relay local student ICE candidates to teacher
      pc.onicecandidate = (event) => {
        if (event.candidate && socketRef.current && teacherSocketId) {
          socketRef.current.emit('webrtc-ice-candidate', {
            targetSocketId: teacherSocketId,
            candidate: event.candidate
          });
        }
      };

      // Receive remote tracks from teacher and attach to video element
      pc.ontrack = (event) => {
        console.log('Received remote track from teacher:', event.track.kind);
        const [remoteStream] = event.streams;
        if (studentVideoRef.current && remoteStream) {
          studentVideoRef.current.srcObject = remoteStream;
          studentVideoRef.current.play().catch((playErr) => {
            console.warn('Auto-play blocked or delayed:', playErr);
          });
        }
      };

      // Connection state tracking based strictly on real RTCPeerConnection state
      pc.onconnectionstatechange = () => {
        console.log('Student RTCPeerConnection state:', pc.connectionState);
        if (pc.connectionState === 'connected') {
          setStudentStreamStatus('connected');
          setStudentStatusMessage('Live');
        } else if (pc.connectionState === 'connecting') {
          setStudentStreamStatus('connecting');
          setStudentStatusMessage('Connecting...');
        } else if (pc.connectionState === 'failed') {
          setStudentStreamStatus('failed');
          setStudentStatusMessage('Connection failed. Retrying or waiting for teacher...');
        } else if (pc.connectionState === 'disconnected') {
          setStudentStreamStatus('waiting_for_teacher');
          setStudentStatusMessage('Teacher disconnected. Waiting for reconnection...');
        } else if (pc.connectionState === 'closed') {
          setStudentStreamStatus('ended');
          setStudentStatusMessage('Lecture session closed.');
        }
      };

      return pc;
    } catch (err) {
      console.error('Failed to create student RTCPeerConnection:', err);
      setStudentStreamStatus('failed');
      setStudentStatusMessage('WebRTC initialization failed.');
      return null;
    }
  };

  // Helper: Create an RTCPeerConnection for a student, attach teacher media tracks, and send offer (Teacher side)
  const createPeerForStudent = async (studentSocketId) => {
    if (!socketRef.current || !streamRef.current) {
      console.warn('Cannot create peer connection: socket or local media stream is missing');
      return;
    }

    // Prevent duplicate peer connections for the same student socket
    if (peerConnectionsRef.current.has(studentSocketId)) {
      console.log(`Peer connection already exists for student socket: ${studentSocketId}`);
      return;
    }

    try {
      const rtcConfig = getWebRTCConfig();
      const pc = new RTCPeerConnection(rtcConfig);
      peerConnectionsRef.current.set(studentSocketId, pc);
      pendingCandidatesRef.current.set(studentSocketId, []);

      // Add local audio/video tracks to peer connection
      streamRef.current.getTracks().forEach((track) => {
        pc.addTrack(track, streamRef.current);
      });

      // Send local ICE candidates to the student via backend signaling
      pc.onicecandidate = (event) => {
        if (event.candidate && socketRef.current) {
          socketRef.current.emit('webrtc-ice-candidate', {
            targetSocketId: studentSocketId,
            candidate: event.candidate
          });
        }
      };

      pc.onconnectionstatechange = () => {
        if (pc.connectionState === 'failed' || pc.connectionState === 'closed') {
          console.warn(`Peer connection state for ${studentSocketId} is now ${pc.connectionState}`);
          closePeer(studentSocketId);
        }
      };

      // Create and set local SDP offer
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      // Emit offer through backend signaling
      socketRef.current.emit('webrtc-offer', {
        targetSocketId: studentSocketId,
        sdp: pc.localDescription
      });
    } catch (err) {
      console.error(`Failed to establish WebRTC peer connection for student ${studentSocketId}:`, err);
      closePeer(studentSocketId);
    }
  };

  useEffect(() => {
    if (!token || !lectureId) {
      navigate('/dashboard');
      return;
    }

    if (!isTeacher && !attendanceMarkedRef.current) {
      attendanceMarkedRef.current = true;
      markAttendance();
    }

    const socket = io(process.env.REACT_APP_SOCKET_URL || 'http://localhost:5000', {
      query: { token },
      autoConnect: false
    });
    socketRef.current = socket;

    // Connect handler
    socket.on('connect', () => {
      setIsConnected(true);
      console.log('Connected to signaling server');
      // Join legacy room for backward compatibility
      socket.emit('join-room', `lecture-${lectureId}`);

      // If student, attempt to join the authenticated signaling room immediately
      if (!isTeacher) {
        socket.emit('join-lecture-room', { lectureId });
      }
    });

    // Authenticated lecture room join response
    socket.on('lecture-room-joined', (data) => {
      console.log('Joined lecture signaling room:', data);
      if (isTeacher && data.role !== 'teacher') {
        console.warn('Unexpected role returned on lecture-room-joined for teacher view:', data.role);
      } else if (!isTeacher) {
        if (data.role === 'student') {
          setStudentStreamStatus('waiting_for_teacher');
          setStudentStatusMessage('Connected to lecture. Waiting for teacher stream...');
        } else {
          console.warn('Unexpected role returned on lecture-room-joined for student view:', data.role);
        }
      }
    });

    // Teacher discovers student
    socket.on('student-joined', async ({ studentSocketId }) => {
      if (isTeacher && studentSocketId) {
        console.log(`Student joined event received for socket: ${studentSocketId}`);
        await createPeerForStudent(studentSocketId);
      }
    });

    // Phase C: Student receives WebRTC offer from teacher
    socket.on('webrtc-offer', async ({ senderSocketId, sdp }) => {
      if (isTeacher) return; // Only student handles incoming offer
      console.log(`Student received webrtc-offer from teacher socket: ${senderSocketId}`);

      try {
        const pc = getOrCreateStudentPeer(senderSocketId);
        if (!pc) return;

        // Apply remote description (offer)
        await pc.setRemoteDescription(new RTCSessionDescription(sdp));

        // Flush any ICE candidates received before remote description was set
        const queued = studentPendingCandidatesRef.current || [];
        for (const cand of queued) {
          try {
            await pc.addIceCandidate(new RTCIceCandidate(cand));
          } catch (iceErr) {
            console.warn('Failed adding queued ICE candidate on student:', iceErr);
          }
        }
        studentPendingCandidatesRef.current = [];

        // Create and set local answer
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);

        // Emit answer to teacher via backend signaling
        socket.emit('webrtc-answer', {
          targetSocketId: senderSocketId,
          sdp: pc.localDescription
        });
      } catch (err) {
        console.error('Error handling webrtc-offer on student:', err);
        setStudentStreamStatus('failed');
        setStudentStatusMessage('Failed to establish connection with teacher.');
      }
    });

    // Teacher handles SDP answer from student
    socket.on('webrtc-answer', async ({ senderSocketId, sdp }) => {
      if (!isTeacher) return;
      const pc = peerConnectionsRef.current.get(senderSocketId);
      if (!pc) {
        console.warn(`Received answer for non-existent peer connection: ${senderSocketId}`);
        return;
      }

      try {
        await pc.setRemoteDescription(new RTCSessionDescription(sdp));

        // Flush any ICE candidates queued while awaiting remote description
        const queued = pendingCandidatesRef.current.get(senderSocketId) || [];
        for (const cand of queued) {
          try {
            await pc.addIceCandidate(new RTCIceCandidate(cand));
          } catch (iceErr) {
            console.warn(`Failed adding queued ICE candidate for ${senderSocketId}:`, iceErr);
          }
        }
        pendingCandidatesRef.current.set(senderSocketId, []);
      } catch (err) {
        console.error(`Error setting remote description from student ${senderSocketId}:`, err);
      }
    });

    // Handle ICE candidates (both teacher and student)
    socket.on('webrtc-ice-candidate', async ({ senderSocketId, candidate }) => {
      if (!candidate) return;

      if (isTeacher) {
        // Teacher receives student candidate
        const pc = peerConnectionsRef.current.get(senderSocketId);
        if (!pc) return;

        if (!pc.remoteDescription) {
          const queue = pendingCandidatesRef.current.get(senderSocketId) || [];
          queue.push(candidate);
          pendingCandidatesRef.current.set(senderSocketId, queue);
        } else {
          try {
            await pc.addIceCandidate(new RTCIceCandidate(candidate));
          } catch (err) {
            console.warn(`Error adding ICE candidate for ${senderSocketId}:`, err);
          }
        }
      } else {
        // Student receives teacher candidate
        const pc = studentPeerConnectionRef.current;
        if (!pc || !pc.remoteDescription) {
          // Remote description not yet set, queue candidate
          studentPendingCandidatesRef.current.push(candidate);
        } else {
          try {
            await pc.addIceCandidate(new RTCIceCandidate(candidate));
          } catch (err) {
            console.warn('Error adding ICE candidate on student:', err);
          }
        }
      }
    });

    // Teacher: Student disconnected or left room
    socket.on('student-left', ({ studentSocketId }) => {
      if (isTeacher) {
        console.log(`Student left event received for socket: ${studentSocketId}`);
        closePeer(studentSocketId);
      }
    });

    // Signaling errors
    socket.on('lecture-signal-error', (errData) => {
      console.warn('Signaling error received:', errData);
      if (!isTeacher && errData?.message?.includes('not currently live')) {
        setStudentStreamStatus('waiting_for_teacher');
        setStudentStatusMessage('Waiting for lecture to start...');
      }
    });

    // Lifecycle event: lecture paused
    socket.on('lecture-paused', () => {
      setIsLive(false);
      setLectureStatus('paused');
      if (isTeacher) {
        closeAllPeers();
        cleanupMedia();
      } else {
        cleanupStudentPeer();
        setStudentStreamStatus('paused');
        setStudentStatusMessage('Teacher paused the session. Waiting for the lecture to resume...');
      }
    });

    // Lifecycle event: lecture resumed
    socket.on('lecture-resumed', () => {
      setIsLive(true);
      setLectureStatus('live');
      if (!isTeacher) {
        setStudentStreamStatus('connecting');
        setStudentStatusMessage('Teacher resumed the session. Connecting...');
        cleanupStudentPeer();
        if (socketRef.current) {
          socketRef.current.emit('join-lecture-room', { lectureId });
        }
      }
    });

    // Lifecycle event: lecture started (for students waiting in room)
    socket.on('lecture-started', () => {
      setIsLive(true);
      setLectureStatus('live');
      if (!isTeacher) {
        setStudentStreamStatus('connecting');
        setStudentStatusMessage('Connecting to teacher...');
        cleanupStudentPeer();
        if (socketRef.current) {
          socketRef.current.emit('join-lecture-room', { lectureId });
        }
      }
    });

    // Lifecycle event: lecture completed
    socket.on('lecture-completed', () => {
      setIsLive(false);
      setLectureStatus('completed');
      if (isTeacher) {
        closeAllPeers();
        cleanupMedia();
      } else {
        cleanupStudentPeer();
        setStudentStreamStatus('ended');
        setStudentStatusMessage('Lecture has ended.');
      }
    });

    // Lecture ended fallback event
    socket.on('lecture-ended', () => {
      setIsLive(false);
      setLectureStatus('completed');
      if (isTeacher) {
        closeAllPeers();
        cleanupMedia();
      } else {
        cleanupStudentPeer();
        setStudentStreamStatus('ended');
        setStudentStatusMessage('Lecture has ended.');
      }
    });

    socket.on('youtube-video-url', (url) => {
      setYoutubeUrl(url);
      setIsLive(true);
      setIsGoingLive(false);
    });

    socket.connect();

    return () => {
      if (isTeacher) {
        closeAllPeers();
        cleanupMedia();
      } else {
        cleanupStudentPeer();
      }
      if (socketRef.current) {
        socketRef.current.emit('leave-lecture-room');
        socketRef.current.disconnect();
        socketRef.current = null;
      }
    };
  }, [token, lectureId]);

  const startLiveSession = async () => {
    if (!isTeacher) return;

    setError('');
    setIsGoingLive(true);

    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: true,
        audio: true
      });
    } catch (mediaErr) {
      setIsGoingLive(false);
      let message = 'Unable to access camera or microphone.';
      if (mediaErr?.name === 'NotAllowedError' || mediaErr?.name === 'PermissionDeniedError') {
        message = 'Camera and microphone permission was denied.';
      } else if (mediaErr?.name === 'NotFoundError' || mediaErr?.name === 'DevicesNotFoundError') {
        message = 'No camera or microphone was found.';
      } else if (mediaErr?.name === 'NotReadableError' || mediaErr?.name === 'TrackStartError') {
        message = 'Camera or microphone is already in use or unavailable.';
      }
      setError(message);
      return;
    }

    streamRef.current = stream;
    if (videoRef.current) {
      videoRef.current.srcObject = stream;
    }

    let response;
    try {
      response = await fetch(`${process.env.REACT_APP_API_URL}/lecture/start-live-session`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ lectureId })
      });
    } catch (netErr) {
      setIsGoingLive(false);
      cleanupMedia();
      setError('Unable to connect to the server.');
      return;
    }

    if (response.ok) {
      setIsLive(true);
      setLectureStatus('live');
      setIsGoingLive(false);
      setError('');
      toast.success(lectureStatus === 'paused' ? 'Session resumed successfully' : 'Session started successfully');

      // Join the authenticated WebRTC signaling lecture room
      if (socketRef.current) {
        socketRef.current.emit('join-lecture-room', { lectureId });
      }
    } else {
      const data = await response.json().catch(() => null);
      setIsGoingLive(false);
      cleanupMedia();
      setError(data?.error || data?.message || 'Failed to start live session');
    }
  };

  const stopLiveSession = async () => {
    try {
      await fetch(`${process.env.REACT_APP_API_URL}/lecture/stop-live-session`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ lectureId })
      });

      setIsLive(false);
      setLectureStatus('paused');
      if (socketRef.current) {
        socketRef.current.emit('leave-lecture-room');
      }
      closeAllPeers();
      cleanupMedia();
      toast.info('Session paused');
    } catch (err) {
      setError('Failed to pause live session');
    }
  };

  const completeLecture = async () => {
    setIsEnding(true);
    try {
      const response = await fetch(`${process.env.REACT_APP_API_URL}/lecture/complete-lecture`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ lectureId })
      });

      if (response.ok) {
        setIsLive(false);
        setLectureStatus('completed');
        setShowEndModal(false);
        toast.success('Lecture permanently ended');
        if (socketRef.current) {
          socketRef.current.emit('leave-lecture-room');
        }
        closeAllPeers();
        cleanupMedia();
      } else {
        const data = await response.json().catch(() => null);
        toast.error(data?.error || data?.message || 'Failed to complete lecture');
      }
    } catch (err) {
      console.error('Error completing lecture:', err);
      toast.error('Network error while completing lecture');
    } finally {
      setIsEnding(false);
    }
  };

  const markAttendance = async () => {
    try {
      const axiosConfig = {
        headers: {
          'Authorization': `Bearer ${token}`,
        },
      };

      const response = await axios.post(
        `${process.env.REACT_APP_API_URL}/lecture/mark`,
        { lectureId },
        axiosConfig
      );
      if (response.status === 200 && response.data.lecture?.youtubeLiveStreamURL) {
        setYoutubeUrl(response.data.lecture.youtubeLiveStreamURL.replace("watch?v=", "embed/"));
      }
    } catch (error) {
      console.error('Error marking attendance:', error);
      setError('Failed to join lecture');
    }
  };

  const cleanupMedia = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
  };

  return (
    <div className="p-8  bg-[#E1EAE8] h-[100vh] mt-[50px]">
      <div className="w-full mx-auto bg-[#E1EAE8]">
        <div className="bg-white rounded-lg shadow-lg p-6 ">
          <h2 className="text-2xl font-semibold mb-4 ">Live Session</h2>
          
          {!isEnrolled ? (
            <div className="mb-4">
              Status: {isTeacher 
                ? (isLive 
                    ? 'Live' 
                    : isGoingLive 
                      ? 'Going Live' 
                      : lectureStatus === 'paused' 
                        ? 'Paused' 
                        : lectureStatus === 'completed'
                          ? 'Completed'
                          : 'Not Live')
                : (studentStreamStatus === 'connected' 
                    ? 'Live' 
                    : studentStreamStatus === 'paused'
                      ? 'Paused'
                      : studentStatusMessage)}
              {error && <p className="text-red-500 mt-2">{error}</p>}
            </div>
          ) : null}

          {isTeacher ? (
            <>
              <div className="relative w-full h-[400px] bg-black rounded-lg mb-4">
                <video
                  ref={videoRef}
                  autoPlay
                  muted
                  className="w-full h-full object-cover rounded-lg"
                />
                {isGoingLive && (
                  <div className="absolute inset-0 flex flex-col items-center justify-center bg-black bg-opacity-50 rounded-lg">
                    <div className="animate-spin rounded-full h-16 w-16 border-t-4 border-b-4 border-teal-500"></div>
                    <p className="mt-4 text-xl text-white">Going Live...</p>
                  </div>
                )}
              </div>
              <div className="flex gap-4">
                {lectureStatus === 'paused' ? (
                  <button
                    onClick={startLiveSession}
                    disabled={isLive || isGoingLive}
                    className="px-4 py-2 bg-teal-600 text-white rounded-lg disabled:bg-gray-400 hover:bg-teal-700 transition-colors"
                  >
                    Resume Session
                  </button>
                ) : (
                  <button
                    onClick={startLiveSession}
                    disabled={isLive || isGoingLive || lectureStatus === 'completed'}
                    className="px-4 py-2 bg-teal-600 text-white rounded-lg disabled:bg-gray-400 hover:bg-teal-700 transition-colors"
                  >
                    Start Session
                  </button>
                )}
                {isLive && (
                  <button
                    onClick={stopLiveSession}
                    className="px-4 py-2 bg-amber-600 text-white rounded-lg hover:bg-amber-700 transition-colors"
                  >
                    Pause Session
                  </button>
                )}
                {(isLive || lectureStatus === 'paused') && (
                  <button
                    onClick={() => setShowEndModal(true)}
                    disabled={lectureStatus === 'completed'}
                    className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors disabled:bg-gray-400"
                  >
                    End Lecture
                  </button>
                )}
              </div>

              {showEndModal && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50">
                  <div className="bg-white rounded-lg shadow-xl p-6 max-w-md w-full mx-4">
                    <h3 className="text-xl font-bold text-gray-900 mb-2">End Lecture Permanently?</h3>
                    <p className="text-gray-600 mb-6 text-sm">
                      Are you sure you want to permanently complete this lecture? Students will no longer be able to rejoin after permanent completion.
                    </p>
                    <div className="flex justify-end gap-3">
                      <button
                        type="button"
                        onClick={() => setShowEndModal(false)}
                        disabled={isEnding}
                        className="px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 transition-colors text-sm font-medium"
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        onClick={completeLecture}
                        disabled={isEnding}
                        className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors disabled:bg-gray-400 text-sm font-medium"
                      >
                        {isEnding ? 'Ending...' : 'End Lecture'}
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </>
          ) : (
            <div className="relative w-full min-h-[400px] bg-black rounded-lg overflow-hidden flex flex-col items-center justify-center">
              {/* Student Video Element */}
              <video
                ref={studentVideoRef}
                autoPlay
                playsInline
                controls
                className={`w-full h-[600px] object-contain rounded-lg ${studentStreamStatus === 'connected' ? 'block' : 'hidden'}`}
              />

              {/* Status Overlay when not connected */}
              {studentStreamStatus !== 'connected' && (
                <div className="w-full h-[400px] bg-gray-100 rounded-lg flex flex-col items-center justify-center p-6 text-center">
                  {studentStreamStatus === 'connecting' && (
                    <div className="animate-spin rounded-full h-12 w-12 border-t-4 border-b-4 border-teal-500 mb-4"></div>
                  )}
                  <p className="text-gray-600 text-lg font-medium">
                    {studentStatusMessage}
                  </p>
                  {studentStreamStatus === 'failed' && (
                    <button
                      onClick={() => {
                        if (socketRef.current) {
                          setStudentStreamStatus('connecting');
                          setStudentStatusMessage('Reconnecting...');
                          cleanupStudentPeer();
                          socketRef.current.emit('join-lecture-room', { lectureId });
                        }
                      }}
                      className="mt-4 px-4 py-2 bg-teal-600 text-white rounded-lg hover:bg-teal-700"
                    >
                      Retry Connection
                    </button>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default LiveVideoCall;
