import WebSocket from 'ws';

const wss = new WebSocket.Server({ port: 3000 });
console.log('WebSocket 服务器启动在 ws://localhost:3000');

// 房间数据结构
interface Room {
    count: number;
    clients: Set<WebSocket>;
}

// 存储房间
const rooms = new Map<string, Room>();

// 客户端消息结构
interface ClientMessage {
    type: 'join' | 'inc';
    roomId?: string;
}

wss.on('connection', (ws: WebSocket) => {
    console.log('新客户端连接');
    let currentRoom: string | null = null;

    ws.on('message', (data: WebSocket.Data) => {
        try {
            const msg: ClientMessage = JSON.parse(data.toString());
            const { type, roomId } = msg;

            switch (type) {
                case 'join':
                    // 离开旧房间
                    if (currentRoom && rooms.has(currentRoom)) {
                        rooms.get(currentRoom)!.clients.delete(ws);
                    }
                    if (!roomId) return;
                    // 加入/创建新房间
                    if (!rooms.has(roomId)) {
                        rooms.set(roomId, { count: 0, clients: new Set() });
                    }
                    const room = rooms.get(roomId)!;
                    room.clients.add(ws);
                    currentRoom = roomId;
                    // 发送当前计数
                    ws.send(JSON.stringify({ type: 'state', count: room.clients.size }));
                    console.log(`客户端加入房间 ${roomId}`);
                    break;

                case 'inc':
                    if (currentRoom && rooms.has(currentRoom)) {
                        const room = rooms.get(currentRoom)!;
                        room.count++;
                        const broadcastMsg = JSON.stringify({ type: 'state', count: room.count });
                        room.clients.forEach(client => {
                            if (client.readyState === WebSocket.OPEN) {
                                client.send(broadcastMsg);
                            }
                        });
                        console.log(`房间 ${currentRoom} 计数 => ${room.count}`);
                    }
                    break;
            }
        } catch (err) {
            console.error('解析消息出错:', err);
        }
    });

    ws.on('close', () => {
        if (currentRoom && rooms.has(currentRoom)) {
            const room = rooms.get(currentRoom)!;
            room.clients.delete(ws);
            if (room.clients.size === 0) {
                rooms.delete(currentRoom);
                console.log(`房间 ${currentRoom} 已销毁`);
            }
        }
        console.log('客户端断开');
    });
});