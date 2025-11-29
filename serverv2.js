// DUMMY FILE

// === Imports ===
const http = require('http');
const WebSocket = require('ws');
const url = require('url');
const fs = require('fs');
const crypto = require('crypto');

const PORT = 8080;
const MAINTENANCE = false;

// === Logging ===
function log(level, ...msg) {
    const t = new Date().toLocaleString();
    console.log(`[${t}] [${level}]`, ...msg);
}

log("INFO", "Starting gameserver on port", PORT);

// === Load level ===
const LEVEL_FILE = "Level.GJL";
let currentLevel = "";

try {
    currentLevel = fs.readFileSync('./' + LEVEL_FILE, 'utf8');
    log("INFO", "Loaded level", LEVEL_FILE);
} catch (err) {
    log("ERROR", "Failed to load level:", err);
    process.exit(1);
}

// === Players ===
const players = {};

// Generate a random 8-character ID
function genId() {
    return crypto.randomBytes(4).toString("hex");
}

// === Helpers ===
function sendJSON(res, code, obj) {
    res.writeHead(code, { "Content-Type": "application/json" });
    res.end(JSON.stringify(obj));
}

function safeJSON(str) {
    try { return JSON.parse(str); }
    catch { return null; }
}

// === HTTP Server ===
const server = http.createServer((req, res) => {
    // Global CORS
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");

    if (MAINTENANCE) {
        if (req.url !== "/isonline") {
            return sendJSON(res, 503, { error: "service unavailable" });
        }
    }

    if (req.method === "GET" && req.url === "/isonline") {
        return res.end("true");
    }

    if (req.method === "POST" && req.url === "/join") {
        let body = "";

        req.on("data", chunk => {
            if (body.length > 2048) return; // Hard limit
            body += chunk;
        });

        req.on("end", () => {
            const data = safeJSON(body);
            if (!data || !data.name)
                return sendJSON(res, 400, { error: "Name required" });

            const nameReg = /^[a-zA-Z0-9_]+$/;
            if (!nameReg.test(data.name))
                return sendJSON(res, 400, { error: "Invalid name" });

            const id = genId();
            players[id] = {
                name: data.name,
                x: 0, y: 0,
                angle: 0,
                gamemode: "default"
            };

            log("INFO", `JOIN name=${data.name} id=${id}`);

            sendJSON(res, 200, {
                playerId: id,
                players: Object.fromEntries(
                    Object.entries(players).map(([pid, p]) => [pid, { name: p.name }])
                )
            });

            broadcast({ type: "player_joined", playerId: id, playerData: players[id] });
            broadcast({ type: "chat", playerId: 0, name: "SYSTEM", message: data.name + " Joined" });
        });

        return;
    }

    sendJSON(res, 404, { error: "Not Found" });
});

// === WebSocket Server ===
const wss = new WebSocket.Server({ server });

wss.on("connection", ws => {
    ws.playerId = null;
    ws.isAlive = true;
    ws.lastChat = 0;
    ws.lastMissile = 0;

    ws.send(JSON.stringify({ type: "loadlevel", ldata: currentLevel }));

    ws.on("pong", () => ws.isAlive = true);

    ws.on("message", msg => {
        const data = safeJSON(msg);
        if (!data) return;

        // === Update position ===
        if (data.type === "update_position") {
            const { playerId, x, y, angle, gamemode } = data;

            if (!players[playerId]) {
                log("WARN", "Invalid playerId", playerId);
                return ws.close();
            }

            // Anti-cheat sanity check
            if (Math.abs(x) > 100000 || Math.abs(y) > 100000)
                return ws.close();

            players[playerId] = { ...players[playerId], x, y, angle, gamemode };
            ws.playerId = playerId;

            broadcast({
                type: "player_update",
                playerId,
                name: players[playerId].name,
                x, y, angle, gamemode
            }, ws);

            if (x === 0 && y === 0) {
                log("INFO", `Possibly died: ${players[playerId].name} (${playerId})`);
            }
        }

        // === Chat ===
        if (data.type === "chat") {
            if (!players[data.playerId]) return;

            // Spam limit
            if (Date.now() - ws.lastChat < 250) return;
            ws.lastChat = Date.now();

            if (data.message.length > 64)
                return ws.send(JSON.stringify({ type: "chat", playerId: 0, name: "SYSTEM", message:"message too long" }));

            log("INFO", `${players[data.playerId].name} (${data.playerId}): ${data.message}`);
            broadcast({ type: "chat", playerId: data.playerId, name: players[data.playerId].name, message: data.message });

            if (data.message === "!return") {
                ws.send(JSON.stringify({ type: "loadlevel", ldata: currentLevel }));
            }
        }

        // === Missile ===
        if (data.type === "missilec") {
            if (Date.now() - ws.lastMissile < 120) return;
            ws.lastMissile = Date.now();

            broadcast({
                type: "missile",
                playerId: data.playerId,
                x: data.x,
                y: data.y,
                angle: data.angle
            }, ws);
        }
    });

    ws.on("close", () => {
        if (ws.playerId && players[ws.playerId]) {
            broadcast({ type: "player_left", playerId: ws.playerId });
            broadcast({ type: "chat", playerId: 0, name: "SYSTEM", message: players[ws.playerId].name + " Left" });
            log("INFO", `LEAVE name=${players[ws.playerId].name} id=${ws.playerId}`);
            delete players[ws.playerId];
        }
    });
});

// === Broadcast ===
function broadcast(data, exclude = null) {
    const str = JSON.stringify(data);
    wss.clients.forEach(c => {
        if (c !== exclude && c.readyState === WebSocket.OPEN) {
            c.send(str);
        }
    });
}

// === Heartbeat (no ghost sockets) ===
setInterval(() => {
    wss.clients.forEach(ws => {
        if (!ws.isAlive) return ws.terminate();
        ws.isAlive = false;
        ws.ping();
    });
}, 30000);

// === Start server ===
server.listen(PORT, () => {
    log("INFO", "Game server running on port " + PORT);
});
              
