# Troubleshooting Guide

## No Text or Audio Showing

### Check Browser Console
1. Open browser DevTools (F12 or Cmd+Option+I)
2. Go to Console tab
3. Look for the following logs:

**Expected logs when working:**
```
[Main] Starting streaming...
[Main] Connecting to WebSocket: ws://localhost:8081/interact-s2s
[Main] Requesting microphone access...
[Main] Microphone access granted
WebSocket Connected
[Main] WebSocket connected callback
[Toast] Showing toast - Role: ...
```

### Common Issues:

#### 1. WebSocket Connection Failed
**Symptoms:**
- Red status indicator
- Console shows: `WebSocket Error`
- Console shows: `WebSocket Disconnected`

**Solution:**
- Make sure the backend server is running on `ws://localhost:8081`
- Check if port 8081 is open and accessible
- Verify the WebSocket endpoint `/interact-s2s` is correct

#### 2. Microphone Access Denied
**Symptoms:**
- Console shows: `Error accessing microphone`
- Browser shows permission denied notification

**Solution:**
- Allow microphone access when prompted
- Check browser settings → Privacy → Microphone
- Make sure site has microphone permissions

#### 3. No Toasts Appearing
**Symptoms:**
- WebSocket connected (green indicator)
- No error in console
- No toast notifications visible

**Solution:**
- Check if messages are being received:
  - Look for `[Toast] Showing toast` in console
  - Verify toast container exists in DOM
- Check if backend is sending messages in correct format

#### 4. No Audio Playing
**Symptoms:**
- Text toasts appear
- No sound from assistant

**Solution:**
- Check browser audio permissions
- Verify system volume is not muted
- Check AudioContext state in console
- Click anywhere on page to resume AudioContext (browser policy)

### Quick Check Commands (Browser Console)

```javascript
// Check if toast container exists
document.getElementById('toast-container')

// Check call status
document.getElementById('call-status').getAttribute('data-status')

// Check if WebSocket manager exists
window.wsManager

// Check WebSocket state
window.wsManager?.socket?.readyState
// 0 = CONNECTING, 1 = OPEN, 2 = CLOSING, 3 = CLOSED
```

### Server Requirements

1. **WebSocket Server**: Must be running on `ws://localhost:8081/interact-s2s`
2. **Audio Format**: 16kHz, 16-bit, mono PCM
3. **Message Format**: JSON with proper event structure

### Browser Requirements

- Modern browser with WebSocket support
- Microphone access allowed
- Audio playback enabled
- Not in private/incognito mode (for full features)
