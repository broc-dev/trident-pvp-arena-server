import { Schema, MapSchema, type } from "@colyseus/schema";

export class AbstractObject extends Schema {
  @type('string')
  id: string = '';

  @type('number')
  x: number = 0;

  @type('number')
  y: number = 0;

  @type('boolean')
  flipX: boolean = false;

  @type('string')
  texture: string = '';

  constructor(id: string, x: number, y: number, texture: string) {
    super();
    this.id = id;
    this.x = x;
    this.y = y;
    this.texture = texture;
  }
}

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
  animMode: string = 'loop'; // loop, play-hold, play-once
  
  @type('string')
  animNext: string = ''; // The key of the next anim to chain (when animMode = play-then-loop)

  @type('boolean')
  animLock: boolean = false;

  @type('string')
  animPrefix: string = 'sword';

  @type('string')
  level: string = 'mid';

  @type('boolean')
  flipX: boolean = false;

  @type('string')
  playerName: string = '';

  @type('string')
  id: string = '';

  @type('number')
  velX: number = 0;


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

  @type({ map: AbstractObject })
  objects = new MapSchema<AbstractObject>();

}
