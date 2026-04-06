export function initChat(socket) {
    const chatContainer = document.getElementById('chat-container');
    const chatMessages = document.getElementById('chat-messages');
    const chatInput = document.getElementById('chat-input');
    
    const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent) || (navigator.maxTouchPoints > 0);

    if (isMobile && chatContainer) {
        chatContainer.style.transform = "scale(0.9)";
        chatContainer.style.transformOrigin = "bottom left";
        chatContainer.style.bottom = "120px";
        chatContainer.style.zIndex = "3000";
        chatContainer.style.pointerEvents = "none"; 
    }

    if (chatInput) {
        chatInput.style.pointerEvents = "auto";
        let sendBtn = document.getElementById('chat-send-btn');
        if (!sendBtn) {
            sendBtn = document.createElement('button');
            sendBtn.id = 'chat-send-btn';
            sendBtn.innerHTML = "➤";
            sendBtn.style = `
                margin-left: 5px;
                padding: 10px;
                background: gold;
                border: none;
                border-radius: 5px;
                font-size: 18px;
                color: black;
                pointer-events: auto;
                cursor: pointer;
            `;
            
            chatInput.parentElement.style.display = "flex";
            chatInput.parentElement.style.pointerEvents = "auto"; 
            chatInput.parentElement.appendChild(sendBtn);

            const handleAction = (e) => {
                e.preventDefault();
                e.stopPropagation(); 
                sendMessage();
            };
            
            sendBtn.addEventListener('pointerdown', handleAction);
        }
    }

    function sendMessage() {
        const msg = chatInput.value.trim();
        if (msg) {
            if (socket && socket.connected) {
                // We ONLY emit. We don't addMessage here because 
                // the server will send it back to us anyway.
                socket.emit('chatMessage', msg);
                chatInput.value = '';
            } else {
                addMessage("System: Connection lost...", "red");
            }
            
            if (isMobile) {
                chatInput.blur(); 
            }
        }
    }

    function addMessage(text, color = 'white') {
        const div = document.createElement('div');
        div.style.color = color;
        div.style.padding = '2px 0';
        div.style.fontSize = '14px';
        div.style.textShadow = "1px 1px 1px black";
        div.style.wordBreak = "break-all";
        div.innerText = text;
        chatMessages.appendChild(div);
        
        requestAnimationFrame(() => {
            chatMessages.scrollTop = chatMessages.scrollHeight;
        });
    }

    // --- THE FIX IS HERE ---
    socket.off('chatMessage');
    socket.on('chatMessage', (data) => {
        // 1. Extract data correctly from the server object
        const messageText = data.message;
        const senderId = data.id;
        const senderName = data.name || `Guest_${senderId.substring(0, 4)}`;

        // 2. Decide how to display in the UI
        if (senderId === socket.id) {
            addMessage(`You: ${messageText}`, '#fbff00'); // Yellow for you
        } else {
            addMessage(`${senderName}: ${messageText}`, 'white'); // White for others
        }

        // 3. TRIGGER 3D BUBBLE (This talks to your main.js!)
        window.dispatchEvent(new CustomEvent('show3DBubble', { 
            detail: { id: senderId, message: messageText } 
        }));
    });

    chatInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            sendMessage();
        }
    });
}