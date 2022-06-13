import { Schema, MapSchema, type } from "@colyseus/schema";

export class Player extends Schema {
  @type('number')
  x: number = 0;

  @type('number')
  y: number = 0;

  @type('number')
  width: number = 0;

  @type('number')
  height: number = 0;

  @type('string')
  anim: string = 'sword-idle-mid';

  @type('string')
  level: string = 'mid';

  @type('boolean')
  flipX: boolean = false;

  @type('string')
  playerName: string = '';

  @type('string')
  id: string = '';

  constructor(playerName: string, id: string, width: number, height: number) {
    super();
    this.playerName = playerName;
    this.id = id;
    this.width = width;
    this.height = height;
  }
}

export class ArenaRoomState extends Schema {

  @type({ map: Player })
  players = new MapSchema<Player>();

}
