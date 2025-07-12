// Global Constants
const API_URL = 'https://zebi-bingo-webapp.netlify.app/api';

// Global Variables
let gameId = null;
let selectedNumber = null;
let currentBet = null;
let userId = (window.Telegram?.WebApp?.initDataUnsafe?.user?.id ||
              new URLSearchParams(window.location.search).get('user_id') ||
              'fallback_user_id')?.toString();

// Global Functions
function showPage(page) {
    console.log('Showing page:', page?.id);
    document.querySelectorAll('.content').forEach(p => {
        p.style.display = 'none';
        p.classList.remove('active');
    });
    if (page) {
        page.style.display = 'flex';
        page.classList.add('active');
    } else {
        console.error('Page is null');
        document.body.innerHTML = '<h1>Error: Page not found</h1>';
    }
}

function showErrorPage(message) {
    const errorPage = document.getElementById('errorPage');
    const errorMessage = document.getElementById('errorMessage');
    if (!errorPage || !errorMessage) {
        console.error('Error page elements not found!');
        document.body.innerHTML = `<h1 style="color:red">Error: ${message}</h1>`;
        return;
    }
    errorMessage.textContent = message;
    showPage(errorPage);
}

async function registerUser() {
    const phone = document.getElementById('phoneInput').value;
    const username = document.getElementById('usernameInput').value;
    const referralCode = document.getElementById('referralInput').value;
    const errorDiv = document.getElementById('registerError');

    if (!phone || !username) {
        errorDiv.textContent = 'ስልክ ቁጥር እና የተጠቃሚ ስም ያስፈልጋሉ!';
        return;
    }

    try {
        const response = await fetch(`${API_URL}/register`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ user_id: userId, phone, username, referral_code: referralCode })
        });
        const data = await response.json();
        if (data.status === 'success') {
            showPage(mainPage);
            updatePlayerInfo();
            checkAdminStatus();
        } else {
            errorDiv.textContent = data.reason || 'ምዝገባ አልተሳካም!';
        }
    } catch (error) {
        errorDiv.textContent = `አንድነት ችግር: ${error.message}`;
    }
}

async function checkRegistration() {
    console.log('Checking registration for userId:', userId);
    console.log('Telegram WebApp data:', tg?.initDataUnsafe);
    console.log('DOM elements:', {
        welcomePage: !!welcomePage,
        loadingPage: !!loadingPage,
        registerPage: !!registerPage,
        mainPage: !!mainPage,
        errorPage: !!errorPage
    });
    if (!welcomePage) {
        console.error('welcomePage is missing in DOM');
        document.body.innerHTML = '<h1>Error: Welcome page not found</h1>';
        return;
    }
    showPage(welcomePage);
    await new Promise(resolve => setTimeout(resolve, 500));
    if (!loadingPage) {
        console.error('loadingPage is missing in DOM');
        document.body.innerHTML = '<h1>Error: Loading page not found</h1>';
        return;
    }
    showPage(loadingPage);
    try {
        console.log('Fetching user data from:', `${API_URL}/user_data?user_id=${userId}`);
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 5000);
        const response = await fetch(`${API_URL}/user_data?user_id=${userId}`, { signal: controller.signal });
        clearTimeout(timeoutId);
        console.log('Response status:', response.status, 'Headers:', response.headers);
        if (!response.ok) {
            const text = await response.text();
            console.error('API error response:', text);
            throw new Error(`HTTP ${response.status}: ${text}`);
        }
        const data = await response.json();
        console.log('User data:', data);
        if (data.error || !data.registered) {
            if (!registerPage) {
                console.error('registerPage is missing in DOM');
                document.body.innerHTML = '<h1>Error: Register page not found</h1>';
                return;
            }
            showPage(registerPage);
        } else {
            if (!mainPage) {
                console.error('mainPage is missing in DOM');
                document.body.innerHTML = '<h1>Error: Main page not found</h1>';
                return;
            }
            showPage(mainPage);
            updatePlayerInfo();
            checkAdminStatus();
        }
    } catch (error) {
        console.error('Registration error:', error.message);
        showErrorPage(`Failed to check registration: ${error.message}`);
    } finally {
        if (loadingPage) {
            loadingPage.style.display = 'none';
        }
    }
}

async function checkAdminStatus() {
    try {
        const response = await fetch(`${API_URL}/user_data?user_id=${userId}`);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = await response.json();
        if (data.error) throw new Error(data.error);
        adminMenuBtn.style.display = data.role === 'admin' ? 'block' : 'none';
        createGameBtn.style.display = data.role === 'admin' ? 'block' : 'none';
    } catch (error) {
        console.error('Error checking admin status:', error);
        adminMenuBtn.style.display = 'none';
        createGameBtn.style.display = 'none';
    }
}

async function updatePlayerInfo() {
    try {
        const response = await fetch(`${API_URL}/user_data?user_id=${userId}`);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = await response.json();
        if (data.error) throw new Error(data.error);
        const username = data.username || `User_${userId}`;
        playerInfo.textContent = `👤 ${username} | 💰 ${data.wallet} ETB`;
        if (data.referral_bonus > 0) {
            alert(`🎉 You earned ${data.referral_bonus} ETB from referrals!`);
        }
    } catch (error) {
        console.error('Error updating player info:', error);
        playerInfo.textContent = `👤 User_${userId} | 💰 Error`;
    }
}

function generateBingoCard(cardNumbers) {
    if (!cardNumbers || cardNumbers.length !== 25) return;
    bingoCard.innerHTML = '';
    const letters = ['B', 'I', 'N', 'G', 'O'];
    for (let i = 0; i < 5; i++) {
        const letter = document.createElement('div');
        letter.className = 'letter';
        letter.textContent = letters[i];
        bingoCard.appendChild(letter);
    }
    for (let i = 0; i < 25; i++) {
        const cell = document.createElement('div');
        cell.className = 'cell';
        cell.textContent = cardNumbers[i];
        if (i === 12) cell.innerHTML = '<span class="star">★</span>';
        cell.onclick = () => cell.classList.toggle('marked');
        bingoCard.appendChild(cell);
    }
    bingoCard.style.gridTemplateColumns = 'repeat(5, 1fr)';
}

function updateCard(calledNumbers) {
    if (!calledNumbers) return;
    const cells = bingoCard.getElementsByClassName('cell');
    for (let cell of cells) {
        cell.classList.remove('marked');
        if (cell.textContent && calledNumbers.includes(parseInt(cell.textContent))) {
            cell.classList.add('marked');
        }
    }
}

function updateGameStatus() {
    if (!gameId) return;
    fetch(`${API_URL}/game_status?game_id=${gameId}&user_id=${userId}`)
        .then(response => response.json())
        .then(data => {
            if (data.status === 'not_found') {
                gameStatus.textContent = 'Game not found';
                return;
            }
            gameStatus.textContent = `Status: ${data.status} | ${data.start_time ? new Date(data.start_time).toLocaleString() : 'Not Started'} - ${data.end_time ? new Date(data.end_time).toLocaleString() : 'Not Ended'} | Prize: ${data.prize_amount} ETB | Called: ${data.numbers_called.length} | Winner: ${data.winner_id || 'None'} | Players: ${data.players.length}`;
            updateCard(data.numbers_called);
            calledNumbersDiv.textContent = `Called Numbers: ${data.numbers_called.join(', ') || 'None'}`;
            if (data.card_numbers && data.card_numbers.length) {
                generateBingoCard(data.card_numbers);
            }
            if (data.selected_numbers && data.selected_numbers.length) {
                const inactiveNumbers = document.getElementById('inactiveNumbers') || document.createElement('div');
                inactiveNumbers.id = 'inactiveNumbers';
                inactiveNumbers.innerHTML = data.selected_numbers.map(n => `<span class="inactive">${n}</span>`).join(', ');
                gameArea.appendChild(inactiveNumbers);
            }
            if (data.status === 'finished' && data.winner_id) {
                showPostWinOptions(data.bet_amount);
            }
        })
        .catch(error => {
            console.error('Error updating game status:', error);
            gameStatus.textContent = 'Error fetching game status';
        });
}

async function joinGame(betAmount) {
    try {
        const response = await fetch(`${API_URL}/join_game`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ user_id: userId, bet_amount: betAmount })
        });
        const data = await response.json();
        if (data.status === 'failed') throw new Error(data.reason);
        gameId = data.game_id;
        currentBet = data.bet_amount;
        contentDiv.style.display = 'none';
        gameArea.style.display = 'block';
        gameStatus.textContent = `Status: ${data.status} | Bet: ${data.bet_amount} ETB`;
        displayNumberSelector();
    } catch (error) {
        contentDiv.innerHTML = `<p>አንድነት ችግር: ${error.message}</p>`;
    }
}

function displayNumberSelector() {
    let html = '<div id="numberSelector" class="number-grid">';
    for (let i = 1; i <= 100; i++) {
        html += `<button class="number-btn" data-number="${i}">${i}</button>`;
    }
    html += '</div>';
    gameArea.innerHTML = html + gameArea.innerHTML;
}

function selectCardNumber(selectedNum) {
    selectedNumber = selectedNum;
    fetch(`${API_URL}/select_number`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: userId, game_id: gameId, selected_number: selectedNum })
    })
        .then(response => response.json())
        .then(data => {
            if (data.status === 'failed') {
                alert(data.reason);
                document.querySelector(`.number-btn[data-number="${selectedNum}"]`).disabled = true;
            } else {
                document.getElementById('numberSelector').style.display = 'none';
                const previewCard = document.createElement('div');
                previewCard.id = 'previewCard';
                for (let i = 0; i < 25; i++) {
                    const cell = document.createElement('div');
                    cell.className = 'cell';
                    cell.textContent = data.card_numbers[i];
                    if (i === 12) cell.innerHTML = '<span class="star">★</span>';
                    previewCard.appendChild(cell);
                }
                previewCard.style.gridTemplateColumns = 'repeat(5, 1fr)';
                gameArea.insertBefore(previewCard, bingoCard);
                const acceptBtn = document.createElement('button');
                acceptBtn.textContent = 'Accept';
                acceptBtn.className = 'action-btn';
                acceptBtn.id = 'acceptCardBtn';
                const cancelBtn = document.createElement('button');
                cancelBtn.textContent = 'Cancel';
                cancelBtn.className = 'action-btn';
                cancelBtn.id = 'cancelCardBtn';
                gameArea.appendChild(acceptBtn);
                gameArea.appendChild(cancelBtn);
            }
        });
}

function acceptCard() {
    fetch(`${API_URL}/accept_card`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: userId, game_id: gameId })
    })
        .then(response => response.json())
        .then(data => {
            if (data.status === 'accepted') {
                document.getElementById('previewCard').remove();
                document.querySelectorAll('#gameArea button:not(.action-btn)').forEach(btn => btn.remove());
                generateBingoCard(data.card_numbers);
                updateGameStatus();
                setInterval(updateGameStatus, 5000);
            }
        });
}

function cancelCard() {
    document.getElementById('previewCard').remove();
    document.querySelectorAll('#gameArea button:not(.action-btn)').forEach(btn => btn.remove());
    displayNumberSelector();
}

function showPostWinOptions(betAmount) {
    gameArea.innerHTML = `
        <div id="postWinMessage">${gameStatus.textContent}</div>
        <button class="action-btn" data-bet="${betAmount}">Continue Play</button>
        <button class="action-btn" id="backToBetSelectionBtn">Back to Bet Selection</button>
    `;
    gameId = null;
}

function continuePlay(betAmount) {
    gameId = null;
    currentBet = betAmount;
    contentDiv.style.display = 'none';
    gameArea.style.display = 'block';
    gameStatus.textContent = `Status: Waiting | Bet: ${betAmount} ETB`;
    displayNumberSelector();
}

function backToBetSelection() {
    gameId = null;
    currentBet = null;
    contentDiv.style.display = 'block';
    gameArea.style.display = 'none';
    contentDiv.innerHTML = `
        <h2>👥 ጨዋታ ይቀላቀሉ</h2>
        <button class="gameModeBtn" data-bet="10">10 ETB</button>
        <button class="gameModeBtn" data-bet="50">50 ETB</button>
        <button class="gameModeBtn" data-bet="100">100 ETB</button>
        <button class="gameModeBtn" data-bet="200">200 ETB</button>
    `;
}

function requestWithdrawal() {
    const amountInput = document.getElementById('withdrawAmount');
    const method = document.getElementById('withdrawMethod').value;
    const amount = parseInt(amountInput.value);
    const messageDiv = document.getElementById('withdrawMessage');

    if (!amount || amount < 100) {
        messageDiv.textContent = '❌ መጠን ቢያንስ 100 ETB መሆን አለበት!';
        return;
    }
    fetch(`${API_URL}/request_withdrawal`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: userId, amount, method })
    })
        .then(response => response.json())
        .then(data => {
            messageDiv.textContent = data.status === 'requested'
                ? `✅ ጥያቄዎ ተልኳል (ID: ${data.withdraw_id})`
                : `❌ ${data.reason}`;
            updatePlayerInfo();
        })
        .catch(error => {
            messageDiv.textContent = `አንድነት ችግር: ${error.message}`;
        });
}

async function promoteToAdmin() {
    const newAdminId = document.getElementById('newAdminId').value;
    if (!newAdminId) {
        alert('እባክዎ የተጠቃሚ ID ያስገቡ');
        return;
    }
    try {
        const response = await fetch(`${API_URL}/add_admin`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ user_id: userId, target_user_id: newAdminId })
        });
        const data = await response.json();
        alert(data.status === 'success'
            ? `User ${newAdminId} promoted to admin successfully!`
            : `Error: ${data.reason || 'Failed to promote user'}`);
    } catch (error) {
        alert(`አንድነት ችግር: ${error.message}`);
    }
}

async function createGame() {
    const betAmount = parseInt(document.getElementById('betAmount').value);
    try {
        const response = await fetch(`${API_URL}/create_game`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ user_id: userId, bet_amount: betAmount })
        });
        const data = await response.json();
        if (data.status === 'failed') throw new Error(data.reason);
        gameId = data.game_id;
        currentBet = data.bet_amount;
        contentDiv.style.display = 'none';
        gameArea.style.display = 'block';
        gameStatus.textContent = `Status: ${data.status} | Bet: ${data.bet_amount} ETB`;
        alert(`Game ${gameId} created with ${betAmount} ETB bet!`);
    } catch (error) {
        alert(`Error: ${error.message}`);
    }
}

async function adminAction(action) {
    const txId = document.getElementById('txId')?.value;
    let payload = { user_id: userId, action };
    if (action === 'verify_payment') payload.tx_id = txId;

    try {
        const response = await fetch(`${API_URL}/admin_actions`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        const data = await response.json();
        contentDiv.innerHTML = `<p>${data.status === 'verified' ? `✅ ${data.amount} ETB ለ${data.user_id} ተጠበቃ!` : `✅ ${data.status}!`}</p>`;
        updatePlayerInfo();
    } catch (error) {
        contentDiv.innerHTML = `<p>አንድነት ችግር: ${error.message}</p>`;
    }
}

function manageWithdrawal(withdrawId, actionType) {
    const adminNote = document.getElementById(`note_${withdrawId}`).value;
    fetch(`${API_URL}/admin_actions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: userId, action: 'manage_withdrawal', withdraw_id: withdrawId, action_type: actionType, admin_note: adminNote })
    })
        .then(response => response.json())
        .then(data => {
            contentDiv.innerHTML = `<p>${data.status === 'approved' ? `✅ ${data.amount} ETB withdrawn for User ${data.user_id}` : `❌ ${data.status}`}</p>`;
            adminMenuBtn.click();
            updatePlayerInfo();
        })
        .catch(error => {
            contentDiv.innerHTML = `<p>አንድነት ችግር: ${error.message}</p>`;
        });
}

// DOM Initialization
document.addEventListener('DOMContentLoaded', function() {
    console.log('script.js loaded');

    // Telegram WebApp Setup
    const tg = window.Telegram?.WebApp;
    if (tg) {
        try {
            tg.expand();
            if (typeof tg.enableClosingConfirmation === 'function') {
                tg.enableClosingConfirmation();
            }
            tg.onEvent('web_app_request_content_safe_area', (data) => {
                console.log('Safe area data:', data);
                const app = document.getElementById('app');
                if (app && data.safeAreaTop) app.style.paddingTop = `${data.safeAreaTop}px`;
                if (app && data.safeAreaBottom) app.style.paddingBottom = `${data.safeAreaBottom}px`;
            });
        } catch (e) {
            console.warn("Telegram feature error:", e);
        }
    }

    // DOM Elements
    const welcomePage = document.getElementById('welcomePage');
    const loadingPage = document.getElementById('loadingPage');
    const errorPage = document.getElementById('errorPage');
    const errorMessage = document.getElementById('errorMessage');
    const registerPage = document.getElementById('registerPage');
    const mainPage = document.getElementById('mainPage');
    const gameArea = document.getElementById('gameArea');
    const playerInfo = document.getElementById('playerInfo');
    const startBtn = document.getElementById('startBtn');
    const registerBtn = document.getElementById('registerBtn');
    const registerError = document.getElementById('registerError');
    const joinBtn = document.getElementById('joinBtn');
    const bingoCard = document.getElementById('bingoCard');
    const calledNumbersDiv = document.getElementById('calledNumbers');
    const gameStatus = document.getElementById('gameStatus');
    const callBtn = document.getElementById('callBtn');
    const bingoBtn = document.getElementById('bingoBtn');
    const contentDiv = document.getElementById('content');
    const checkBalanceBtn = document.getElementById('checkBalance');
    const withdrawMoneyBtn = document.getElementById('withdrawMoney');
    const topLeadersBtn = document.getElementById('topLeaders');
    const inviteFriendsBtn = document.getElementById('inviteFriends');
    const returnBtn = document.getElementById('returnBtn');
    const nightModeSwitch = document.getElementById('nightModeSwitch');
    const adminMenuBtn = document.getElementById('adminMenuBtn');
    const createGameBtn = document.getElementById('createGameBtn');
    const devInfo = document.getElementById('devInfo');
    const retryBtn = document.getElementById('retryBtn');
    const returnToBotBtn = document.getElementById('returnToBotBtn');

    // User ID
    const userId = (tg?.initDataUnsafe?.user?.id ||
                    new URLSearchParams(window.location.search).get('user_id'))?.toString();
    if (!userId) {
        showErrorPage('User ID is missing. Please open this from the Telegram bot.');
        return;
    }

    // Event Listeners
    if (startBtn) {
        startBtn.addEventListener('click', () => showPage(registerPage));
    }

    if (registerBtn) {
        registerBtn.addEventListener('click', registerUser);
    }

    if (joinBtn) {
        joinBtn.addEventListener('click', () => {
            contentDiv.style.display = 'block';
            gameArea.style.display = 'none';
            contentDiv.innerHTML = `
                <h2>👥 ጨዋታ ይቀላቀሉ</h2>
                <button class="gameModeBtn" data-bet="10">10 ETB</button>
                <button class="gameModeBtn" data-bet="50">50 ETB</button>
                <button class="gameModeBtn" data-bet="100">100 ETB</button>
                <button class="gameModeBtn" data-bet="200">200 ETB</button>
            `;
            attachGameModeListeners();
        });
    }

    if (callBtn) {
        callBtn.addEventListener('click', async () => {
            if (!gameId) return;
            try {
                const response = await fetch(`${API_URL}/call_number`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ user_id: userId, game_id: gameId })
                });
                const data = await response.json();
                gameStatus.textContent = `Called: ${data.number} | Remaining: ${data.remaining}`;
                updateCard(data.called_numbers);
                updatePlayerInfo();
            } catch (error) {
                gameStatus.textContent = `Error: ${error.message}`;
            }
        });
    }

    if (bingoBtn) {
        bingoBtn.addEventListener('click', async () => {
            if (!gameId) return;
            try {
                const response = await fetch(`${API_URL}/check_bingo`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ user_id: userId, game_id: gameId })
                });
                const data = await response.json();
                gameStatus.textContent = data.message;
                if (data.kicked) {
                    alert('❌ Invalid Bingo! You have been removed from this game.');
                    backToBetSelection();
                } else if (data.won) {
                    alert(data.message);
                    updateGameStatus();
                }
                updatePlayerInfo();
            } catch (error) {
                gameStatus.textContent = `Error: ${error.message}`;
            }
        });
    }

    if (checkBalanceBtn) {
        checkBalanceBtn.addEventListener('click', async () => {
            contentDiv.style.display = 'block';
            gameArea.style.display = 'none';
            try {
                const response = await fetch(`${API_URL}/user_data?user_id=${userId}`);
                if (!response.ok) throw new Error(`HTTP ${response.status}`);
                const data = await response.json();
                if (data.error) throw new Error(data.error);
                contentDiv.innerHTML = `
                    <h2>💰 የዋሌት ገጽ</h2>
                    <p>ዋሌት: ${data.wallet} ETB</p>
                    <p>ያሸነፉት ጨዋታ: ${data.wins} ETB</p>
                    <p>የተሳሳተ ቢንጎ: ${data.invalid_bingo_count}</p>
                `;
                updatePlayerInfo();
            } catch (error) {
                contentDiv.innerHTML = `<p>አንድነት ችግር: ${error.message}</p>`;
            }
        });
    }

    if (withdrawMoneyBtn) {
        withdrawMoneyBtn.addEventListener('click', async () => {
            contentDiv.style.display = 'block';
            gameArea.style.display = 'none';
            try {
                const response = await fetch(`${API_URL}/user_data?user_id=${userId}`);
                if (!response.ok) throw new Error(`HTTP ${response.status}`);
                const data = await response.json();
                if (data.error) throw new Error(data.error);
                contentDiv.innerHTML = `
                    <h2>💸 ገንዘብ ለማውጣት</h2>
                    <input id="withdrawAmount" type="number" placeholder="መጠን (ETB)" min="100" />
                    <select id="withdrawMethod">
                        <option value="telebirr">Telebirr</option>
                        <option value="cbe">CBE</option>
                    </select>
                    <button id="requestWithdrawalBtn" class="action-btn">📤 ጠይቅ</button>
                    <p id="withdrawMessage"></p>
                `;
                document.getElementById('requestWithdrawalBtn').addEventListener('click', requestWithdrawal);
                updatePlayerInfo();
            } catch (error) {
                contentDiv.innerHTML = `<p>አንድነት ችግር: ${error.message}</p>`;
            }
        });
    }

    if (topLeadersBtn) {
        topLeadersBtn.addEventListener('click', async () => {
            contentDiv.style.display = 'block';
            gameArea.style.display = 'none';
            try {
                const response = await fetch(`${API_URL}/leaderboard`);
                if (!response.ok) throw new Error(`HTTP ${response.status}`);
                const data = await response.json();
                let tableHtml = `
                    <h2>🏆 የመሪዎች ዝርዝር</h2>
                    <table class="leaderboard-table">
                        <tr><th>ቦታ</th><th>ስም</th><th>ነጥብ</th><th>ዋሌት (ETB)</th></tr>
                `;
                data.leaders.forEach((user, index) => {
                    tableHtml += `
                        <tr><td>${index + 1}</td><td>${user.username}</td><td>${user.score}</td><td>${user.wallet}</td></tr>
                    `;
                });
                tableHtml += '</table>';
                contentDiv.innerHTML = tableHtml;
                updatePlayerInfo();
            } catch (error) {
                contentDiv.innerHTML = `<p>አንድነት ችግር: ${error.message}</p>`;
            }
        });
    }

    if (inviteFriendsBtn) {
        inviteFriendsBtn.addEventListener('click', async () => {
            contentDiv.style.display = 'block';
            gameArea.style.display = 'none';
            try {
                const response = await fetch(`${API_URL}/invite_data?user_id=${userId}`);
                if (!response.ok) throw new Error(`HTTP ${response.status}`);
                const data = await response.json();
                if (data.error) throw new Error(data.error);
                contentDiv.innerHTML = `
                    <h2>👥 ጓደኞችን ጋብዝ</h2>
                    <p>ሪፈራል ሊንክ: <a href="${data.referral_link}" target="_blank">${data.referral_link}</a></p>
                    <p>የጋበዙት ጓደኞች: ${data.referral_count}</p>
                    <p>20 ጓደኞችን በመጋበዝ 10 ETB ያግኙ!</p>
                `;
                updatePlayerInfo();
            } catch (error) {
                contentDiv.innerHTML = `<p>አንድነት ችግር: ${error.message}</p>`;
            }
        });
    }

    if (returnBtn) {
        returnBtn.addEventListener('click', () => {
            if (tg) tg.close();
            else showPage(mainPage);
        });
    }

    if (retryBtn) {
        retryBtn.addEventListener('click', checkRegistration);
    }

    if (returnToBotBtn) {
        returnToBotBtn.addEventListener('click', () => {
            if (tg) tg.close();
            else window.location.href = 'https://t.me/ZebiBingoBot';
        });
    }

    if (adminMenuBtn) {
        adminMenuBtn.addEventListener('click', async () => {
            try {
                const response = await fetch(`${API_URL}/user_data?user_id=${userId}`);
                const data = await response.json();
                if (data.error || data.role !== 'admin') {
                    contentDiv.style.display = 'block';
                    gameArea.style.display = 'none';
                    contentDiv.innerHTML = '<p>አስተዳዳሪነት አልተፈቀደም!</p>';
                    return;
                }
                const withdrawalsResponse = await fetch(`${API_URL}/pending_withdrawals?user_id=${userId}`);
                const withdrawalsData = await withdrawalsResponse.json();
                contentDiv.style.display = 'block';
                gameArea.style.display = 'none';
                contentDiv.innerHTML = `
                    <h2>🛠 አስተዳዳሪ ገጽ</h2>
                    <div class="admin-form">
                        <h3>አዲስ አስተዳዳሪ ለመጨመር</h3>
                        <input id="newAdminId" placeholder="የተጠቃሚ ID" />
                        <button id="promoteAdminBtn" class="action-btn">👑 አስተዳዳሪ አድርግ</button>
                        <h3>ጨዋታ ለመፍጠር</h3>
                        <select id="betAmount">
                            <option value="10">10 ETB</option>
                            <option value="50">50 ETB</option>
                            <option value="100">100 ETB</option>
                            <option value="200">200 ETB</option>
                        </select>
                        <button id="createAdminGameBtn" class="action-btn">🎮 ጨዋታ ፍጠር</button>
                        <h3>የፋይናንስ ማረጋገጫ</h3>
                        <input id="txId" placeholder="የፋይናንስ መረጃ ID" />
                        <button id="verifyPaymentBtn" class="action-btn">✅ የፋይናንስ ማረጋገጫ</button>
                        <h3>Pending Withdrawals</h3>
                        ${withdrawalsData.withdrawals.map(w => `
                            <div>
                                ID: ${w.withdraw_id} | User: ${w.user_id} | Amount: ${w.amount} ETB | Method: ${w.method} | Time: ${new Date(w.request_time).toLocaleString()}
                                <input id="note_${w.withdraw_id}" placeholder="Note" />
                                <button class="manageWithdrawalBtn" data-withdraw-id="${w.withdraw_id}" data-action="approve">✅ Approve</button>
                                <button class="manageWithdrawalBtn" data-withdraw-id="${w.withdraw_id}" data-action="reject">❌ Reject</button>
                            </div>
                        `).join('')}
                    </div>
                `;
                document.getElementById('promoteAdminBtn').addEventListener('click', promoteToAdmin);
                document.getElementById('createAdminGameBtn').addEventListener('click', createGame);
                document.getElementById('verifyPaymentBtn').addEventListener('click', () => adminAction('verify_payment'));
                document.querySelectorAll('.manageWithdrawalBtn').forEach(btn => {
                    btn.addEventListener('click', () => {
                        const withdrawId = btn.dataset.withdrawId;
                        const actionType = btn.dataset.action;
                        manageWithdrawal(withdrawId, actionType);
                    });
                });
                updatePlayerInfo();
            } catch (error) {
                contentDiv.innerHTML = `<p>አንድነት ችግር: ${error.message}</p>`;
            }
        });
    }

    if (createGameBtn) {
        createGameBtn.addEventListener('click', async () => {
            const betAmount = parseInt(document.getElementById('betAmount')?.value || '10');
            try {
                const response = await fetch(`${API_URL}/create_game`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ user_id: userId, bet_amount: betAmount })
                });
                const data = await response.json();
                if (data.status === 'failed') throw new Error(data.reason);
                gameId = data.game_id;
                currentBet = data.bet_amount;
                contentDiv.style.display = 'none';
                gameArea.style.display = 'block';
                gameStatus.textContent = `Status: ${data.status} | Bet: ${data.bet_amount} ETB`;
                alert(`Game ${gameId} created with ${betAmount} ETB bet!`);
            } catch (error) {
                alert(`Error: ${error.message}`);
            }
        });
    }

    // Attach listeners to .gameModeBtn dynamically
    function attachGameModeListeners() {
        document.querySelectorAll('.gameModeBtn').forEach(btn => {
            btn.addEventListener('click', () => {
                const betAmount = parseInt(btn.dataset.bet);
                joinGame(betAmount);
            });
        });
    }

    // Number selector listeners
    document.addEventListener('click', (e) => {
        if (e.target.classList.contains('number-btn')) {
            const selectedNum = parseInt(e.target.dataset.number);
            selectCardNumber(selectedNum);
        }
    });

    // Post-win options listeners
    document.addEventListener('click', (e) => {
        if (e.target.textContent === 'Continue Play') {
            const betAmount = parseInt(e.target.dataset.bet);
            continuePlay(betAmount);
        } else if (e.target.id === 'backToBetSelectionBtn') {
            backToBetSelection();
        }
    });

    // Accept/Cancel card listeners
    document.addEventListener('click', (e) => {
        if (e.target.id === 'acceptCardBtn') {
            acceptCard();
        } else if (e.target.id === 'cancelCardBtn') {
            cancelCard();
        }
    });

    // Night Mode Toggle
    if (nightModeSwitch) {
        nightModeSwitch.addEventListener('change', () => {
            const isNightMode = nightModeSwitch.checked;
            document.body.classList.toggle('night-mode', isNightMode);
            document.getElementById('app').classList.toggle('night-mode', isNightMode);
            localStorage.setItem('nightMode', isNightMode);
        });

        const savedNightMode = localStorage.getItem('nightMode') === 'true';
        if (savedNightMode) {
            nightModeSwitch.checked = true;
            document.body.classList.add('night-mode');
            document.getElementById('app').classList.add('night-mode');
        }
    }

    // Interactive Developer Info
    let isHovering = false;
    let isClicked = false;

    if (devInfo) {
        devInfo.addEventListener('mouseover', () => {
            if (!isClicked) {
                devInfo.textContent = '0913252238';
                isHovering = true;
            }
        });

        devInfo.addEventListener('mouseout', () => {
            if (!isClicked && isHovering) {
                devInfo.textContent = 'Developed by Benzion Creatives 2025';
                isHovering = false;
            }
        });

        devInfo.addEventListener('click', () => {
            if (!isClicked) {
                devInfo.textContent = '0913252238';
                isClicked = true;
            } else {
                devInfo.textContent = 'Developed by Benzion Creatives 2025';
                isClicked = false;
            }
        });
    }

    // Initialize
    checkRegistration();
    updatePlayerInfo();
});
