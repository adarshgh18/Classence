import io from 'socket.io-client';

let sharedSocket = null;
let activeToken = null;

/**
 * Get or initialize the shared authenticated Socket.io client instance.
 * Avoids opening redundant socket connections across components.
 * 
 * @param {string} [tokenOverride] - Optional token to override storage lookup
 * @returns {Socket|null}
 */
export const getSharedSocket = (tokenOverride) => {
  const token =
    tokenOverride ||
    (typeof window !== 'undefined'
      ? sessionStorage.getItem('authToken') || localStorage.getItem('authToken')
      : null);

  if (!token) {
    if (sharedSocket) {
      sharedSocket.disconnect();
      sharedSocket = null;
      activeToken = null;
    }
    return null;
  }

  // If already connected with the same token, reuse the socket
  if (sharedSocket && activeToken === token) {
    if (!sharedSocket.connected && !sharedSocket.connecting) {
      sharedSocket.connect();
    }
    return sharedSocket;
  }

  // If token changed, tear down old socket
  if (sharedSocket && activeToken !== token) {
    sharedSocket.disconnect();
    sharedSocket = null;
  }

  activeToken = token;
  const socketUrl = process.env.REACT_APP_SOCKET_URL || 'http://localhost:5000';

  sharedSocket = io(socketUrl, {
    auth: { token },
    query: { token },
    reconnection: true,
    reconnectionAttempts: 10,
    reconnectionDelay: 1000,
    transports: ['websocket', 'polling']
  });

  return sharedSocket;
};

/**
 * Cleanly disconnect and destroy the shared socket instance (e.g. on logout).
 */
export const disconnectSharedSocket = () => {
  if (sharedSocket) {
    try {
      sharedSocket.disconnect();
    } catch (e) {
      // ignore
    }
    sharedSocket = null;
    activeToken = null;
  }
};
