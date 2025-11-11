import { WEBHOOK_BASE_URL } from './urlConfig.js';
import { WebSocketEventManager } from './websocketEvents.js';

let mediaRecorder;
let wsManager;
let callTimer;
let callStartTime;

function updateCallStatus(status) {
    const statusIndicator = document.getElementById('call-status');
    if (statusIndicator) {
        statusIndicator.setAttribute('data-status', status);
    }
}

async function startStreaming() {
    console.log('[Main] Starting streaming...');
    updateCallStatus('disconnected');
    
    // Create WebSocket manager with connection callbacks
    console.log(`[Main] Connecting to WebSocket: ${WEBHOOK_BASE_URL}/interact-s2s`);
    wsManager = new WebSocketEventManager(`${WEBHOOK_BASE_URL}/interact-s2s`, {
        onConnect: () => {
            console.log('[Main] WebSocket connected callback');
            updateCallStatus('connected');
        },
        onDisconnect: (event) => {
            console.log('[Main] WebSocket disconnected callback:', event);
            updateCallStatus('disconnected');
        },
        onError: (event) => {
            console.error('[Main] WebSocket error callback:', event);
            updateCallStatus('error');
        }
    });

    try {
        console.log('[Main] Requesting microphone access...');
        const stream = await navigator.mediaDevices.getUserMedia({
            audio: {
                channelCount: 1,           // Mono
                sampleRate: 16000,         // 16kHz
                sampleSize: 16,            // 16-bit
                echoCancellation: true,    // Enable echo cancellation
                noiseSuppression: true,    // Enable noise suppression
                autoGainControl: true      // Enable automatic gain control
            }
        });
        console.log('[Main] Microphone access granted');

        // Create AudioContext for processing
        const audioContext = new AudioContext({
            sampleRate: 16000,
            latencyHint: 'interactive'
        });

        // Create MediaStreamSource
        const source = audioContext.createMediaStreamSource(stream);

        // Create ScriptProcessor for raw PCM data
        const processor = audioContext.createScriptProcessor(512, 1, 1);

        source.connect(processor);
        processor.connect(audioContext.destination);

        processor.onaudioprocess = (e) => {
            const inputData = e.inputBuffer.getChannelData(0);

            const buffer = new ArrayBuffer(inputData.length * 2);
            const pcmData = new DataView(buffer);
            for (let i = 0; i < inputData.length; i++) {
                const int16 = Math.max(-32768, Math.min(32767, Math.round(inputData[i] * 32767)));
                pcmData.setInt16(i * 2, int16, true);
            }
            // Binary data string
            let data = "";
            for (let i = 0; i < pcmData.byteLength; i++) {
                data += String.fromCharCode(pcmData.getUint8(i));
            }

            // Send to WebSocket
            if (wsManager) {
                wsManager.sendAudioChunk(btoa(data));
            }
        };

        // Start call timer
        startCallTimer();

        // Store cleanup functions
        window.audioCleanup = () => {
            processor.disconnect();
            source.disconnect();
            stream.getTracks().forEach(track => track.stop());
        };

    } catch (error) {
        console.error("Error accessing microphone:", error);
        updateCallStatus('error');
    }
}

function stopStreaming() {
    // Cleanup audio processing
    if (window.audioCleanup) {
        window.audioCleanup();
    }

    if (wsManager) {
        wsManager.cleanup();
    }

    // Stop call timer
    stopCallTimer();
    
    // Update status
    updateCallStatus('disconnected');
    
    // Call parent window method to navigate to feedback section
    // Using postMessage for cross-origin communication
    try {
        window.parent.postMessage({ action: 'endSession' }, '*');
        console.log('Session ended - sent message to parent');
    } catch (error) {
        console.error('Error calling parent method:', error);
    }
}

function startCallTimer() {
    // Start from -5 minutes (-300 seconds)
    const startSeconds = -20;
    callStartTime = Date.now();
    
    callTimer = setInterval(() => {
        const elapsed = Math.floor((Date.now() - callStartTime) / 1000);
        const currentSeconds = startSeconds + elapsed;
        
        // Auto-end session when timer reaches 0
        if (currentSeconds >= 0) {
            stopStreaming();
            return;
        }
        
        // Calculate absolute values for display
        const absSeconds = Math.abs(currentSeconds);
        const minutes = Math.floor(absSeconds / 60);
        const seconds = absSeconds % 60;
        
        // Display with negative sign
        document.getElementById("call-timer").textContent = 
            `-${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
    }, 1000);
}

function stopCallTimer() {
    if (callTimer) {
        clearInterval(callTimer);
        callTimer = null;
    }
    document.getElementById("call-timer").textContent = "-00:20";
}

// Auto-start streaming on page load
document.addEventListener("DOMContentLoaded", () => {
    // Start streaming automatically
    startStreaming();
});

// Ensure audio context is resumed after user interaction
document.addEventListener('click', () => {
    if (wsManager && wsManager.audioContext && wsManager.audioContext.state === 'suspended') {
        wsManager.audioContext.resume();
    }
}, { once: true });

// Handle page unload to cleanup
window.addEventListener('beforeunload', () => {
    stopStreaming();
});
