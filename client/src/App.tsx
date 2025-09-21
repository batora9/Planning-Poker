import React, { useState, useEffect } from 'react';
import { io, Socket } from 'socket.io-client';
import './App.css';

interface Player {
  id: string;
  name: string;
  connected: boolean;
}

interface Vote {
  playerId: string;
  playerName: string;
  vote: number;
}

interface GameState {
  players: Player[];
  gamePhase: 'waiting' | 'voting' | 'results';
  votes: Vote[] | null;
}

function App() {
  const [socket, setSocket] = useState<Socket | null>(null);
  const [playerName, setPlayerName] = useState('');
  const [isJoined, setIsJoined] = useState(false);
  const [gameState, setGameState] = useState<GameState>({
    players: [],
    gamePhase: 'waiting',
    votes: null
  });
  const [selectedCard, setSelectedCard] = useState<number | null>(null);
  const [voteCount, setVoteCount] = useState({ votedCount: 0, totalPlayers: 0 });
  const [results, setResults] = useState<{ votes: Vote[]; average: number } | null>(null);

  const cardValues = [1, 2, 3, 5, 10];

  useEffect(() => {
    // 本番環境では現在のホストを使用、開発環境ではlocalhostを使用
    const socketUrl = process.env.NODE_ENV === 'production' 
      ? window.location.origin 
      : 'http://localhost:3000';
    
    const newSocket = io(socketUrl);
    setSocket(newSocket);

    newSocket.on('game-state-update', (state: GameState) => {
      setGameState(state);
    });

    newSocket.on('voting-started', () => {
      setSelectedCard(null);
      setResults(null);
    });

    newSocket.on('vote-count-update', (count: { votedCount: number; totalPlayers: number }) => {
      setVoteCount(count);
    });

    newSocket.on('voting-complete', (result: { votes: Vote[]; average: number }) => {
      setResults(result);
      setGameState(prev => ({ ...prev, gamePhase: 'results' }));
    });

    return () => {
      newSocket.close();
    };
  }, []);

  const handleJoinGame = (e: React.FormEvent) => {
    e.preventDefault();
    if (playerName.trim() && socket) {
      socket.emit('join-game', playerName.trim());
      setIsJoined(true);
    }
  };

  const handleStartVoting = () => {
    if (socket) {
      socket.emit('start-voting');
    }
  };

  const handleCardSelect = (value: number) => {
    if (gameState.gamePhase === 'voting') {
      setSelectedCard(value);
      if (socket) {
        socket.emit('submit-vote', value);
      }
    }
  };

  const handleNextRound = () => {
    if (socket) {
      socket.emit('next-round');
      setResults(null);
      setSelectedCard(null);
    }
  };

  if (!isJoined) {
    return (
      <div className="app">
        <div className="join-form">
          <h1>Planning Poker</h1>
          <form onSubmit={handleJoinGame}>
            <div className="input-group">
              <label htmlFor="playerName">お名前を入力してください</label>
              <input
                id="playerName"
                type="text"
                value={playerName}
                onChange={(e) => setPlayerName(e.target.value)}
                placeholder="お名前"
                required
              />
            </div>
            <button type="submit" className="join-button">
              ゲームに参加
            </button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="app">
      <header className="header">
        <h1>Planning Poker</h1>
        <div className="players-info">
          参加者: {gameState.players.map(p => p.name).join(', ')}
        </div>
      </header>

      <main className="main-content">
        {gameState.gamePhase === 'waiting' && (
          <div className="waiting-screen">
            <h2>参加者を待機中...</h2>
            <div className="players-list">
              <h3>参加者一覧 ({gameState.players.length}人)</h3>
              <ul>
                {gameState.players.map(player => (
                  <li key={player.id} className="player-item">
                    {player.name}
                  </li>
                ))}
              </ul>
            </div>
            {gameState.players.length >= 2 && (
              <button onClick={handleStartVoting} className="start-button">
                投票を開始
              </button>
            )}
            {gameState.players.length < 2 && (
              <p className="waiting-message">
                投票を開始するには最低2人の参加者が必要です
              </p>
            )}
          </div>
        )}

        {gameState.gamePhase === 'voting' && (
          <div className="voting-screen">
            <h2>カードを選択してください</h2>
            <div className="vote-progress">
              {voteCount.votedCount} / {voteCount.totalPlayers} 人が投票済み
            </div>
            <div className="cards-container">
              {cardValues.map(value => (
                <button
                  key={value}
                  className={`card ${selectedCard === value ? 'selected' : ''}`}
                  onClick={() => handleCardSelect(value)}
                  disabled={selectedCard !== null}
                >
                  {value}
                </button>
              ))}
            </div>
            {selectedCard !== null && (
              <div className="selected-info">
                選択したカード: {selectedCard}
              </div>
            )}
          </div>
        )}

        {gameState.gamePhase === 'results' && results && (
          <div className="results-screen">
            <h2>結果発表</h2>
            <div className="average-result">
              <h3>平均値: {results.average}</h3>
            </div>
            <div className="votes-details">
              <h3>投票詳細</h3>
              <div className="votes-grid">
                {results.votes.map(vote => (
                  <div key={vote.playerId} className="vote-item">
                    <span className="player-name">{vote.playerName}</span>
                    <span className="vote-value">{vote.vote}</span>
                  </div>
                ))}
              </div>
            </div>
            <button onClick={handleNextRound} className="next-button">
              次のラウンド
            </button>
          </div>
        )}
      </main>
    </div>
  );
}

export default App;
