import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import path from 'path';

// 型定義
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
  players: Map<string, Player>;
  votes: Map<string, Vote>;
  gamePhase: 'waiting' | 'voting' | 'results';
  roomId: string;
}

interface GameStateUpdate {
  players: Player[];
  gamePhase: 'waiting' | 'voting' | 'results';
  votes: [string, Vote][] | null;
}

interface VotingResult {
  votes: Vote[];
  average: number;
}

interface VoteCountUpdate {
  votedCount: number;
  totalPlayers: number;
}

// Express アプリケーションの設定
const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "http://localhost:5173",
    methods: ["GET", "POST"]
  }
});

// 静的ファイルの配信
app.use(express.static(path.join(__dirname, '../../client/dist')));

// ゲーム状態管理
const gameState: GameState = {
  players: new Map<string, Player>(),
  votes: new Map<string, Vote>(),
  gamePhase: 'waiting',
  roomId: 'main-room'
};

// ヘルパー関数：ゲーム状態の更新を全プレイヤーに送信
const broadcastGameState = (): void => {
  const gameStateUpdate: GameStateUpdate = {
    players: Array.from(gameState.players.values()),
    gamePhase: gameState.gamePhase,
    votes: gameState.gamePhase === 'results' 
      ? Array.from(gameState.votes.entries()) 
      : null
  };
  
  io.to(gameState.roomId).emit('game-state-update', gameStateUpdate);
};

// WebSocket接続処理
io.on('connection', (socket) => {
  console.log('新しいユーザーが接続しました:', socket.id);

  // プレイヤー参加
  socket.on('join-game', (playerName: string) => {
    if (!playerName || typeof playerName !== 'string') {
      console.error('無効なプレイヤー名:', playerName);
      return;
    }

    const player: Player = {
      id: socket.id,
      name: playerName.trim(),
      connected: true
    };

    gameState.players.set(socket.id, player);
    socket.join(gameState.roomId);
    
    broadcastGameState();
    console.log(`${playerName} がゲームに参加しました`);
  });

  // 投票開始
  socket.on('start-voting', () => {
    if (gameState.players.size >= 2) {
      gameState.gamePhase = 'voting';
      gameState.votes.clear();
      
      io.to(gameState.roomId).emit('voting-started');
      broadcastGameState();
      
      console.log('投票が開始されました');
    } else {
      console.log('投票開始失敗: 参加者が不足しています');
    }
  });

  // 投票処理
  socket.on('submit-vote', (vote: number) => {
    if (typeof vote !== 'number' || ![1, 2, 3, 5, 10].includes(vote)) {
      console.error('無効な投票値:', vote);
      return;
    }

    if (gameState.gamePhase === 'voting' && gameState.players.has(socket.id)) {
      const player = gameState.players.get(socket.id);
      if (!player) {
        console.error('プレイヤーが見つかりません:', socket.id);
        return;
      }

      const voteData: Vote = {
        playerId: socket.id,
        playerName: player.name,
        vote: vote
      };

      gameState.votes.set(socket.id, voteData);
      console.log(`${player.name} が ${vote} に投票しました`);

      // 投票状況を更新
      const voteCountUpdate: VoteCountUpdate = {
        votedCount: gameState.votes.size,
        totalPlayers: gameState.players.size
      };
      io.to(gameState.roomId).emit('vote-count-update', voteCountUpdate);

      // 全員の投票が完了したかチェック
      if (gameState.votes.size === gameState.players.size) {
        gameState.gamePhase = 'results';
        
        // 結果計算
        const votes = Array.from(gameState.votes.values());
        const sum = votes.reduce((acc, v) => acc + v.vote, 0);
        const average = Math.round((sum / votes.length) * 10) / 10;
        
        const votingResult: VotingResult = {
          votes: votes,
          average: average
        };

        io.to(gameState.roomId).emit('voting-complete', votingResult);
        console.log(`投票完了。平均値: ${average}`);
      }
    }
  });

  // 次のラウンド開始
  socket.on('next-round', () => {
    gameState.gamePhase = 'waiting';
    gameState.votes.clear();
    
    broadcastGameState();
    console.log('次のラウンドが開始されました');
  });

  // 切断処理
  socket.on('disconnect', () => {
    if (gameState.players.has(socket.id)) {
      const player = gameState.players.get(socket.id);
      const playerName = player?.name || 'Unknown';
      
      gameState.players.delete(socket.id);
      gameState.votes.delete(socket.id);
      
      broadcastGameState();
      console.log(`${playerName} がゲームから退出しました`);
    }
  });
});

// エラーハンドリング
io.on('error', (error) => {
  console.error('Socket.IO エラー:', error);
});

process.on('uncaughtException', (error) => {
  console.error('予期しないエラー:', error);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('未処理のPromise拒否:', reason, 'at:', promise);
});

// サーバー起動
const PORT = process.env.PORT || 3001;

server.listen(PORT, () => {
  console.log(`サーバーがポート ${PORT} で起動しました`);
  console.log(`WebSocket サーバー: ws://localhost:${PORT}`);
  console.log(`クライアント URL: http://localhost:5173`);
});
