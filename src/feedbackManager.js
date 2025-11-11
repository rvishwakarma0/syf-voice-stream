import { SENTIMENT_FEEDBACK_API } from './urlConfig.js';

export class FeedbackManager {
    constructor() {
        this.lastCustomerMessage = '';
        this.lastAgentMessage = '';
        this.isProcessing = false;
        this.apiUrl = SENTIMENT_FEEDBACK_API;
    }

    // Called when customer speaks (ASSISTANT role from Nova Sonic) - just store it
    setCustomerMessage(message) {
        this.lastCustomerMessage = message;
        console.log('👤 Customer spoke, stored for next agent response:', message);
    }

    // Called when agent/trainee speaks (USER role from Nova Sonic) - triggers feedback analysis NOW
    async setAgentMessage(message) {
        this.lastAgentMessage = message;
        console.log('🎧 Agent spoke (YOU):', message);
        
        // Trigger API immediately - analyze YOUR response to previous customer message
        await this.fetchSentimentFeedback();
    }

    async fetchSentimentFeedback() {
        // Agent must have spoken (required), customer message is optional (agent might speak first)
        if (!this.lastAgentMessage) {
            console.warn('Agent message is required for feedback');
            return;
        }

        if (this.isProcessing) {
            console.log('Already processing feedback request');
            return;
        }

        this.isProcessing = true;
        this.showLoadingState();

        try {
            // Build request - only include customerMessage if it exists
            const requestBody = {
                agentMessage: this.lastAgentMessage
            };
            
            // Add customerMessage only if available (agent might speak first)
            if (this.lastCustomerMessage) {
                requestBody.customerMessage = this.lastCustomerMessage;
            }

            console.log('Calling sentiment API:', requestBody);

            const response = await fetch(this.apiUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(requestBody)
            });

            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            const data = await response.json();
            console.log('Sentiment feedback received:', data);

            if (data.success && data.sentiment) {
                this.updateFeedbackUI(data.sentiment);
                
                // DON'T clear customer message - it will be updated when customer speaks again
                // The current customer message was used for this analysis
                console.log('✅ Feedback processed for agent response');
            } else {
                this.showError(data.error || 'Failed to get feedback');
            }

        } catch (error) {
            console.error('Error fetching sentiment feedback:', error);
            this.showError('Network error - could not reach feedback API');
        } finally {
            this.isProcessing = false;
        }
    }

    showLoadingState() {
        const sentimentContent = document.getElementById('sentiment-content');
        const suggestionContent = document.getElementById('suggestion-content');

        if (sentimentContent) {
            sentimentContent.innerHTML = '<p class="placeholder-text">🔄 Analyzing...</p>';
        }

        if (suggestionContent) {
            suggestionContent.innerHTML = '<p class="placeholder-text">🔄 Generating suggestion...</p>';
        }
    }

    updateFeedbackUI(sentiment) {
        // Show update badge
        this.showUpdateBadge();
        
        // Show SOP card (was hidden initially)
        const sopBox = document.getElementById('sop-box');
        if (sopBox) {
            sopBox.style.display = 'block';
        }

        // Update sentiment analysis
        const sentimentContent = document.getElementById('sentiment-content');
        const sentimentBox = document.getElementById('sentiment-box');
        
        if (sentimentContent) {
            sentimentContent.innerHTML = `
                <div style="white-space: pre-wrap;">${sentiment.sentimentAnalysis}</div>
            `;
            
            // Add highlight animation
            sentimentBox.classList.add('updated');
            setTimeout(() => sentimentBox.classList.remove('updated'), 2000);
        }

        // Update suggestion
        const suggestionContent = document.getElementById('suggestion-content');
        const suggestionBox = document.getElementById('suggestion-box');
        
        if (suggestionContent) {
            // Parse suggestion to separate the explanation and the quote
            const suggestionText = sentiment.suggestion;
            const parts = suggestionText.split('Instead say:');
            
            let html = '';
            if (parts.length === 2) {
                html = `
                    <div>${parts[0].trim()}</div>
                    <div class="suggestion-label">✅ Instead say:</div>
                    <div class="suggestion-text">${parts[1].trim().replace(/['"]/g, '')}</div>
                `;
            } else {
                html = `<div>${suggestionText}</div>`;
            }
            
            suggestionContent.innerHTML = html;
            
            // Add highlight animation
            suggestionBox.classList.add('updated');
            setTimeout(() => suggestionBox.classList.remove('updated'), 2000);
        }

        console.log('Feedback UI updated successfully');
    }

    showUpdateBadge() {
        const badge = document.getElementById('update-badge');
        if (badge) {
            badge.classList.remove('hidden');
            
            // Auto-hide after 3 seconds
            setTimeout(() => {
                badge.classList.add('hidden');
            }, 3000);
        }
    }

    showError(message) {
        const sentimentContent = document.getElementById('sentiment-content');
        const suggestionContent = document.getElementById('suggestion-content');

        if (sentimentContent) {
            sentimentContent.innerHTML = `<p style="color: #ef5350;">❌ ${message}</p>`;
        }

        if (suggestionContent) {
            suggestionContent.innerHTML = `<p style="color: #ef5350;">Unable to generate suggestion</p>`;
        }
    }

    reset() {
        this.lastCustomerMessage = '';
        this.lastAgentMessage = '';
        this.isProcessing = false;
        
        const sentimentContent = document.getElementById('sentiment-content');
        const suggestionContent = document.getElementById('suggestion-content');
        const sopBox = document.getElementById('sop-box');

        if (sentimentContent) {
            sentimentContent.innerHTML = '<p class="placeholder-text">Speak to get feedback...</p>';
        }

        if (suggestionContent) {
            suggestionContent.innerHTML = '<p class="placeholder-text">Waiting for your response...</p>';
        }
        
        // Hide SOP box again
        if (sopBox) {
            sopBox.style.display = 'none';
        }
    }
}
