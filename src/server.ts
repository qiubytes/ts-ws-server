import { stringify } from 'node:querystring';
import WebSocket from 'ws';

const wss = new WebSocket.Server({ port: 3000 });
console.log('WebSocket 服务器启动在 ws://localhost:3000');

//房间客户端状态
interface RoomClientProperty {
    state: 'NotReady' | 'Ready'  //玩家状态 未准备 准备
}
// 房间数据结构
interface Room {
    count: number;
    roomState: string | 'Ready' | 'Play'; //准备当中   游戏中
    clients: Set<string>;  //存入客户端ID
    clientsProperty: Map<string, RoomClientProperty>;
}

// 存储房间
const rooms = new Map<string, Room>();

//存储客户端
const clients = new Map<string, WebSocket>();

// 客户端消息结构
interface ClientMessage {
    type: 'join' | 'inc' | 'list' | 'getmyinfo' | 'getMyRoomInfo' | 'changeRoomClientState';
    roomId?: string;
    roomClientState?: string | 'NotReady' | 'Ready' //房间内客户端状态
}
//发送已加入房间 消息（服务端发送我的状态给我）
function sendRoomJoinedMsg(ws: WebSocket, roomId: string) {
    ws.send(JSON.stringify({ type: 'roomJoined', roomId: roomId }));
}
//发送已加入房间 消息（服务端发送房间内其他玩家的状态给我） 
function sendRoomOtherJoinedMsg(roomId: string, currentClientId: string) {
    let room: Room | undefined = rooms.get(roomId);
    room?.clients.forEach(id => {
        if (id != currentClientId) {
            clients.get(id)?.send(JSON.stringify({ type: 'roomOtherJoined', roomId: roomId, clientid: id }));
        }
    });
}
//发送已改变房间客户端状态消息 (发送给房间内所有玩家)
function sendRoomClientStateChanged(currentClientId: string, roomId: string, state: string) {
    
    rooms.get(roomId)?.clients.forEach(x => {
        clients.get(x)?.send(JSON.stringify({ type: 'RoomClientStateChanged', roomId: roomId, clientid: currentClientId, state: state }));
    });
    //检测是否全准备（是就开始游戏）
    let GameStartIng: boolean = false;

    GameStartIng = rooms.get(roomId)?.clientsProperty
        ? Array.from(rooms.get(roomId)?.clientsProperty.values() ?? []).every(st => st.state === 'Ready')
        : false; 
    //通知客户端开始游戏
    if (GameStartIng) {
        sendRoomState(roomId, 'Play');
    }
}
//发送房间状态 准备中（未准备或者部分准备）  开始游戏
function sendRoomState(roomId: string, roomState: string) {
    rooms.get(roomId)?.clients.forEach(id => {
        clients.get(id)?.send(JSON.stringify({ type: 'RoomStateChanged', roomId: roomId, roomState: roomState }));
    });
}
//发送已退出房间 消息（服务端发送房间内其他玩家的状态给我）  
// function sendRoomOtherOutJoinedMsg(roomId: string, currentClientId: string) {
//     let room: Room | undefined = rooms.get(roomId);
//     room?.clients.forEach(id => {
//         if (id != currentClientId) {
//             clients.get(id)?.send(JSON.stringify({ type: 'roomOtherOutJoined', roomId: roomId, clientid: id }));
//         }
//     });
// }
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
                        rooms.get(currentRoom)!.clients.delete(clientId);//删除房间内的客户端
                        rooms.get(currentRoom)!.clientsProperty.delete(clientId);//删除房间内的客户端状态
                    }
                    if (!roomId) return;
                    // 加入/创建新房间
                    if (!rooms.has(roomId)) {
                        rooms.set(roomId, { count: 0, clients: new Set(), roomState: 'Ready', clientsProperty: new Map<string, RoomClientProperty> });
                    }
                    const room = rooms.get(roomId)!;
                    room.clients.add(clientId);
                    room.clientsProperty.set(clientId, { state: "NotReady" })//设置房间客户端状态
                    currentRoom = roomId;
                    sendRoomJoinedMsg(ws, roomId);//给自己发送加入消息
                    sendRoomOtherJoinedMsg(roomId, clientId);//给其他玩家发送加入消息
                    // 发送当前计数
                    // ws.send(JSON.stringify({ type: 'state', count: room.clients.size }));
                    // console.log(`客户端加入房间 ${roomId}`);
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
                case 'list': //获取房间列表
                    {
                        let roomList: Array<{ roomId: string, joinedCount: number | undefined }> = new Array<{ roomId: string, joinedCount: number | undefined }>();

                        for (let key of rooms.keys()) {
                            roomList.push({ roomId: key, joinedCount: rooms.get(key)?.clients.size });
                        }
                        ws.send(JSON.stringify({ type: 'listroomdata', data: roomList }));
                    }
                    break;
                case "getmyinfo": //获取我的信息
                    {
                        ws.send(JSON.stringify({ type: 'myinfo', data: { clientid: clientId } }));
                    }
                    break;
                case "getMyRoomInfo": //获取房间内所有客户端信息
                    {
                        let room: Room | undefined = rooms.get(currentRoom ?? "");
                        let roomClients: Array<String> = new Array<String>();
                        room?.clients.forEach(id => {
                            roomClients.push(id);
                        });
                        ws.send(JSON.stringify({ type: 'MyRoomInfo', data: { clientid: clientId, clients: roomClients } }));
                    }
                    break;
                case "changeRoomClientState": //改变房间内客户端状态 未准备 已准备
                    {
                        let roomClientState: string | 'NotReady' | 'Ready' = msg.roomClientState ?? 'NotReady';
                        if (roomClientState != '') {
                            rooms.forEach(x => {
                                if (x.clients.has(clientId)) {
                                    let property: RoomClientProperty | undefined = x.clientsProperty.get(clientId);
                                    if (property != undefined) {
                                        property.state = roomClientState as 'NotReady' | 'Ready';
                                        sendRoomClientStateChanged(clientId, currentRoom ?? '', property.state);
                                    }
                                }
                            });
                        }
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
            room.clients.delete(clientId);//删除房间内的客户端
            room.clientsProperty.delete(clientId);//删除房间内的客户端状态
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