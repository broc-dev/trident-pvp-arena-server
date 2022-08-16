import { Schema, MapSchema, ArraySchema, type } from "@colyseus/schema";
import LobbyState from "../LobbyState";

export class ConnectedPlayer extends Schema {

  @type('boolean')
  isClientReady: boolean = false; // true if player has gameRoom ready on their client

  constructor(isClientReady: boolean = false) {
    super();

    this.isClientReady = isClientReady;
  }
}

export class OpenMatch extends Schema {
  
  @type('string')
  roomID: string = "";

  @type('string')
  creatorName: string = "";

  @type('string')
  gameMode: string = "";

  @type('number')
  playerCount: number = 0;

  @type('number')
  maxPlayerCount: number = 0;

  @type('number')
  timestamp: number = 0;

  @type('boolean')
  locked: boolean = false;

  @type('boolean')
  started: boolean = false;

  @type({ map: ConnectedPlayer })
  connectedPlayers = new MapSchema<ConnectedPlayer>();

  constructor(roomID: string, creatorName: string, gameMode: string, time: number) {
    super();

    this.roomID = roomID;
    this.creatorName = creatorName;
    this.gameMode = gameMode;
    this.playerCount = 1;
    this.timestamp = time;

    LobbyState.matches.push(roomID);

    if (gameMode === 'Fencing PvP') {
      this.maxPlayerCount = 2;
    }
    else if (gameMode === 'Raids PvP') {
      this.maxPlayerCount = 4;
    }
  }

}

export class LobbyRoomState extends Schema {

  @type({ map: OpenMatch })
  openMatches = new MapSchema<OpenMatch>();

  @type('number')
  onlinePlayers: number = 0;

}