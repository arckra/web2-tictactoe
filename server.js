// server.js - WebSocket Tic Tac Toe Server
// Jalankan dengan: node server.js
// Pastikan sudah install ws: npm install ws

const WebSocket = require("ws");

const PORT = 8080;
const wss = new WebSocket.Server({ port: PORT });

console.log(`🎮 WebSocket Tic Tac Toe Server berjalan di ws://localhost:${PORT}`);

// Menyimpan semua room yang aktif
// Format: { roomId: { players: [ws1, ws2], board: [...], currentTurn: 'X', gameOver: false } }
const rooms = {};

// Generate ID room sederhana
function generateRoomId() {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
}

// Cek apakah ada pemenang
function checkWinner(board) {
  const winPatterns = [
    [0, 1, 2], [3, 4, 5], [6, 7, 8], // baris
    [0, 3, 6], [1, 4, 7], [2, 5, 8], // kolom
    [0, 4, 8], [2, 4, 6],             // diagonal
  ];

  for (const [a, b, c] of winPatterns) {
    if (board[a] && board[a] === board[b] && board[a] === board[c]) {
      return { winner: board[a], line: [a, b, c] };
    }
  }

  // Cek seri
  if (board.every((cell) => cell !== null)) {
    return { winner: "draw", line: [] };
  }

  return null;
}

// Kirim pesan ke satu client
function sendTo(ws, data) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(data));
  }
}

// Kirim pesan ke semua player dalam satu room
function broadcast(room, data) {
  room.players.forEach((ws) => sendTo(ws, data));
}

// Reset board
function createBoard() {
  return Array(9).fill(null);
}

wss.on("connection", (ws) => {
  console.log("🔌 Client baru terhubung");

  ws.roomId = null;
  ws.symbol = null; // 'X' atau 'O'

  ws.on("message", (rawMessage) => {
    let msg;
    try {
      msg = JSON.parse(rawMessage);
    } catch {
      return sendTo(ws, { type: "error", message: "Format pesan tidak valid." });
    }

    const { type, payload } = msg;

    // ── CREATE ROOM ──────────────────────────────────────────────
    if (type === "create_room") {
      const roomId = generateRoomId();
      rooms[roomId] = {
        players: [ws],
        board: createBoard(),
        currentTurn: "X",
        gameOver: false,
      };
      ws.roomId = roomId;
      ws.symbol = "X";

      sendTo(ws, {
        type: "room_created",
        roomId,
        symbol: "X",
        message: `Room ${roomId} berhasil dibuat. Bagikan kode ini ke temanmu!`,
      });

      console.log(`🏠 Room ${roomId} dibuat`);
    }

    // ── JOIN ROOM ─────────────────────────────────────────────────
    else if (type === "join_room") {
      const roomId = payload?.roomId?.toUpperCase().trim();
      const room = rooms[roomId];

      if (!room) {
        return sendTo(ws, { type: "error", message: "Room tidak ditemukan. Cek kode room-nya!" });
      }
      if (room.players.length >= 2) {
        return sendTo(ws, { type: "error", message: "Room sudah penuh (2/2 pemain)." });
      }

      room.players.push(ws);
      ws.roomId = roomId;
      ws.symbol = "O";

      // Kasih tahu player 2 berhasil join
      sendTo(ws, {
        type: "room_joined",
        roomId,
        symbol: "O",
        message: `Berhasil masuk room ${roomId}!`,
      });

      // Kasih tahu player 1 bahwa lawan sudah masuk
      sendTo(room.players[0], {
        type: "opponent_joined",
        message: "Lawan sudah masuk! Game dimulai.",
      });

      // Broadcast state awal game ke semua pemain
      broadcast(room, {
        type: "game_start",
        board: room.board,
        currentTurn: room.currentTurn,
      });

      console.log(`👥 Player 2 bergabung ke room ${roomId}`);
    }

    // ── MAKE MOVE ─────────────────────────────────────────────────
    else if (type === "make_move") {
      const roomId = ws.roomId;
      const room = rooms[roomId];

      if (!room) {
        return sendTo(ws, { type: "error", message: "Kamu tidak ada di room manapun." });
      }
      if (room.gameOver) {
        return sendTo(ws, { type: "error", message: "Game sudah selesai. Mulai ulang dulu!" });
      }
      if (room.players.length < 2) {
        return sendTo(ws, { type: "error", message: "Tunggu lawan masuk dulu!" });
      }
      if (room.currentTurn !== ws.symbol) {
        return sendTo(ws, { type: "error", message: "Bukan giliranmu!" });
      }

      const index = payload?.index;
      if (index === undefined || index < 0 || index > 8 || room.board[index] !== null) {
        return sendTo(ws, { type: "error", message: "Langkah tidak valid." });
      }

      // Catat langkah
      room.board[index] = ws.symbol;

      const result = checkWinner(room.board);

      if (result) {
        room.gameOver = true;
        broadcast(room, {
          type: "game_over",
          board: room.board,
          result, // { winner: 'X'/'O'/'draw', line: [...] }
          message:
            result.winner === "draw"
              ? "Seri! Tidak ada yang menang."
              : `Pemain ${result.winner} menang! 🎉`,
        });
        console.log(`🏆 Game di room ${roomId} selesai. Pemenang: ${result.winner}`);
      } else {
        // Ganti giliran
        room.currentTurn = room.currentTurn === "X" ? "O" : "X";
        broadcast(room, {
          type: "board_update",
          board: room.board,
          currentTurn: room.currentTurn,
          lastMove: { index, symbol: ws.symbol },
        });
      }
    }

    // ── RESTART GAME ──────────────────────────────────────────────
    else if (type === "restart") {
      const roomId = ws.roomId;
      const room = rooms[roomId];

      if (!room || room.players.length < 2) {
        return sendTo(ws, { type: "error", message: "Tidak bisa restart sekarang." });
      }

      room.board = createBoard();
      room.currentTurn = "X";
      room.gameOver = false;

      broadcast(room, {
        type: "game_restart",
        board: room.board,
        currentTurn: room.currentTurn,
        message: "Game dimulai ulang!",
      });
    }

    // ── UNKNOWN TYPE ──────────────────────────────────────────────
    else {
      sendTo(ws, { type: "error", message: `Tipe pesan tidak dikenali: ${type}` });
    }
  });

  ws.on("close", () => {
    const roomId = ws.roomId;
    if (!roomId || !rooms[roomId]) return;

    const room = rooms[roomId];
    // Hapus player yang disconnect dari room
    room.players = room.players.filter((p) => p !== ws);

    if (room.players.length === 0) {
      // Hapus room kalau sudah kosong
      delete rooms[roomId];
      console.log(`🗑️  Room ${roomId} dihapus (kosong)`);
    } else {
      // Kasih tahu player yang tersisa
      broadcast(room, {
        type: "opponent_left",
        message: "Lawan keluar dari game. Tunggu lawan baru atau buat room baru.",
      });
      room.gameOver = true;
      console.log(`👋 Satu player keluar dari room ${roomId}`);
    }
  });

  ws.on("error", (err) => {
    console.error("WebSocket error:", err.message);
  });
});