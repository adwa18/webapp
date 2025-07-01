from flask import Flask, request, jsonify
import logging
from logging.handlers import RotatingFileHandler
import psycopg2
from psycopg2 import pool
import os
import random
import string
from datetime import datetime, timedelta
import json

# Configuration
TOKEN = os.environ.get("TOKEN")
WEB_APP_URL = os.environ.get("WEB_APP_URL", "https://your-github-username.github.io/zebi-bingo-web")
ADMIN_IDS = [int(x) for x in os.environ.get("ADMIN_IDS", "").split(',') if x]
DATABASE_URL = os.environ.get("DATABASE_URL")
INITIAL_WALLET = 10
BET_OPTIONS = [10, 50, 100, 200]
HOUSE_CUT = 0.02
MINIMUM_WITHDRAWAL = 100
MINIMUM_DEPOSIT = 50

# Initialize Flask app
app = Flask(__name__)

# Initialize logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger('api')

# Database connection pool
db_pool = None

def get_db_connection():
    global db_pool
    if db_pool is None:
        db_pool = psycopg2.pool.SimpleConnectionPool(1, 10, DATABASE_URL)
    return db_pool.getconn()

def release_db_connection(conn):
    if db_pool is not None:
        db_pool.putconn(conn)

def init_db():
    conn = get_db_connection()
    try:
        with conn.cursor() as cursor:
            cursor.execute('''
                CREATE TABLE IF NOT EXISTS users (
                    user_id BIGINT PRIMARY KEY,
                    phone TEXT,
                    username TEXT UNIQUE,
                    name TEXT,
                    wallet INTEGER DEFAULT %s,
                    score INTEGER DEFAULT 0,
                    referral_code TEXT UNIQUE,
                    referred_by TEXT,
                    registration_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    role TEXT DEFAULT 'user',
                    invalid_bingo_count INTEGER DEFAULT 0
                )
            ''', (INITIAL_WALLET,))
            
            cursor.execute('''
                CREATE TABLE IF NOT EXISTS games (
                    game_id TEXT PRIMARY KEY,
                    players TEXT DEFAULT '',
                    numbers_called TEXT DEFAULT '',
                    status TEXT DEFAULT 'waiting',
                    start_time TIMESTAMP,
                    end_time TIMESTAMP,
                    winner_id BIGINT,
                    prize_amount INTEGER DEFAULT 0,
                    bet_amount INTEGER DEFAULT 0
                )
            ''')
            
            cursor.execute('''
                CREATE TABLE IF NOT EXISTS player_cards (
                    card_id SERIAL PRIMARY KEY,
                    game_id TEXT,
                    user_id BIGINT,
                    card_numbers TEXT,
                    card_accepted BOOLEAN DEFAULT FALSE
                )
            ''')
            
            cursor.execute('''
                CREATE TABLE IF NOT EXISTS transactions (
                    tx_id TEXT PRIMARY KEY,
                    user_id BIGINT,
                    amount INTEGER,
                    method TEXT,
                    status TEXT DEFAULT 'pending',
                    verification_code TEXT,
                    timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            ''')
            
            cursor.execute('''
                CREATE TABLE IF NOT EXISTS withdrawals (
                    withdraw_id TEXT PRIMARY KEY,
                    user_id BIGINT,
                    amount INTEGER,
                    status TEXT DEFAULT 'pending',
                    request_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    method TEXT,
                    admin_note TEXT
                )
            ''')
            
            conn.commit()
    except Exception as e:
        logger.error(f"Error initializing database: {str(e)}")
        raise
    finally:
        release_db_connection(conn)

# Helper functions
def generate_referral_code(user_id):
    import hashlib
    return hashlib.md5(str(user_id).encode()).hexdigest()[:8]

def generate_tx_id(user_id):
    return f"TX{user_id}{''.join(random.choices(string.ascii_uppercase + string.digits, k=6))}"

def generate_withdraw_id(user_id):
    return f"WD{user_id}{random.randint(1000, 9999)}"

def generate_game_id():
    return f"G{random.randint(10000, 99999)}"

def generate_card_numbers():
    numbers = random.sample(range(1, 101), 25)
    return ','.join(map(str, numbers))

# API Endpoints
@app.route('/api/user_data', methods=['GET'])
def user_data():
    user_id = request.args.get('user_id')
    if not user_id or not user_id.isdigit():
        return jsonify({'error': 'Valid user_id is required'}), 400
    
    conn = get_db_connection()
    try:
        with conn.cursor() as cursor:
            cursor.execute(
                "SELECT wallet, username, role, invalid_bingo_count FROM users WHERE user_id = %s",
                (int(user_id),)
            data = cursor.fetchone()
            
            if not data:
                return jsonify({'registered': False}), 200
                
            return jsonify({
                'wallet': data[0],
                'username': data[1],
                'role': data[2],
                'invalid_bingo_count': data[3],
                'registered': True
            })
    except Exception as e:
        logger.error(f"Error in user_data: {str(e)}")
        return jsonify({'error': 'Internal server error'}), 500
    finally:
        release_db_connection(conn)

@app.route('/api/register', methods=['POST'])
def register():
    data = request.get_json()
    user_id = data.get('user_id')
    phone = data.get('phone')
    username = data.get('username')
    referral_code = data.get('referral_code')
    
    if not all([user_id, phone, username]):
        return jsonify({'status': 'failed', 'reason': 'Missing required fields'}), 400
    
    conn = get_db_connection()
    try:
        with conn.cursor() as cursor:
            referral_code = generate_referral_code(user_id)
            
            cursor.execute(
                """
                INSERT INTO users (user_id, phone, username, referral_code, wallet)
                VALUES (%s, %s, %s, %s, %s)
                ON CONFLICT (user_id) DO NOTHING
                RETURNING wallet, username, role
                """,
                (int(user_id), phone, username, referral_code, INITIAL_WALLET)
            )
            
            if cursor.rowcount == 0:
                return jsonify({'status': 'failed', 'reason': 'User already exists'}), 400
                
            user_data = cursor.fetchone()
            conn.commit()
            
            return jsonify({
                'status': 'success',
                'wallet': user_data[0],
                'username': user_data[1],
                'role': user_data[2]
            })
    except Exception as e:
        conn.rollback()
        logger.error(f"Error in register: {str(e)}")
        return jsonify({'status': 'failed', 'reason': 'Database error'}), 500
    finally:
        release_db_connection(conn)

@app.route('/api/join_game', methods=['POST'])
def join_game():
    data = request.get_json()
    user_id = data.get('user_id')
    bet_amount = data.get('bet_amount')
    
    if not all([user_id, bet_amount]) or bet_amount not in BET_OPTIONS:
        return jsonify({'status': 'failed', 'reason': 'Invalid parameters'}), 400
    
    conn = get_db_connection()
    try:
        with conn.cursor() as cursor:
            # Check user balance
            cursor.execute(
                "SELECT wallet FROM users WHERE user_id = %s",
                (int(user_id),)
            wallet = cursor.fetchone()
            
            if not wallet or wallet[0] < bet_amount:
                return jsonify({
                    'status': 'failed',
                    'reason': f'Insufficient funds. You have {wallet[0] if wallet else 0} ETB, need {bet_amount} ETB.'
                }), 400
            
            # Find or create game
            cursor.execute(
                """
                SELECT game_id FROM games 
                WHERE status = 'waiting' AND bet_amount = %s
                ORDER BY game_id LIMIT 1
                """,
                (bet_amount,))
            game = cursor.fetchone()
            
            if game:
                game_id = game[0]
                cursor.execute(
                    "SELECT players FROM games WHERE game_id = %s",
                    (game_id,))
                players = cursor.fetchone()[0].split(',') if cursor.fetchone()[0] else []
                
                if str(user_id) in players:
                    return jsonify({'status': 'failed', 'reason': 'Already joined'}), 400
                
                players.append(str(user_id))
                cursor.execute(
                    "UPDATE games SET players = %s WHERE game_id = %s",
                    (','.join(players), game_id))
            else:
                game_id = generate_game_id()
                cursor.execute(
                    """
                    INSERT INTO games (game_id, players, bet_amount)
                    VALUES (%s, %s, %s)
                    """,
                    (game_id, str(user_id), bet_amount))
            
            # Deduct bet amount
            cursor.execute(
                "UPDATE users SET wallet = wallet - %s WHERE user_id = %s",
                (bet_amount, int(user_id)))
            
            # Create player card entry
            cursor.execute(
                """
                INSERT INTO player_cards (game_id, user_id, card_accepted)
                VALUES (%s, %s, FALSE)
                """,
                (game_id, int(user_id)))
            
            conn.commit()
            
            return jsonify({
                'status': 'joined',
                'game_id': game_id,
                'bet_amount': bet_amount
            })
    except Exception as e:
        conn.rollback()
        logger.error(f"Error in join_game: {str(e)}")
        return jsonify({'status': 'failed', 'reason': 'Database error'}), 500
    finally:
        release_db_connection(conn)

@app.route('/api/select_number', methods=['POST'])
def select_number():
    data = request.get_json()
    user_id = data.get('user_id')
    game_id = data.get('game_id')
    selected_number = data.get('selected_number')
    
    if not all([user_id, game_id, selected_number]) or not (1 <= selected_number <= 100):
        return jsonify({'status': 'failed', 'reason': 'Invalid parameters'}), 400
    
    conn = get_db_connection()
    try:
        with conn.cursor() as cursor:
            # Verify user is in game
            cursor.execute(
                "SELECT players FROM games WHERE game_id = %s",
                (game_id,))
            game = cursor.fetchone()
            
            if not game or str(user_id) not in game[0].split(','):
                return jsonify({'status': 'failed', 'reason': 'Not in game'}), 403
            
            # Generate card numbers based on selected number
            random.seed(selected_number)
            card_numbers = sorted(random.sample(range(1, 101), 25))
            
            cursor.execute(
                """
                UPDATE player_cards 
                SET card_numbers = %s 
                WHERE game_id = %s AND user_id = %s
                """,
                (','.join(map(str, card_numbers)), game_id, int(user_id)))
            
            conn.commit()
            
            return jsonify({
                'status': 'success',
                'card_numbers': card_numbers
            })
    except Exception as e:
        conn.rollback()
        logger.error(f"Error in select_number: {str(e)}")
        return jsonify({'status': 'failed', 'reason': 'Database error'}), 500
    finally:
        release_db_connection(conn)

@app.route('/api/accept_card', methods=['POST'])
def accept_card():
    data = request.get_json()
    user_id = data.get('user_id')
    game_id = data.get('game_id')
    
    if not all([user_id, game_id]):
        return jsonify({'status': 'failed', 'reason': 'Invalid parameters'}), 400
    
    conn = get_db_connection()
    try:
        with conn.cursor() as cursor:
            cursor.execute(
                """
                UPDATE player_cards 
                SET card_accepted = TRUE 
                WHERE game_id = %s AND user_id = %s
                RETURNING card_numbers
                """,
                (game_id, int(user_id)))
            
            card = cursor.fetchone()
            if not card:
                return jsonify({'status': 'failed', 'reason': 'Card not found'}), 404
            
            # Check if enough players to start game
            cursor.execute(
                "SELECT players FROM games WHERE game_id = %s",
                (game_id,))
            players = cursor.fetchone()[0].split(',')
            
            if len(players) >= 2:
                cursor.execute(
                    """
                    UPDATE games 
                    SET status = 'started', 
                        start_time = NOW(),
                        prize_amount = bet_amount * %s
                    WHERE game_id = %s
                    """,
                    (len(players), game_id))
            
            conn.commit()
            
            return jsonify({
                'status': 'accepted',
                'card_numbers': card[0].split(',')
            })
    except Exception as e:
        conn.rollback()
        logger.error(f"Error in accept_card: {str(e)}")
        return jsonify({'status': 'failed', 'reason': 'Database error'}), 500
    finally:
        release_db_connection(conn)

@app.route('/api/game_status', methods=['GET'])
def game_status():
    game_id = request.args.get('game_id')
    user_id = request.args.get('user_id')
    
    if not all([game_id, user_id]):
        return jsonify({'status': 'failed', 'reason': 'Invalid parameters'}), 400
    
    conn = get_db_connection()
    try:
        with conn.cursor() as cursor:
            cursor.execute(
                """
                SELECT status, start_time, end_time, numbers_called, 
                       prize_amount, winner_id, players, bet_amount
                FROM games WHERE game_id = %s
                """,
                (game_id,))
            game = cursor.fetchone()
            
            if not game:
                return jsonify({'status': 'not_found'}), 404
            
            status, start_time, end_time, numbers_called, prize_amount, winner_id, players_str, bet_amount = game
            players = players_str.split(',') if players_str else []
            
            if str(user_id) not in players and status != 'waiting':
                return jsonify({'status': 'failed', 'reason': 'Not in game'}), 403
            
            cursor.execute(
                "SELECT card_numbers FROM player_cards WHERE game_id = %s AND user_id = %s",
                (game_id, int(user_id)))
            card = cursor.fetchone()
            
            return jsonify({
                'status': status,
                'start_time': start_time.isoformat() if start_time else None,
                'end_time': end_time.isoformat() if end_time else None,
                'numbers_called': numbers_called.split(',') if numbers_called else [],
                'prize_amount': prize_amount,
                'winner_id': winner_id,
                'players': players,
                'bet_amount': bet_amount,
                'card_numbers': card[0].split(',') if card else []
            })
    except Exception as e:
        logger.error(f"Error in game_status: {str(e)}")
        return jsonify({'status': 'failed', 'reason': 'Database error'}), 500
    finally:
        release_db_connection(conn)

@app.route('/api/call_number', methods=['POST'])
def call_number():
    data = request.get_json()
    game_id = data.get('game_id')
    
    if not game_id:
        return jsonify({'status': 'failed', 'reason': 'Invalid parameters'}), 400
    
    conn = get_db_connection()
    try:
        with conn.cursor() as cursor:
            cursor.execute(
                "SELECT numbers_called FROM games WHERE game_id = %s AND status = 'started'",
                (game_id,))
            result = cursor.fetchone()
            
            if not result:
                return jsonify({'status': 'failed', 'reason': 'Game not started'}), 400
            
            numbers_called = result[0].split(',') if result[0] else []
            
            if len(numbers_called) >= 100:
                return jsonify({'status': 'failed', 'reason': 'All numbers called'}), 400
            
            # Generate unique random number
            called_numbers = set(numbers_called)
            new_number = str(random.randint(1, 100))
            while new_number in called_numbers:
                new_number = str(random.randint(1, 100))
            
            numbers_called.append(new_number)
            
            cursor.execute(
                "UPDATE games SET numbers_called = %s WHERE game_id = %s",
                (','.join(numbers_called), game_id))
            
            conn.commit()
            
            return jsonify({
                'number': int(new_number),
                'called_numbers': numbers_called,
                'remaining': 100 - len(numbers_called)
            })
    except Exception as e:
        conn.rollback()
        logger.error(f"Error in call_number: {str(e)}")
        return jsonify({'status': 'failed', 'reason': 'Database error'}), 500
    finally:
        release_db_connection(conn)

@app.route('/api/check_bingo', methods=['POST'])
def check_bingo():
    data = request.get_json()
    user_id = data.get('user_id')
    game_id = data.get('game_id')
    
    if not all([user_id, game_id]):
        return jsonify({'status': 'failed', 'reason': 'Invalid parameters'}), 400
    
    conn = get_db_connection()
    try:
        with conn.cursor() as cursor:
            cursor.execute(
                """
                SELECT numbers_called, winner_id, players, bet_amount 
                FROM games WHERE game_id = %s
                """,
                (game_id,))
            game = cursor.fetchone()
            
            if not game or game[1] is not None:
                return jsonify({'status': 'failed', 'reason': 'Game already has winner'}), 400
                
            numbers_called, _, players_str, bet_amount = game
            players = players_str.split(',')
            
            if str(user_id) not in players:
                return jsonify({'status': 'failed', 'reason': 'Not in game'}), 403
            
            cursor.execute(
                "SELECT card_numbers FROM player_cards WHERE game_id = %s AND user_id = %s",
                (game_id, int(user_id)))
            card = cursor.fetchone()
            
            if not card:
                return jsonify({'status': 'failed', 'reason': 'Card not found'}), 404
                
            card_numbers = set(card[0].split(','))
            called_numbers = set(numbers_called.split(',')) if numbers_called else set()
            
            # Check for bingo (simple row/column/diagonal check)
            marked = [num for num in card_numbers if num in called_numbers]
            card_grid = [marked[i:i+5] for i in range(0, 25, 5)]
            
            won = (
                any(len(row) == 5 for row in card_grid) or  # Any full row
                any(all(str(i*5 + col) in marked for i in range(5)) for col in range(5)) or  # Any full column
                all(str(i*5 + i) in marked for i in range(5)) or  # Diagonal
                all(str(i*5 + (4-i)) in marked for i in range(5))  # Anti-diagonal
            )
            
            if not won:
                # Remove player from game for false bingo
                players.remove(str(user_id))
                cursor.execute(
                    "UPDATE games SET players = %s WHERE game_id = %s",
                    (','.join(players), game_id))
                
                cursor.execute(
                    "UPDATE users SET invalid_bingo_count = invalid_bingo_count + 1 WHERE user_id = %s",
                    (int(user_id),))
                
                conn.commit()
                return jsonify({
                    'status': 'failed',
                    'reason': 'Invalid bingo',
                    'kicked': True
                })
            
            # Calculate prize
            total_players = len(players)
            prize_amount = int(bet_amount * total_players * (1 - HOUSE_CUT))
            
            # Update game and user
            cursor.execute(
                """
                UPDATE games 
                SET winner_id = %s, 
                    prize_amount = %s, 
                    status = 'finished', 
                    end_time = NOW() 
                WHERE game_id = %s
                """,
                (int(user_id), prize_amount, game_id))
            
            cursor.execute(
                "UPDATE users SET wallet = wallet + %s, score = score + 1 WHERE user_id = %s",
                (prize_amount, int(user_id)))
            
            conn.commit()
            
            return jsonify({
                'status': 'success',
                'won': True,
                'prize': prize_amount
            })
    except Exception as e:
        conn.rollback()
        logger.error(f"Error in check_bingo: {str(e)}")
        return jsonify({'status': 'failed', 'reason': 'Database error'}), 500
    finally:
        release_db_connection(conn)

@app.route('/api/request_withdrawal', methods=['POST'])
def request_withdrawal():
    data = request.get_json()
    user_id = data.get('user_id')
    amount = data.get('amount')
    method = data.get('method', 'telebirr')
    
    if not all([user_id, amount]) or amount < MINIMUM_WITHDRAWAL:
        return jsonify({'status': 'failed', 'reason': f'Minimum withdrawal is {MINIMUM_WITHDRAWAL} ETB'}), 400
    
    conn = get_db_connection()
    try:
        with conn.cursor() as cursor:
            # Check balance
            cursor.execute(
                "SELECT wallet FROM users WHERE user_id = %s",
                (int(user_id),))
            wallet = cursor.fetchone()
            
            if not wallet or wallet[0] < amount:
                return jsonify({
                    'status': 'failed',
                    'reason': f'Insufficient funds. You have {wallet[0] if wallet else 0} ETB'
                }), 400
            
            # Create withdrawal request
            withdraw_id = generate_withdraw_id(user_id)
            cursor.execute(
                """
                INSERT INTO withdrawals (withdraw_id, user_id, amount, method)
                VALUES (%s, %s, %s, %s)
                """,
                (withdraw_id, int(user_id), amount, method))
            
            # Deduct from wallet
            cursor.execute(
                "UPDATE users SET wallet = wallet - %s WHERE user_id = %s",
                (amount, int(user_id)))
            
            conn.commit()
            
            return jsonify({
                'status': 'requested',
                'withdraw_id': withdraw_id,
                'amount': amount
            })
    except Exception as e:
        conn.rollback()
        logger.error(f"Error in request_withdrawal: {str(e)}")
        return jsonify({'status': 'failed', 'reason': 'Database error'}), 500
    finally:
        release_db_connection(conn)

@app.route('/api/pending_withdrawals', methods=['GET'])
def pending_withdrawals():
    user_id = request.args.get('user_id')
    
    if not user_id or not user_id.isdigit():
        return jsonify({'error': 'Valid user_id required'}), 400
    
    conn = get_db_connection()
    try:
        with conn.cursor() as cursor:
            # Check if user is admin
            cursor.execute(
                "SELECT role FROM users WHERE user_id = %s",
                (int(user_id),))
            role = cursor.fetchone()
            
            if not role or role[0] != 'admin':
                return jsonify({'status': 'unauthorized'}), 403
            
            cursor.execute(
                """
                SELECT withdraw_id, user_id, amount, method, request_time
                FROM withdrawals 
                WHERE status = 'pending'
                ORDER BY request_time
                """)
            
            withdrawals = [
                {
                    'withdraw_id': row[0],
                    'user_id': row[1],
                    'amount': row[2],
                    'method': row[3],
                    'request_time': row[4].isoformat()
                }
                for row in cursor.fetchall()
            ]
            
            return jsonify({'withdrawals': withdrawals})
    except Exception as e:
        logger.error(f"Error in pending_withdrawals: {str(e)}")
        return jsonify({'error': 'Internal server error'}), 500
    finally:
        release_db_connection(conn)

@app.route('/api/admin_actions', methods=['POST'])
def admin_actions():
    data = request.get_json()
    user_id = data.get('user_id')
    action = data.get('action')
    
    if not all([user_id, action]):
        return jsonify({'status': 'failed', 'reason': 'Invalid parameters'}), 400
    
    conn = get_db_connection()
    try:
        with conn.cursor() as cursor:
            # Verify admin status
            cursor.execute(
                "SELECT role FROM users WHERE user_id = %s",
                (int(user_id),))
            role = cursor.fetchone()
            
            if not role or role[0] != 'admin':
                return jsonify({'status': 'unauthorized'}), 403
            
            if action == 'manage_withdrawal':
                withdraw_id = data.get('withdraw_id')
                action_type = data.get('action_type')
                admin_note = data.get('admin_note', '')
                
                if not all([withdraw_id, action_type]):
                    return jsonify({'status': 'failed', 'reason': 'Missing parameters'}), 400
                
                cursor.execute(
                    "SELECT user_id, amount FROM withdrawals WHERE withdraw_id = %s AND status = 'pending'",
                    (withdraw_id,))
                withdrawal = cursor.fetchone()
                
                if not withdrawal:
                    return jsonify({'status': 'failed', 'reason': 'Withdrawal not found'}), 404
                
                if action_type == 'approve':
                    cursor.execute(
                        "UPDATE withdrawals SET status = 'approved', admin_note = %s WHERE withdraw_id = %s",
                        (admin_note, withdraw_id))
                elif action_type == 'reject':
                    # Return funds if rejecting
                    cursor.execute(
                        "UPDATE users SET wallet = wallet + %s WHERE user_id = %s",
                        (withdrawal[1], withdrawal[0]))
                    
                    cursor.execute(
                        "UPDATE withdrawals SET status = 'rejected', admin_note = %s WHERE withdraw_id = %s",
                        (admin_note, withdraw_id))
                else:
                    return jsonify({'status': 'failed', 'reason': 'Invalid action type'}), 400
                
                conn.commit()
                return jsonify({'status': action_type})
            
            return jsonify({'status': 'failed', 'reason': 'Unknown action'}), 400
    except Exception as e:
        conn.rollback()
        logger.error(f"Error in admin_actions: {str(e)}")
        return jsonify({'status': 'failed', 'reason': 'Database error'}), 500
    finally:
        release_db_connection(conn)

@app.route('/api/leaderboard', methods=['GET'])
def leaderboard():
    conn = get_db_connection()
    try:
        with conn.cursor() as cursor:
            cursor.execute(
                """
                SELECT username, score, wallet
                FROM users
                WHERE role = 'user'
                ORDER BY score DESC, wallet DESC
                LIMIT 10
                """)
            
            leaders = [
                {
                    'username': row[0] or 'Anonymous',
                    'score': row[1],
                    'wallet': row[2]
                }
                for row in cursor.fetchall()
            ]
            
            return jsonify({'leaders': leaders})
    except Exception as e:
        logger.error(f"Error in leaderboard: {str(e)}")
        return jsonify({'error': 'Internal server error'}), 500
    finally:
        release_db_connection(conn)

@app.route('/api/invite_data', methods=['GET'])
def invite_data():
    user_id = request.args.get('user_id')
    
    if not user_id or not user_id.isdigit():
        return jsonify({'error': 'Valid user_id required'}), 400
    
    conn = get_db_connection()
    try:
        with conn.cursor() as cursor:
            cursor.execute(
                "SELECT referral_code FROM users WHERE user_id = %s",
                (int(user_id),))
            result = cursor.fetchone()
            
            if not result:
                return jsonify({'error': 'User not found'}), 404
            
            referral_code = result[0]
            cursor.execute(
                "SELECT COUNT(*) FROM referrals WHERE referrer_id = %s",
                (int(user_id),))
            referral_count = cursor.fetchone()[0]
            
            return jsonify({
                'referral_link': f"https://t.me/YOUR_BOT_USERNAME?start=ref_{user_id}",
                'referral_count': referral_count,
                'bonus_threshold': 20,
                'bonus_amount': 10
            })
    except Exception as e:
        logger.error(f"Error in invite_data: {str(e)}")
        return jsonify({'error': 'Internal server error'}), 500
    finally:
        release_db_connection(conn)

# Initialize database on startup
init_db()

if __name__ == '__main__':
    app.run()