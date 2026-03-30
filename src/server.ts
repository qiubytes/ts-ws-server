import { stringify } from 'node:querystring';
import WebSocket from 'ws';

const wss = new WebSocket.Server({ port: 3000 });
console.log('WebSocket 服务器启动在 ws://localhost:3000');

//房间客户端状态
interface RoomClientProperty {
    state: string | 'NotReady' | 'Ready'; //玩家状态 未准备 准备
    score: number;  //玩家分数(每轮分数的累计)
}
// 房间数据结构
interface Room {
    count: number;
    roomState: string | 'Ready' | 'Play'; //准备当中   游戏中
    clients: Set<string>;  //存入客户端ID
    clientsProperty: Map<string, RoomClientProperty>; //房间客户端状态

    //每轮游戏数据
    roundState: {
        playerResult: Map<string, string | 'scissors' | 'rock' | 'paper'>,  //客户端ID  猜拳结果 剪刀 石头 布 Scissors, rock, paper
        currentClientId: string,  //当前该谁出牌（客户端ID）
        roundWinnerId: string //赢家ID 
        isContinue: Set<string>  //一轮完了后  玩家是否点击继续（ToDo现在是直接延迟几秒  直接下一轮，这里后续进行改造）
    }
}

// 存储房间
const rooms = new Map<string, Room>();

//存储客户端
const clients = new Map<string, WebSocket>();

// 客户端消息结构
interface ClientMessage {
    type: 'join' | 'inc' | 'list' | 'getmyinfo' | 'getMyRoomInfo' | 'changeRoomClientState' | 'playingData';
    roomId?: string;
    roomClientState?: string | 'NotReady' | 'Ready';//房间内客户端状态
    playingData?: string | 'scissors' | 'rock' | 'paper'  //出牌数据
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
    //客户端属性转数组
    let clientProperties: RoomClientProperty[] = rooms.get(roomId)?.clientsProperty
        ? Array.from(rooms.get(roomId)?.clientsProperty.values() ?? []) : [];

    GameStartIng = clientProperties.every(st => st.state === 'Ready')
        && clientProperties.length > 1
        ? true : false;
    //通知客户端开始游戏
    if (GameStartIng) {
        sendRoomState(roomId, 'Play');
    }
}
//发送房间状态 准备中（未准备或者部分准备）  开始游戏！！！
function sendRoomState(roomId: string, roomState: string) {
    rooms.get(roomId)?.clients.forEach(id => {
        clients.get(id)?.send(JSON.stringify({ type: 'RoomStateChanged', roomId: roomId, roomState: roomState }));
    });
    //等待三秒选出一个当前出牌人
    randomTimeOutSelTurnToPlay(roomId);
}
//等待三秒选出一个当前出牌人
function randomTimeOutSelTurnToPlay(roomId: string) {

    setTimeout(() => {
        let cuRoom: Room | undefined = rooms.get(roomId);
        if (cuRoom != undefined) {
            let arrclient: string[] = Array.from(cuRoom?.clients);
            let index: number = getRandomInt(arrclient.length - 1);
            cuRoom.roundState.currentClientId = arrclient[index];
            let clientws: WebSocket | undefined = clients.get(cuRoom.roundState.currentClientId);
            if (clientws != undefined) {
                //一个人出牌
                sendIsYouTurnToPlay(clientws);
                //其余人等待 
                let targetArr: string[] = Array.from(cuRoom.clients).filter(o => o != cuRoom.roundState.currentClientId);
                targetArr.forEach(x => {
                    sendIsYouWaitPlay(clients.get(x) as WebSocket);
                });
            }
        }
    }, 3000);
}
//该你出牌
function sendIsYouTurnToPlay(clientws: WebSocket) {
    clientws.send(JSON.stringify({ type: 'isYouTurnToPlay' }));
}
//该你等待（对方出牌）
function sendIsYouWaitPlay(clientws: WebSocket) {
    clientws.send(JSON.stringify({ type: 'isYouWaitPlay' }));
}
//发送此轮结局  result  赢家ID  或者 draw平局  myscore 我的分数 opponentscore 对方分数
function sendThisRoundResult(clientws: WebSocket, result: string, mysocre: number, opponentscore: number) {
    clientws.send(JSON.stringify({ type: 'roundResult', result: result, mysocre: mysocre, opponentscore: opponentscore }));
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

//生成 -max的随机整数
function getRandomInt(max: number) {
    return Math.floor(Math.random() * (max + 1));
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
                        rooms.get(currentRoom)!.clients.delete(clientId);//删除房间内的客户端
                        rooms.get(currentRoom)!.clientsProperty.delete(clientId);//删除房间内的客户端状态
                    }
                    if (!roomId) return;
                    // 加入/创建新房间
                    if (!rooms.has(roomId)) {
                        rooms.set(roomId, {
                            count: 0, clients: new Set(),
                            roomState: 'Ready',
                            clientsProperty: new Map<string, RoomClientProperty>,
                            roundState: {
                                playerResult: new Map<string, string | 'scissors' | 'rock' | 'paper'>,  //客户端ID  猜拳结果 剪刀 石头 布 Scissors, rock, paper
                                currentClientId: '',  //当前该谁出牌（客户端ID）
                                roundWinnerId: '',//赢家ID 
                                isContinue: new Set<string>
                            }
                        });
                    }
                    const room = rooms.get(roomId)!;
                    room.clients.add(clientId);
                    room.clientsProperty.set(clientId, { state: "NotReady", score: 0 })//设置房间客户端状态,默认分数0
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
                case "playingData":  //接收到 出牌数据
                    {
                        let troom: Room | undefined = rooms.get(currentRoom ?? '');
                        if (troom?.roundState.currentClientId == clientId) {
                            const playingdata = msg.playingData;
                            troom?.roundState.playerResult.set(clientId, playingdata ?? ''); //存入本轮数据
                            if (troom?.roundState.playerResult.size == 2) {
                                //本轮结算
                                let player1: string = Array.from(troom.clients)[0];//玩家1
                                let player2: string = Array.from(troom.clients)[1];//玩家2
                                let player1result: string = troom.roundState.playerResult.get(player1) as string;//玩家1结果
                                let player2result: string = troom.roundState.playerResult.get(player2) as string;//玩家1结果

                                // 平局
                                if (player1result === player2result) {
                                    //平局
                                    troom.roundState.roundWinnerId = "draw";
                                } else if (
                                    (player1result === "scissors" && player2result === "paper") ||
                                    (player1result === "rock" && player2result === "scissors") ||
                                    (player1result === "paper" && player2result === "rock")
                                ) {
                                    //player1赢
                                    troom.roundState.roundWinnerId = player1;
                                    //累计分数
                                    let rcprop: RoomClientProperty;
                                    if (rcprop = troom.clientsProperty.get(player1) as RoomClientProperty) {
                                        rcprop.score++;
                                    }
                                } else {
                                    //player2赢
                                    troom.roundState.roundWinnerId = player2;
                                    //累计分数
                                    let rcprop: RoomClientProperty;
                                    if (rcprop = troom.clientsProperty.get(player2) as RoomClientProperty) {
                                        rcprop.score++;
                                    }
                                }
                                //发送本轮结果
                                let player1property: RoomClientProperty = troom.clientsProperty.get(player1) as RoomClientProperty;
                                let player2property: RoomClientProperty = troom.clientsProperty.get(player2) as RoomClientProperty;

                                sendThisRoundResult(clients.get(player1) as WebSocket, troom.roundState.roundWinnerId, player1property.score, player2property.score);
                                sendThisRoundResult(clients.get(player2) as WebSocket, troom.roundState.roundWinnerId, player2property.score, player1property.score);
                                //等待三秒选出一个当前出牌人
                                troom.roundState.playerResult.clear();//清除这轮的对战数据
                                randomTimeOutSelTurnToPlay(currentRoom ?? '');

                            } else {
                                //通知下一个玩家出牌
                                let targetclientid: string = '';
                                troom.clients.forEach(x => {
                                    if (x != clientId) {
                                        targetclientid = x;
                                    }
                                });
                                troom.roundState.currentClientId = targetclientid;
                                let targetws: WebSocket = clients.get(targetclientid) as WebSocket;
                                //一人出牌
                                sendIsYouTurnToPlay(targetws);
                                //其余人等待
                                let targetArr: string[] = Array.from(troom.clients).filter(o => o != troom.roundState.currentClientId);
                                targetArr.forEach(x => {
                                    sendIsYouWaitPlay(clients.get(x) as WebSocket);
                                });
                            }
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