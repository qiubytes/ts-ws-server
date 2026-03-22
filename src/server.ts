import WebSocket from 'ws';

const wss = new WebSocket.Server({ port: 3000 });
console.log('WebSocket 服务器启动在 ws://localhost:3000');

// 房间数据结构
interface Room {
    count: number;
    clients: Set<string>;  //存入客户端ID
}

// 存储房间
const rooms = new Map<string, Room>();

//存储客户端
const clients = new Map<string, WebSocket>();

// 客户端消息结构
interface ClientMessage {
    type: 'join' | 'inc' | 'list';
    roomId?: string;
}

wss.on('connection', (ws: WebSocket) => {
    console.log('新客户端连接');
    let currentRoom: string | null = null;
    //生成客户端ID
    const clientId = Date.now() + '-' + Math.floor(Math.random() * 10000);
    clients.set(clientId, ws);

    ws.on('message', (data: WebSocket.Data) => {
        try {
            const msg: ClientMessage = JSON.parse(data.toString());
            const { type, roomId } = msg;

            switch (type) {
                case 'join':
                    // 离开旧房间
                    if (currentRoom && rooms.has(currentRoom)) {
                        rooms.get(currentRoom)!.clients.delete(clientId);
                    }
                    if (!roomId) return;
                    // 加入/创建新房间
                    if (!rooms.has(roomId)) {
                        rooms.set(roomId, { count: 0, clients: new Set() });
                    }
                    const room = rooms.get(roomId)!;
                    room.clients.add(clientId);
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
                        room.clients.forEach(clientid => {
                            if (clients.get(clientid)?.readyState === WebSocket.OPEN) {
                                clients.get(clientid)?.send(broadcastMsg);
                            }
                        });
                        console.log(`房间 ${currentRoom} 计数 => ${room.count}`);
                    }
                    break;
                case 'list':
                    {
                        let roomList: Array<{ roomId: string, joinedCount: number | undefined }> = new Array<{ roomId: string, joinedCount: number | undefined }>();

                        for (let key of rooms.keys()) {
                            roomList.push({ roomId: key, joinedCount: rooms.get(key)?.clients.size });
                        }
                        ws.send(JSON.stringify({ type: 'listroomdata', data: roomList }));
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
            room.clients.delete(clientId);
            if (room.clients.size === 0) {
                rooms.delete(currentRoom);
                console.log(`房间 ${currentRoom} 已销毁`);
            }
        }
        //删除客户端集合
        clients.delete(clientId);
        console.log('客户端断开');
    });
});