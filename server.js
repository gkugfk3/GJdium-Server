const WebSocket = require('ws');
const http = require('http');
const url = require('url');
const fs = require('fs');
const Port=8080;
const maintenance = false;

ServerLog("[INFO] starting gameserver on port",Port);

let currentLevel="";
let levelFile="Level.GJL";

ServerLog("[INFO] loading game level",levelFile);

try
{
	currentLevel =fs.readFileSync('./'+levelFile, { encoding: 'utf8', flag: 'r' });
	ServerLog("[INFO] game level",levelFile,"loaded successfully");
}
catch (err)
{
	ServerLog('[ERROR] error reading '+levelFile+':', err);
	return;
}

function ServerLog(...args)
{
	var currentdate = new Date(); 
	var datetime = currentdate.getDate() + "/"+ (currentdate.getMonth()+1)  + "/" + currentdate.getFullYear() + " @ "  + currentdate.getHours() + ":"  + currentdate.getMinutes() + ":" + currentdate.getSeconds();
	console.log("["+datetime+"]",...args)
}
const server = http.createServer((req, res) => {
	// Set CORS headers
	res.setHeader('Access-Control-Allow-Origin', '*'); // Allow all origins (use specific domain in production)
	res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
	res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
	if (req.method === 'GET' && req.url === '/isonline') {
		// Check if the server is working, you can return true if the server is fine (most of the time it is not)
		if (!maintenance) {
			res.writeHead(200, { 'Content-Type': 'application/json' });
			res.end("true");
			return;
		} else {
			res.writeHead(503);
			res.end("service unavaible,Try again later");
			return;
		}
	}

	if (req.method === 'POST' && req.url === '/join') {
		let body = '';
		if (maintenance) {
			res.writeHead(503, { 'Content-Type': 'application/json' });
			res.end("service unavaible,Try again later");
			return;
		}
		req.on('data', chunk => {
			body += chunk.toString();
		});

		req.on('end', () => {
			try {
				const data = JSON.parse(body);
				if (data.name) {
					// Validate the player name (allow letters, numbers, and underscores only)
					const nameRegex = /^[a-zA-Z0-9_]+$/;

					if (!nameRegex.test(data.name)) {
						//res.writeHead(200, { 'Content-Type': 'application/json' });
						res.end(JSON.stringify({ error: 'Invalid name: Only letters, numbers, and underscores are allowed.' }));
						ServerLog("[INFO]",data.name , " InvalidJoinName ");
						return;
					}

					const playerId = Date.now(); // Simple unique ID
					players[playerId] = { name: data.name, x: 0, y: 0, angle: 0, gamemode: 'default' };

					//res.writeHead(200, { 'Content-Type': 'application/json' });
					res.end(JSON.stringify({ playerId, players }));

					broadcast({ type: 'player_joined', playerId, playerData: players[playerId] });
					ServerLog("[INFO]","name="+data.name , "id=" + playerId , "Joined ");
					broadcast({ type: 'chat', playerId: 0, name: "SYSTEM", message: data.name + " Joined" });
				} else {
					//res.writeHead(200, { 'Content-Type': 'application/json' });
					res.end(JSON.stringify({ error: 'Invalid request: Name is required' }));
					ServerLog("[INFO]",data.name + " InvalidJoinName ");
				}
			} catch (err) {
				//res.writeHead(200, { 'Content-Type': 'application/json' });
				res.end(JSON.stringify({ error: 'Invalid JSON' }));
				console.log("[ERROR]","InvalidJoinJSON ");
			}
		});
	} else {
		//res.writeHead(404, { 'Content-Type': 'application/json' });
		res.end(JSON.stringify({ error: 'Not Found' }));
	}
});


const wss = new WebSocket.Server({ server });

let players = {};

wss.on('headers', (headers, req) => {
	headers.push('Access-Control-Allow-Origin: *');
});

wss.on('connection', (ws) => {
	//console.log("NewWSConnection " + ws.toString());

	ws.playerId = null;

	ws.send(JSON.stringify({
		type: "loadlevel",
		ldata: currentLevel
	}));

	ws.on('message', (message) => {
		let data;
		try {
			data = JSON.parse(message);
		} catch (err) {
			console.error('Invalid JSON:', message);
			return;
		}

		if (data.type === 'update_position') {
			const { playerId: msgPlayerId, x, y, angle, gamemode } = data;
			if (players[msgPlayerId]) {
				players[msgPlayerId] = { ...players[msgPlayerId], x, y, angle, gamemode };
				ws.playerId = msgPlayerId; // Assign playerId to WebSocket
				broadcast({ type: 'player_update', playerId: msgPlayerId, name: players[msgPlayerId].name, x, y, angle, gamemode }, ws);
				if (x == 0 && y == 0) { ServerLog("[INFO]","name="+players[msgPlayerId].name + " id=" + msgPlayerId + " : Possibly died because of X 0 Y 0"); }
			} else {
				console.error(`Invalid playerId: ${msgPlayerId}. Closing connection.`);
				ws.close();  // Close the connection if the playerId is not valid
			}
		}

		if (data.type === 'chat') {
			if (!players[data.playerId]) {
				ServerLog(`[WARN] Invalid playerId: ${data.playerId}. Ignoring message.`);
				return;  // Ignore the message if the playerId is invalid
			}

			// Check if the message length exceeds 64 characters
			if (data.message.length > 64) {
				ws.send(JSON.stringify({ type: 'chat', playerId: 0, name: "SYSTEM", message:"message too long" }));
				ServerLog(`[WARN] Message too long: ${data.message}. Ignoring message.`);
				return;  // Ignore the message if it's too long
			}

			ServerLog("[INFO]","name="+players[ws.playerId].name + " id=" + data.playerId + " : " + data.message);
			broadcast({ type: 'chat', playerId: data.playerId, name: players[data.playerId].name, message: data.message });

			/*if(data.message=="FREE COINS")
			{
				let coinlevel="";
				let X = 50; // HOW MANY COIN

				for (let i = 0; i < X; i++) {
					//console.log("This will repeat " + X + " times. Current iteration: " + i);
					coinlevel+="19,"+(120*i)+",0,0;19,"+(120*i)+",-120,0;19,"+(120*i)+",-240,0;1,"+(120*i)+",300,0;";
				}
				ws.send(JSON.stringify({
					type: "loadlevel",
					ldata: coinlevel
				}));
				ws.send(JSON.stringify({ type: 'chat', playerId: 0, name: "SYSTEM", message:"chat '!return' to go back to the main level" }));
			}*/

			if(data.message=="!return")
			{
				ws.send(JSON.stringify({
					type: "loadlevel",
					ldata: currentLevel
				}));
			}
		}

		if (data.type === 'missilec') {
			console.log("MissileEvent");
			broadcast({
				type: "missile",
				playerId: data.playerId,
				x: data.x,
				y: data.y,
				angle: data.angle
			}, ws);
		}

	});

	ws.on('close', () => {
		if (ws.playerId && players[ws.playerId]) {
			broadcast({ type: 'player_left', playerId: ws.playerId });
			broadcast({ type: 'chat', playerId: 0, name: "SYSTEM", message: players[ws.playerId].name + " Left" });
			ServerLog(`[INFO] name=${players[ws.playerId].name} id=${ws.playerId} PlayerLeave`);
			delete players[ws.playerId];
		} else {
			ServerLog('[ERROR]No playerId found or player already removed.');
		}
	});

});

function broadcast(data, excludeWs = null) {
	wss.clients.forEach((client) => {
		if (client !== excludeWs && client.readyState === WebSocket.OPEN) {
			client.send(JSON.stringify(data));
		}
	});
}
server.listen(Port, () => {
	ServerLog('[INFO] game server running on port '+Port);
});
