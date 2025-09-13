import AudioPlayer from "./lib/play/AudioPlayer";
import ChatHistoryManager from "./lib/util/ChatHistoryManager.js";

const audioPlayer = new AudioPlayer();

export class WebSocketEventManager {
    constructor(wsUrl) {
    const urlParams = new URLSearchParams(window.location.search);
        this.data = urlParams.get('data');
        console.log('data:', this.data);
        this.wsUrl = wsUrl;
        this.promptName = null;
        this.audioContentName = null;
        this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
        this.currentAudioConfig = null;
        this.isProcessing = false;
        this.displayAssistantText = false;
        this.role = null;
        this.chat = { history: [] };
        this.chatRef = { current: this.chat };

        this.chatHistoryManager = ChatHistoryManager.getInstance(
            this.chatRef,
            (newChat) => {
                this.chat = { ...newChat };
                this.chatRef.current = this.chat;
                this.updateChatUI();
            }
        );

        this.connect();
    }

    updateChatUI() {
        const chatContainer = document.getElementById('chat-container');
        if (!chatContainer) {
            console.error("Chat container not found");
            return;
        }

        // Clear existing chat messages
        chatContainer.innerHTML = '';

        // Add all messages from history
        this.chat.history.forEach(item => {
            if (item.endOfConversation) {
                const endDiv = document.createElement('div');
                endDiv.className = 'message system';
                endDiv.textContent = "Conversation ended";
                chatContainer.appendChild(endDiv);
                return;
            }

            if (item.role) {
                const messageDiv = document.createElement('div');
                const roleLowerCase = item.role.toLowerCase();
                messageDiv.className = `message ${roleLowerCase}`;

                const roleLabel = document.createElement('div');
                roleLabel.className = 'role-label';
                roleLabel.textContent = item.role;
                messageDiv.appendChild(roleLabel);

                const content = document.createElement('div');
                content.textContent = item.message || "No content";
                messageDiv.appendChild(content);

                chatContainer.appendChild(messageDiv);
            }
        });
        chatContainer.scrollTop = chatContainer.scrollHeight;
    }


    connect() {
        if (this.socket) {
            this.socket.close();
        }
        this.socket = new WebSocket(this.wsUrl);
        this.setupSocketListeners();
    }

    setupSocketListeners() {
        this.socket.onopen = () => {
            console.log("WebSocket Connected");
            this.updateStatus("Connected", "connected");
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
            this.isProcessing = false;
        };

        this.socket.onclose = (event) => {
            console.log("WebSocket Disconnected", JSON.stringify(event));
            this.updateStatus("Disconnected", "disconnected");
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
                    role: this.role
                };
                if (messageData.role === "USER" || (messageData.role === "ASSISTANT" && this.displayAssistantText)) {
                    messageData.content = event.textOutput.content;
                }
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
        const statusDiv = document.getElementById('status');
        if (statusDiv) {
            statusDiv.textContent = message;
            statusDiv.className = `status ${className}`;
        }
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

        const systemPrompt = "You are a friend. The user and you will engage in a spoken " +
            "dialog exchanging the transcripts of a natural real-time conversation. Keep your responses short, " +
            "generally two or three sentences for chatty scenarios.";

        const textInputEvent = {
            event: {
                textInput: {
                    promptName: this.promptName,
                    contentName: systemContentName,
                    content: systemPrompt
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
    }
}
