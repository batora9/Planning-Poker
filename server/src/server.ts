import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import path from 'path';
import { fileURLToPath } from 'url';

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

interface RoomState {
  players: Map<string, Player>;
  votes: Map<string, Vote>;
  gamePhase: 'waiting' | 'voting' | 'results';
  roomId: string;
}

interface RoomStateUpdate {
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

const app = express();
const server = http.createServer(app);

// CORS設定
const allowedOrigins =
  process.env.NODE_ENV === 'production'
    ? process.env.CLIENT_URL
      ? [process.env.CLIENT_URL]
      : []
    : ['http://localhost:5173'];

const io = new Server(server, {
  cors: {
    origin: allowedOrigins.length > 0 ? allowedOrigins : true,
    methods: ['GET', 'POST'],
  },
});

// 静的ファイルの提供
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
app.use(express.static(path.join(__dirname, '../../client/dist')));

// すべてのルートでindex.htmlを返す（React Routerのため）
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../../client/dist/index.html'));
});

// 状態管理
const roomState: RoomState = {
  players: new Map<string, Player>(),
  votes: new Map<string, Vote>(),
  gamePhase: 'waiting',
  roomId: 'main-room',
};

// ヘルパー関数：状態の更新を全プレイヤーに送信
const broadcastRoomState = (): void => {
  const roomStateUpdate: RoomStateUpdate = {
    players: Array.from(roomState.players.values()),
    gamePhase: roomState.gamePhase,
    votes:
      roomState.gamePhase === 'results'
        ? Array.from(roomState.votes.entries())
        : null,
  };

  io.to(roomState.roomId).emit('game-state-update', roomStateUpdate);
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
      connected: true,
    };

    roomState.players.set(socket.id, player);
    socket.join(roomState.roomId);

    broadcastRoomState();
    console.log(`${playerName} が参加しました`);
  });

  // 投票開始
  socket.on('start-voting', () => {
    roomState.gamePhase = 'voting';
    roomState.votes.clear();

    io.to(roomState.roomId).emit('voting-started');
    broadcastRoomState();

    console.log('投票が開始されました');
  });

  // 投票処理
  socket.on('submit-vote', (vote: number) => {
    if (
      typeof vote !== 'number' ||
      ![1, 2, 3, 5, 8, 13, 21, 34, 55, 89].includes(vote)
    ) {
      console.error('無効な投票値:', vote);
      return;
    }

    if (roomState.gamePhase === 'voting' && roomState.players.has(socket.id)) {
      const player = roomState.players.get(socket.id);
      if (!player) {
        console.error('プレイヤーが見つかりません:', socket.id);
        return;
      }

      const voteData: Vote = {
        playerId: socket.id,
        playerName: player.name,
        vote: vote,
      };

      roomState.votes.set(socket.id, voteData);
      console.log(`${player.name} が ${vote} に投票しました`);

      // 投票状況を更新
      const voteCountUpdate: VoteCountUpdate = {
        votedCount: roomState.votes.size,
        totalPlayers: roomState.players.size,
      };
      io.to(roomState.roomId).emit('vote-count-update', voteCountUpdate);

      // 全員の投票が完了したかチェック
      if (roomState.votes.size === roomState.players.size) {
        // カウントダウン開始を通知
        io.to(roomState.roomId).emit('start-countdown');
        console.log('全員の投票が完了。カウントダウンを開始します');

        // 3秒後に結果を表示
        setTimeout(() => {
          roomState.gamePhase = 'results';

          // 結果計算
          const votes = Array.from(roomState.votes.values());
          const sum = votes.reduce((acc, v) => acc + v.vote, 0);
          const average = Math.round((sum / votes.length) * 10) / 10;

          const votingResult: VotingResult = {
            votes: votes,
            average: average,
          };

          io.to(roomState.roomId).emit('voting-complete', votingResult);
          console.log(`投票完了。平均値: ${average}`);
        }, 3000);
      }
    }
  });

  // 次のラウンド開始
  socket.on('next-round', () => {
    roomState.gamePhase = 'waiting';
    roomState.votes.clear();

    broadcastRoomState();
    console.log('次のラウンドが開始されました');
  });

  // 切断処理
  socket.on('disconnect', () => {
    if (roomState.players.has(socket.id)) {
      const player = roomState.players.get(socket.id);
      const playerName = player?.name || 'Unknown';

      roomState.players.delete(socket.id);
      roomState.votes.delete(socket.id);

      broadcastRoomState();
      console.log(`${playerName} が退出しました`);
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
const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {
  console.log(`サーバーがポート ${PORT} で起動しました`);
  console.log(`環境: ${process.env.NODE_ENV || 'development'}`);
  if (process.env.NODE_ENV !== 'production') {
    console.log(`WebSocket サーバー: ws://localhost:${PORT}`);
    console.log('クライアント URL: http://localhost:5173');
  }
});
