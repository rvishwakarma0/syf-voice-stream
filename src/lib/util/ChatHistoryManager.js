class ChatHistoryManager {
    static instance = null;

    constructor(chatRef, setChat) {
        if (ChatHistoryManager.instance) {
            return ChatHistoryManager.instance;
        }

        this.chatRef = chatRef;
        this.setChat = setChat;
        ChatHistoryManager.instance = this;
    }

    static getInstance(chatRef, setChat) {
        if (!ChatHistoryManager.instance) {
            ChatHistoryManager.instance = new ChatHistoryManager(chatRef, setChat);
        } else if (chatRef && setChat) {
            // Update references if they're provided
            ChatHistoryManager.instance.chatRef = chatRef;
            ChatHistoryManager.instance.setChat = setChat;
        }
        return ChatHistoryManager.instance;
    }

    addTextMessage(content) {
        if (!this.chatRef || !this.setChat) {
            console.error("ChatHistoryManager: chatRef or setChat is not initialized");
            return;
        } 
        if(content.role === 'USER') {
            content.role = 'Agent';
        }else{
            content.role = 'Customer';
        }
        let history = this.chatRef.current?.history || [];
        let updatedChatHistory = [...history];
        let lastTurn = updatedChatHistory[updatedChatHistory.length - 1];

        console.log(
            "[ChatHistoryManager] addTextMessage in:",
            { incomingRole: content.role, prevLength: updatedChatHistory.length, lastRole: lastTurn?.role, lastEnded: lastTurn?.endOfResponse }
        );

        if (
            lastTurn !== undefined &&
            lastTurn.role === content.role &&
            lastTurn.endOfResponse !== true
        ) {
            updatedChatHistory[updatedChatHistory.length - 1] = {
                ...lastTurn,
                message: lastTurn.message + " " + content.message
            };
        }
        else {
            
            updatedChatHistory.push({
                role: content.role,
                message: content.message,
                mid: crypto.randomUUID()
            });
        }

        this.setChat({
            history: updatedChatHistory
        });

        console.log("Updated chat history 1234:", updatedChatHistory);
        window.parent.postMessage({
            type: 'chatHistory',
            data: JSON.stringify(updatedChatHistory)
          }, '*');
    }

    endTurn() {
        if (!this.chatRef || !this.setChat) {
            console.error("ChatHistoryManager: chatRef or setChat is not initialized");
            return;
        }

        let history = this.chatRef.current?.history || [];
        let updatedChatHistory = [...history];
        if (updatedChatHistory.length > 0) {
            console.log("[ChatHistoryManager] endTurn before:", { length: updatedChatHistory.length, lastRole: updatedChatHistory[updatedChatHistory.length - 1].role });
            const i = updatedChatHistory.length - 1;
            updatedChatHistory[i] = {
                ...updatedChatHistory[i],
                endOfResponse: true
            };
            console.log("[ChatHistoryManager] endTurn after mark:", { length: updatedChatHistory.length });
        }

        this.setChat({
            history: updatedChatHistory
        });
    }

    endConversation() {
        if (!this.chatRef || !this.setChat) {
            console.error("ChatHistoryManager: chatRef or setChat is not initialized");
            return;
        }

        let history = this.chatRef.current?.history || [];
        let updatedChatHistory = history.map(item => {
            return {
                ...item,
                endOfResponse: true
            };
        });

        updatedChatHistory.push({
            endOfConversation: true
        });

        this.setChat({
            history: updatedChatHistory
        });
    }
}

export default ChatHistoryManager;