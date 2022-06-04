import { Schema, MapSchema, type } from "@colyseus/schema";

export class Player extends Schema {
  @type('number')
  x: number = 0;

  @type('number')
  y: number = 0;

  @type('string')
  playerName: string = '';

  @type('string')
  id: string = '';

  constructor(playerName: string, id: string) {
    super();
    this.playerName = playerName;
    this.id = id;
  }
}

export class ArenaRoomState extends Schema {

  @type({ map: Player })
  players = new MapSchema<Player>();

}
