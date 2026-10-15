/**
 * WebRTC Configuration
 * 
 * Provides standard ICE server configuration for WebRTC peer connections.
 * 
 * NOTE: For local testing and development, public STUN servers are used by default.
 * In restrictive NAT/firewall network environments, a TURN server with valid credentials
 * is typically required to relay media packets.
 * Production TURN configuration remains pending environment setup.
 */

export const getWebRTCConfig = () => {
  // Allow overriding or extending via environment variables if defined
  const stunUrls = process.env.REACT_APP_STUN_SERVERS
    ? process.env.REACT_APP_STUN_SERVERS.split(',').map(s => s.trim())
    : [
        'stun:stun.l.google.com:19302',
        'stun:stun1.l.google.com:19302'
      ];

  const iceServers = stunUrls.map(url => ({ urls: url }));

  // If TURN credentials are configured via environment in the future:
  if (process.env.REACT_APP_TURN_SERVER_URL && process.env.REACT_APP_TURN_USERNAME && process.env.REACT_APP_TURN_CREDENTIAL) {
    iceServers.push({
      urls: process.env.REACT_APP_TURN_SERVER_URL,
      username: process.env.REACT_APP_TURN_USERNAME,
      credential: process.env.REACT_APP_TURN_CREDENTIAL
    });
  }

  return {
    iceServers,
    iceCandidatePoolSize: 2
  };
};
