import AudioPlayer from "./lib/play/AudioPlayer";
import ChatHistoryManager from "./lib/util/ChatHistoryManager.js";
import { FeedbackManager } from './feedbackManager.js';
import { GET_TPO_BY_ID } from "./urlConfig.js";

const audioPlayer = new AudioPlayer();

export class WebSocketEventManager {
    constructor(wsUrl, callbacks = {}) {
        const urlParams = new URLSearchParams(window.location.search);
        this.tpodId = urlParams.get('tpodId');
        console.log('tpodId:', this.tpodId);
        this.wsUrl = wsUrl;
        this.callbacks = callbacks;
        this.promptName = null;
        this.audioContentName = null;
        this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
        this.currentAudioConfig = null;
        this.isProcessing = false;
        this.displayAssistantText = false;
        this.role = null;
        this.chat = { history: [] };
        this.chatRef = { current: this.chat };
        this.feedbackManager = new FeedbackManager();
        this.toastTimers = {}; // Store timeout IDs for auto-dismiss

        this.chatHistoryManager = ChatHistoryManager.getInstance(
            this.chatRef,
            (newChat) => {
                this.chat = { ...newChat };
                this.chatRef.current = this.chat;
                this.updateChatUI();
            }
        );

        // 🔹 Fetch system prompt/config before connecting
        this.initialize = async () => {
            try {
            if (!this.tpodId) {
                throw new Error("Missing tpodId in URL");
            }

            const response = await fetch(`${GET_TPO_BY_ID}/${this.tpodId}`);
            if (!response.ok) {
                throw new Error("Failed to fetch TPOD config");
            }

            const data = await response.json();
            this.systemPromptFromTpod = data.personaPrompt;

            console.log("Fetched system prompt:", this.systemPromptFromTpod);

            // ✅ Connect only after API success
            this.connect();

            } catch (error) {
            console.error("Initialization error:", error);
            }
        };

        this.initialize();
    }

    updateChatUI() {
        // Get the latest message from history
        if (this.chat.history.length === 0) return;
        
        const latestItem = this.chat.history[this.chat.history.length - 1];
        
        if (latestItem.endOfConversation) {
            this.updateTranscription("Conversation ended", "system");
            return;
        }

        if (latestItem.role && latestItem.message) {
            this.updateTranscription(latestItem.message, latestItem.role.toLowerCase());
        }
    }

    updateTranscription(message, role) {
        const transcriptionContent = document.getElementById('transcription-content');
        if (!transcriptionContent) {
            console.error("Transcription content not found");
            return;
        }

        const placeholder = transcriptionContent.querySelector('.placeholder-text');
        if (placeholder) {
            placeholder.remove();
        }

        let displayRole;
        switch (role) {
            case 'user':
                displayRole = 'Agent';
                break;
            case 'assistant':
                displayRole = 'Customer';
                break;
            default:
                displayRole = 'System';
        }

        const lastLine = transcriptionContent.lastElementChild;
        if (lastLine && lastLine.tagName === 'P' && lastLine.dataset && lastLine.dataset.role === role) {
            lastLine.textContent = `${displayRole}: ${message || ''}`;
        } else {
            const line = document.createElement('p');
            line.dataset.role = role;
            line.textContent = `${displayRole}: ${message || ''}`;
            transcriptionContent.appendChild(line);
        }
        transcriptionContent.scrollTop = transcriptionContent.scrollHeight;
    }

    showToast(message, role) {
        console.log(`[Toast] Showing toast - Role: ${role}, Message: ${message?.substring(0, 50)}...`);
        
        const toastContainer = document.getElementById('toast-container');
        if (!toastContainer) {
            console.error("Toast container not found");
            return;
        }

        // Map roles to display names and IDs
        let toastId, displayName;
        if (role === 'user') {
            toastId = 'toast-agent';
            displayName = 'AGENT';
        } else if (role === 'assistant') {
            toastId = 'toast-customer';
            displayName = 'CUSTOMER';
        } else {
            // Skip system messages or other roles
            return;
        }

        // Check if toast already exists
        let toast = document.getElementById(toastId);
        
        if (!toast) {
            // Create new toast element
            toast = document.createElement('div');
            toast.id = toastId;
            toast.className = `toast ${role}`;

            // Add role label
            const roleLabel = document.createElement('div');
            roleLabel.className = 'toast-role';
            roleLabel.textContent = displayName;
            
            // Add message content
            const content = document.createElement('div');
            content.className = 'toast-content';
            content.textContent = message || "No content";

            toast.appendChild(roleLabel);
            toast.appendChild(content);

            // Add to container
            toastContainer.appendChild(toast);
            console.log(`[Toast] Created new ${displayName} toast`);
        } else {
            // Update existing toast content
            const content = toast.querySelector('.toast-content');
            if (content) {
                content.textContent = message || "No content";
                console.log(`[Toast] Updated ${displayName} toast content`);
                
                // Add update animation
                toast.classList.remove('toast-update');
                void toast.offsetWidth; // Trigger reflow
                toast.classList.add('toast-update');
            }
        }

        // Clear existing timeout for this toast
        if (this.toastTimers[toastId]) {
            clearTimeout(this.toastTimers[toastId]);
        }

        // Set new timeout to remove toast after 10 seconds
        this.toastTimers[toastId] = setTimeout(() => {
            if (toast && toast.parentNode) {
                toast.classList.add('toast-fadeout');
                setTimeout(() => {
                    toast.remove();
                    delete this.toastTimers[toastId];
                }, 300); // Wait for fade animation
            }
        }, 10000);
    }


    connect() {
        if (this.socket) {
            this.socket.close();
        }
        this.socket = new WebSocket(this.wsUrl);
        this.ws = this.socket; // Expose for external access
        this.setupSocketListeners();
    }

    setupSocketListeners() {
        this.socket.onopen = () => {
            console.log("WebSocket Connected");
            this.updateStatus("Connected", "connected");
            if (this.callbacks.onConnect) this.callbacks.onConnect();
            this.isProcessing = true;
            this.startSession();
            audioPlayer.start();
        };

        this.socket.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);
                this.handleMessage(data);
            } catch (e) {
                console.error("Error parsing message:", e, "Raw data:", JSON.stringify(event.data));
            }
        };

        this.socket.onerror = (error) => {
            console.error("WebSocket Error:", error);
            this.updateStatus("Connection error", "error");
            if (this.callbacks.onError) this.callbacks.onError();
            this.isProcessing = false;
        };

        this.socket.onclose = (event) => {
            console.log("WebSocket Disconnected", JSON.stringify(event));
            this.updateStatus("Disconnected", "disconnected");
            if (this.callbacks.onDisconnect) this.callbacks.onDisconnect();
            this.isProcessing = false;
            audioPlayer.stop();
            if (this.isProcessing) {
                console.log("Attempting to reconnect...");
                setTimeout(() => this.connect(), 1000);
            }
        };
    }

    async sendEvent(event) {
        if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
            console.error("WebSocket is not open. Current state:", this.socket?.readyState);
            return;
        }

        try {
            //console.log("Sending event:", JSON.stringify(event, null, 2));
            this.socket.send(JSON.stringify(event));
        } catch (error) {
            console.error("Error sending event:", error);
            this.updateStatus("Error sending message", "error");
        }
    }

    handleMessage(data) {
        if (!data.event) {
            console.error("Received message without event:", JSON.stringify(data));
            return;
        }

        const event = data.event;
        console.log("Event received");

        try {
            // Handle completionStart
            if (event.completionStart) {
                console.log("Completion start received:", JSON.stringify(event.completionStart));
                this.promptName = event.completionStart.promptName;
            }
            // Handle contentStart
            else if (event.contentStart) {
                console.log("Content start received:", JSON.stringify(event.contentStart));
                this.role = event.contentStart.role;
                if (event.contentStart.type === "AUDIO") {
                    this.currentAudioConfig = event.contentStart.audioOutputConfiguration;
                }
                if (event.contentStart.type === "TEXT") {
                    // Check for speculative content
                    let isSpeculative = false;
                    try {
                        if (event.contentStart.additionalModelFields) {
                            console.log("Additional model fields:", event.contentStart.additionalModelFields)
                            const additionalFields = JSON.parse(event.contentStart.additionalModelFields);
                            isSpeculative = additionalFields.generationStage === "SPECULATIVE";
                            if (isSpeculative) {
                                console.log("Received speculative content");
                                this.displayAssistantText = true;
                            }
                            else {
                                this.displayAssistantText = false;
                            }
                        }
                    } catch (e) {
                        console.error("Error parsing additionalModelFields:", e);
                    }
                }

            }
            // Handle textOutput
            else if (event.textOutput) {
                console.log("Text output received:", JSON.stringify(event.textOutput));
                const messageData = {
                    role: this.role,
                    content: event.textOutput.content
                };
                this.handleTextOutput(messageData);
            }
            // Handle audioOutput
            else if (event.audioOutput) {
                console.log("Audio output received");
                if (this.currentAudioConfig) {
                    audioPlayer.playAudio(this.base64ToFloat32Array(event.audioOutput.content));
                }
            }
            // Handle contentEnd
            else if (event.contentEnd) {
                console.log("Content end received:", JSON.stringify(event.contentEnd));
                switch (event.contentEnd.type) {
                    case "TEXT":
                        if (event.contentEnd.stopReason.toUpperCase() === "END_TURN") {
                            this.chatHistoryManager.endTurn();
                        }
                        else if (event.contentEnd.stopReason.toUpperCase() === "INTERRUPTED") {
                            audioPlayer.bargeIn();
                        }
                        break;
                    default:
                        console.log("Received content end for type:", JSON.stringify(event.contentEnd.type));
                }
            }
            // Handle completionEnd
            else if (event.completionEnd) {
                console.log("Completion end received:", JSON.stringify(event.completionEnd));
            }
            else {
                console.warn("Unknown event type received:", JSON.stringify(Object.keys(event)[0]));
            }
        } catch (error) {
            console.error("Error processing message:", error);
            console.error("Event data:", JSON.stringify(event));
        }
    }

    handleTextOutput(data) {
        console.log("Processing text output:", data);
        if (data.content) {
            const messageData = {
                role: data.role,
                message: data.content
            };
            this.chatHistoryManager.addTextMessage(messageData);
            
            // Track messages for sentiment feedback
            if (data.role === 'USER') {
                this.feedbackManager.setCustomerMessage(data.content);
            } else if (data.role === 'ASSISTANT') {
                this.feedbackManager.setAgentMessage(data.content);
            }
        }
    }

    base64ToFloat32Array(base64String) {
        const binaryString = window.atob(base64String);
        const bytes = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
            bytes[i] = binaryString.charCodeAt(i);
        }

        const int16Array = new Int16Array(bytes.buffer);
        const float32Array = new Float32Array(int16Array.length);
        for (let i = 0; i < int16Array.length; i++) {
            float32Array[i] = int16Array[i] / 32768.0;
        }

        return float32Array;
    }

    updateStatus(message, className) {
        // Update call status indicator instead of status div
        const statusIndicator = document.getElementById('call-status');
        if (statusIndicator) {
            statusIndicator.setAttribute('data-status', className);
        }
        console.log(`Status: ${message} (${className})`);
    }

    startSession() {
        console.log("Starting session...");
        const sessionStartEvent = {
            event: {
                sessionStart: {
                    inferenceConfiguration: {
                        maxTokens: 1024,
                        topP: 0.9,
                        temperature: 0.7
                    }
                }
            }
        };
        console.log("Sending session start:", JSON.stringify(sessionStartEvent, null, 2));
        this.sendEvent(sessionStartEvent);
        this.startPrompt();
    }

    startPrompt() {
        this.promptName = crypto.randomUUID();
        const getDefaultToolSchema = JSON.stringify({
            "type": "object",
            "properties": {},
            "required": []
        });

        const getWeatherToolSchema = JSON.stringify({
            "type": "object",
            "properties": {
                "latitude": {
                    "type": "string",
                    "description": "Geographical WGS84 latitude of the location."
                },
                "longitude": {
                    "type": "string",
                    "description": "Geographical WGS84 longitude of the location."
                }
            },
            "required": ["latitude", "longitude"]
        });

        const promptStartEvent = {
            event: {
                promptStart: {
                    promptName: this.promptName,
                    textOutputConfiguration: {
                        mediaType: "text/plain"
                    },
                    audioOutputConfiguration: {
                        mediaType: "audio/lpcm",
                        sampleRateHertz: 24000,
                        sampleSizeBits: 16,
                        channelCount: 1,
                        voiceId: "matthew",
                        encoding: "base64",
                        audioType: "SPEECH"
                    },
                    toolUseOutputConfiguration: {
                        mediaType: "application/json"
                    },
                    toolConfiguration: {
                        tools: [{
                            toolSpec: {
                                name: "getDateAndTimeTool",
                                description: "get information about the current date and current time",
                                inputSchema: {
                                    json: getDefaultToolSchema
                                }
                            }
                        },
                        {
                            toolSpec: {
                                name: "getWeatherTool",
                                description: "Get the current weather for a given location, based on its WGS84 coordinates.",
                                inputSchema: {
                                    json: getWeatherToolSchema
                                }
                            }
                        }
                        ]
                    }
                }
            }
        };
        this.sendEvent(promptStartEvent);
        this.sendSystemPrompt();
    }

    sendSystemPrompt() {
        const systemContentName = crypto.randomUUID();
        const contentStartEvent = {
            event: {
                contentStart: {
                    promptName: this.promptName,
                    contentName: systemContentName,
                    type: "TEXT",
                    role: "SYSTEM",
                    interactive: false,
                    textInputConfiguration: {
                        mediaType: "text/plain"
                    }
                }
            }
        };
        this.sendEvent(contentStartEvent);

        const textInputEvent = {
            event: {
                textInput: {
                    promptName: this.promptName,
                    contentName: systemContentName,
                    content: this.systemPromptFromTpod
                }
            }
        };
        this.sendEvent(textInputEvent);

        const contentEndEvent = {
            event: {
                contentEnd: {
                    promptName: this.promptName,
                    contentName: systemContentName
                }
            }
        };
        this.sendEvent(contentEndEvent);
        this.startAudioContent();
    }

    startAudioContent() {
        this.audioContentName = crypto.randomUUID();
        const contentStartEvent = {
            event: {
                contentStart: {
                    promptName: this.promptName,
                    contentName: this.audioContentName,
                    type: "AUDIO",
                    interactive: true,
                    role: "USER",
                    audioInputConfiguration: {
                        mediaType: "audio/lpcm",
                        sampleRateHertz: 16000,
                        sampleSizeBits: 16,
                        channelCount: 1,
                        audioType: "SPEECH",
                        encoding: "base64"
                    }
                }
            }
        };
        this.sendEvent(contentStartEvent);
    }

    sendAudioChunk(base64AudioData) {
        if (!this.promptName || !this.audioContentName) {
            console.error("Cannot send audio chunk - missing promptName or audioContentName");
            return;
        }

        const audioInputEvent = {
            event: {
                audioInput: {
                    promptName: this.promptName,
                    contentName: this.audioContentName,
                    content: base64AudioData
                }
            }
        };
        this.sendEvent(audioInputEvent);
    }

    endContent() {
        const contentEndEvent = {
            event: {
                contentEnd: {
                    promptName: this.promptName,
                    contentName: this.audioContentName
                }
            }
        };
        this.sendEvent(contentEndEvent);
    }

    endPrompt() {
        const promptEndEvent = {
            event: {
                promptEnd: {
                    promptName: this.promptName
                }
            }
        };
        this.sendEvent(promptEndEvent);
    }

    endSession() {
        const sessionEndEvent = {
            event: {
                sessionEnd: {}
            }
        };
        this.sendEvent(sessionEndEvent);
        this.socket.close();
    }

    cleanup() {
        this.isProcessing = false;
        if (this.socket && this.socket.readyState === WebSocket.OPEN) {
            try {
                if (this.audioContentName && this.promptName) {
                    this.endContent();
                    this.endPrompt();
                }
                this.endSession();
            } catch (error) {
                console.error("Error during cleanup:", error);
            }
        }
        this.chatHistoryManager.endConversation();
        this.feedbackManager.reset();
    }
}
