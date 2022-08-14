import { Schema, MapSchema, type } from "@colyseus/schema";
import { matchMaker } from "colyseus";

export class HitboxDebug extends Schema {
  @type('string')
  id: string = '';

  @type('number')
  x: number = 0;

  @type('number')
  y: number = 0;

  @type('number')
  width: number = 0;

  @type('number')
  height: number = 0;

  @type('boolean')
  isActive: boolean = true;

  @type('boolean')
  isLethal: boolean = false;

  @type('string')
  type: string = '';

  constructor(id: string, x: number, y: number, width: number, height: number, type: string) {
    super();
    this.id = id;
    this.x = x;
    this.y = y;
    this.width = width;
    this.height = height;
    this.type = type;
  }
}

export class AbstractObject extends Schema {
  @type('string')
  id: string = '';

  @type('number')
  x: number = 0;

  @type('number')
  y: number = 0;

  @type('number')
  width: number = 0;

  @type('number')
  height: number = 0;

  @type('number')
  originX: number = 0.5;

  @type('number')
  originY: number = 0.5;

  @type('boolean')
  flipX: boolean = false;

  @type('string')
  texture: string = '';

  @type('boolean')
  isTextureVisible: boolean = false;

  @type('boolean')
  isActive: boolean = true;

  @type('boolean')
  isLethal: boolean = false;

  @type('string')
  attachedTo: string = '';

  constructor(id: string, x: number, y: number, width: number, height: number, originX: number, originY: number, texture: string, attachedTo: string) {
    super();
    this.id = id;
    this.x = x;
    this.y = y;
    this.width = width;
    this.height = height;
    this.originX = originX;
    this.originY = originY;
    this.texture = texture;
    this.attachedTo = attachedTo;
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

  @type('string')
  winRoom: string = '';

  @type('number')
  velX: number = 0;

  @type('number')
  velY: number = 0;

  @type('boolean')
  isDead: boolean = false;

  @type('boolean')
  isJumping: boolean = false;

  @type('boolean')
  isRolling: boolean = false;

  @type('boolean')
  isGrounded: boolean = true;

  @type('number')
  xSwordOffset: number = 0;

  @type('number')
  xPunchOffset: number = 0;

  @type('number')
  xFootOffset: number = 0;

  @type('boolean')
  isInputLocked: boolean = false;

  @type('boolean')
  hasSword: boolean = true;

  @type('boolean')
  isAttacking: boolean = false;

  @type('boolean')
  isKicked: boolean = false;

  @type('boolean')
  isFallenDown: boolean = false;

  @type('string')
  color: string = '';

  constructor(playerName: string, id: string, width: number, height: number, color: string) {
    super();
    this.playerName = playerName;
    this.id = id;
    this.width = width;
    this.height = height;
    this.color = color;
  }
}

export class ArenaRoomState extends Schema {

  @type({ map: Player })
  players = new MapSchema<Player>();

  @type({ map: AbstractObject })
  objects = new MapSchema<AbstractObject>();

  @type('string')
  chatRoomID: string = '';

  @type({ map: HitboxDebug })
  hitboxDebug = new MapSchema<HitboxDebug>();

}
