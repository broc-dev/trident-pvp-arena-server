import { Room, Client } from "colyseus";
import { AbstractObject, ArenaRoomState, HitboxDebug, Player } from "./schema/ArenaRoomState";
import { ArcadePhysics } from 'arcade-physics';
import { Body } from 'arcade-physics/lib/physics/arcade/Body';
import { StaticBody } from "arcade-physics/lib/physics/arcade/StaticBody";
import SingularityMap from "../maps/SingularityMap";

const DEBUG_ENABLED = true; // set to false in production build

const MAP_DATA = SingularityMap;

const PLAYER_BODY = {
  width: 20,
  height: 46,
  originX: 0.5,
  originY: 1
};

const OBJECT_BODIES: Record<string, any> = {
  'sword': {
    width: 25,
    height: 6,
    originX: 0,
    originY: 0.5
  }
};

const MS_PER_FRAME = 37;

const SWORD_ATTACK_FRAME_XOFFSETS: Array<number> = [
  // 0,
  1,
  4,
  16,
  16,
  4,
  1
];

const FPS = 60;

const LUNGE_VELOCITY = 120;

const SWORD_BOUNCEBACK = 120;
const SWORD_BOUNCEBACK_DELAY = 150;

const MAX_SPEED = 360;
const ACCELERATION = 30;

const GRAVITY = 1400;

const PLAYER_JUMP_FORCE = 600;

const THROW_VELOCITY = 700;
const DISARM_VELOCITY = 200;

export class ArenaRoom extends Room<ArenaRoomState> {

  maxClients: number = 2;
  physicsBodies: Record<string, Body> = {};
  playerColliders: Record<string, any> = {};
  physics: ArcadePhysics = null;
  physicsTick: number = 0;
  physicsMap: Array<StaticBody> = [];

  createPhysicsBody(id: string, x: number, y: number, width: number, height: number) {
    this.physicsBodies[id] = this.physics.add.body(x, y, width, height);
    
    if (DEBUG_ENABLED) {
      this.state.hitboxDebug.set(id, new HitboxDebug(id, x, y, width, height));
    }
  }

  getOtherPlayerID(sessionId: string): string {
    let otherPlayerID = '';

    Object.keys(this.physicsBodies).forEach((key) => {
      if (!key.startsWith('sword_') && key !== sessionId) {
        otherPlayerID = key;
      }
    });

    return otherPlayerID;
  }

  killPlayer(playerID: string) {
    const player = this.state.players.get(playerID);

    // Prevent movement after death
    this.physicsBodies[playerID].setVelocityX(0);

    // Lock player to "dead state" (will also triger animation)
    player.isDead = true;
  }

  doAttack(playerID: string) {
    const player = this.state.players.get(playerID);
    
    // Lock input
    player.isInputLocked = true;

    // Move in direction of attack
    const dir = (player.flipX ? -1 : 1);

    this.physicsBodies[playerID].setVelocityX(dir * LUNGE_VELOCITY);

    // Adjust sword hitbox by mapped xoffset / frame
    let frame = 0;
    const hitboxShiftInterval = this.clock.setInterval(() => {
      player.xSwordOffset = SWORD_ATTACK_FRAME_XOFFSETS[frame];
      frame++;
    }, MS_PER_FRAME);

    // Clear after last frame
    this.clock.setTimeout(() => {
      player.xSwordOffset = 0;
      hitboxShiftInterval.clear();
      player.isInputLocked = false;
    }, MS_PER_FRAME * SWORD_ATTACK_FRAME_XOFFSETS.length);
  }

  onCreate (options: any) {
    this.setState(new ArenaRoomState());

    this.onMessage('change-stance', (client: Client, data: Record<string, string>) => {
      const {direction} = data;
      const {sessionId: playerID} = client;
      const player = this.state.players.get(playerID);
      const hasSword = (player.animPrefix === 'sword');

      if (!player.isDead && hasSword) {
        // Get enemy
        const enemyID = this.getOtherPlayerID(playerID);
        const enemy = this.state.players.get(enemyID);
        const hasEnemyWithSword = (enemyID !== '' && enemy.animPrefix === 'sword');

        // Get swords
        const playerSword = this.physicsBodies[`sword_${playerID}`];
        const enemySword = this.physicsBodies[`sword_${enemyID}`];
  
        if (direction === 'up') {
          if (player.level === 'low') {
            player.level = 'mid';
          }
          else if (player.level === 'mid') {
            player.level = 'high';
          }
        }
        else if (direction === 'down') {
          if (player.level === 'high') {
            player.level = 'mid';
          }
          else if (player.level === 'mid') {
            player.level = 'low';
          }
        }

        // Reposition physics body of sword based on new level
        this.moveHeldSwords();

        if (hasEnemyWithSword) {
          const areSwordsTouching = this.physics.overlap(playerSword, enemySword, null, null, this);
          
          if (areSwordsTouching) {
            const swordID = `sword_${enemyID}`;
            const sword = this.state.objects.get(swordID);

            // Disarm enemy
            enemy.animPrefix = 'nosword';
            
            // Set sword texture to active
            sword.isTextureVisible = true;
    
            // Flip sword according to player
            sword.flipX = enemy.flipX;
    
            // Set sword body velocity (*(+/-)1(flipX?))
            this.physicsBodies[swordID].setVelocityY((direction === 'up' ? -1 : 1) * DISARM_VELOCITY);

            // Enable gravity on sword
            this.physicsBodies[swordID].setAllowGravity(true);
    
            // Add collider w/ map so sword will land
            this.physics.add.collider(this.physicsBodies[swordID], this.physicsMap);

            this.broadcast('camera-flash');
          }
        }
      }
    });

    this.onMessage('keyboard-input', (client: Client, input: Record<string, boolean>) => {
      const {up, left, right, attack: doAttack, jump} = input;
      const playerBody = this.physicsBodies[client.sessionId];
      const player = this.state.players.get(client.sessionId);
      const enemyID = this.getOtherPlayerID(client.sessionId);
      const isGrounded = (playerBody.blocked.down);

      if (!player.isDead && !player.isInputLocked) {
        // Attack (or throw attack)
        const hasSword = (player.animPrefix === 'sword');
        const throwReady = (player.level === 'high' && up);
        const doThrowAttack = (throwReady && doAttack);
  
        if (isGrounded && hasSword && doThrowAttack) {
          const swordID = `sword_${client.sessionId}`;
  
          const sword = this.state.objects.get(swordID);

          // Enable sword texture
          sword.isTextureVisible = true;
  
          // Flip sword according to player
          sword.flipX = player.flipX;
  
          // Disable gravity when thrown
          this.physicsBodies[swordID].setAllowGravity(false);
  
          // Add overlap calls w/ other player
          this.physics.add.overlap(this.physicsBodies[swordID], this.physicsBodies[enemyID], () => {
            this.killPlayer(enemyID);
          });
  
          // Set sword body velocity (*(+/-)1(flipX?))
          this.physicsBodies[swordID].setVelocityX((sword.flipX ? -1 : 1) * THROW_VELOCITY);
  
          // Set animPrefix to nosword (done in anim code below)
        }
        else if (isGrounded && doAttack) {
          this.broadcast('player-attack', {
            playerID: client.sessionId,
            hasSword,
            level: player.level
          });

          player.velX = 0;
          playerBody.setVelocityX(0);

          this.doAttack(client.sessionId);
        }
        // Move / Idle / Default animation logic
        else if (!throwReady) {
          // L/R movement
          if (left) {
            if (player.velX > -MAX_SPEED) {
              player.velX -= ACCELERATION;
            }
            else if (player.velX === -MAX_SPEED) {
              player.flipX = true;
            }
          }
          else if (right) {
            if (player.velX < MAX_SPEED) {
              player.velX += ACCELERATION;
            }
            else if (player.velX === MAX_SPEED) {
              player.flipX = false;
            }
          }
          else {
            player.velX = 0;

            if (enemyID !== '') {
              const enemy = this.state.players.get(enemyID);
              
              if (enemy.x <= player.x) {
                player.flipX = true;
              }
              else {
                player.flipX = false;
              }
            }
          }
    
          // Jump
          if (jump && isGrounded) {
            playerBody.setVelocityY(-PLAYER_JUMP_FORCE);
          }
  
          // Apply velocity for movement
          playerBody.setVelocityX(player.velX);
        }
  
        // Animation logic
        if (hasSword && isGrounded && doThrowAttack) {
          player.animMode = 'play-once';
          player.anim = 'sword-throw-attack';
          player.animPrefix = 'nosword'; // Must be changed AFTER sending anim key
        }
        else if (hasSword && isGrounded && throwReady) {
          player.animMode = 'play-hold';
          player.anim = `sword-throw-ready`;
        }
        else if (isGrounded) {
          player.animMode = 'loop';
  
          if (player.velX === 0) {
            if (hasSword) {
              player.anim = `${player.animPrefix}-idle-${player.level}`;
            }
            else {
              player.anim = `${player.animPrefix}-idle`;
            }
          }
          else if (
            player.flipX && player.velX < 0 && player.velX > -MAX_SPEED ||
            !player.flipX && player.velX > 0 && player.velX < MAX_SPEED
          ) {
            if (hasSword) {
              player.anim = `${player.animPrefix}-forstep-${player.level}`;
            }
            else {
              player.anim = `${player.animPrefix}-forstep`;
            }
          }
          else if (
            player.flipX && player.velX > 0 && player.velX < MAX_SPEED ||
            !player.flipX && player.velX < 0 && player.velX > -MAX_SPEED
          ) {
            if (hasSword) {
              player.anim = `${player.animPrefix}-backstep-${player.level}`;
            }
            else {
              player.anim = `${player.animPrefix}-backstep`;
            }
          }
          else if (player.velX === MAX_SPEED || player.velX === -MAX_SPEED) {
            player.anim = `${player.animPrefix}-run`;
          }
        }
        else {
          player.animMode = 'loop';
          player.anim = `${player.animPrefix}-flip`;
        }
      }
      else if (player.isInputLocked) {
        // Could put custom anims here or something
      }
      else if (player.isDead) {
        player.animMode = 'play-once';
        player.anim = `death-stand`;
      }
    });

    // Init arcade physics
    const config = {
      sys: {
        game: {
          config: {}
        },
        settings: {
          physics: {
            debug: true,
            gravity: {
              x: 0,
              y: GRAVITY
            }
          }
        },
        scale: {
          width: 2400 * 2,
          height: 1200
        },
        queueDepthSort: () => {}
      }
    };

    this.physics = new ArcadePhysics(config);
    this.physicsTick = 0;

    // this.physics.add.

    // Generate map bodies (TODO, single platform to start)
    // this.physicsMap[0] = this.physics.add.staticBody((0 - (2400 / 2)), (300 - (100 / 2)), 2400, 100);
    // this.physicsMap[1] = this.physics.add.staticBody((2400 - (2400 / 2)), (200 - (100 / 2)), 2400, 100);

    for (let y = 0; y < MAP_DATA.height; y++) {
      for (let x = 0; x < MAP_DATA.width; x++) {
        const px = (x * MAP_DATA.tile_width);
        const py = (y * MAP_DATA.tile_height);
        const i = (y * MAP_DATA.width + x);
        const isBlocking = (MAP_DATA.collision_map[i] === 1);

        if (isBlocking) {
          this.physicsMap = [
            ...this.physicsMap,
            this.physics.add.staticBody(px, py, MAP_DATA.tile_width, MAP_DATA.tile_height)
          ];
        }
      }
    }

    // Add collision detection in onJoin

    this.setSimulationInterval((deltaTime) => this.update(deltaTime));

    console.log("room", this.roomId, "created...");
  }

  update(deltaTime: any) {
    this.physics.world.update(this.physicsTick * 1000, 1000 / FPS);
    this.physicsTick++;

    this.moveHeldSwords();
    this.syncStateWithPhysics();
    this.syncHitboxDebug();
  }

  syncHitboxDebug() {
    this.state.hitboxDebug.forEach((hitbox, id) => {
      const body = this.physicsBodies[id];
      hitbox.x = body.x;
      hitbox.y = body.y;
    });
  }

  moveHeldSwords() {
    this.state.players.forEach((player, playerID) => {
      const isPlayerHoldingSword = (player.animPrefix === 'sword');
      const sword = this.state.objects.get(`sword_${playerID}`);
      const hitboxDebug = this.state.hitboxDebug.get(`sword_${playerID}`);

      hitboxDebug.isActive = sword.isTextureVisible; // If the texture is visible, it means it's been parried or thrown

      if (isPlayerHoldingSword) {
        const player = this.state.players.get(playerID);

        const isSwordOutAnim = (
          player.anim.startsWith('sword-idle') ||
          player.anim.startsWith('sword-forstep') ||
          player.anim.startsWith('sword-backstep')
        );

        sword.isActive = isSwordOutAnim;
        hitboxDebug.isActive = isSwordOutAnim;

        if (isSwordOutAnim) {
          // Sync / offset sword in idle & stepping anims
          const playerBody = this.physicsBodies[playerID];
          const swordBody = this.physicsBodies[`sword_${playerID}`];
          const playerX = (playerBody.x + (PLAYER_BODY.width * PLAYER_BODY.originX));
          const playerY = (playerBody.y + (PLAYER_BODY.height * PLAYER_BODY.originY));
          const flipMod = (player.flipX ? -1 : 1);
          const flipOffset = (player.flipX ? swordBody.width : 0);

          // WARNING -- MAGIC NUMBERS INCOMING
          if (player.level === 'low') {
            swordBody.x = playerX + (10 * flipMod) - flipOffset;
            swordBody.y = playerY - 20;
          }
          else if (player.level === 'mid') {
            swordBody.x = playerX + (8 * flipMod) - flipOffset;
            swordBody.y = playerY - 28;
          }
          else if (player.level === 'high') {
            swordBody.x = playerX + (8 * flipMod) - flipOffset;
            swordBody.y = playerY - 40;
          }

          // Adjust for additional x offset
          swordBody.x += (player.xSwordOffset * flipMod);
        }
      }
    });
  }

  syncStateWithPhysics() {
    this.state.players.forEach((player, sessionId) => {
      const physicsBodyExists = (typeof this.physicsBodies[sessionId] !== 'undefined');
      
      if (physicsBodyExists) {
        const body = this.physicsBodies[sessionId];
        
        player.x = (body.x + (PLAYER_BODY.width * PLAYER_BODY.originX));
        player.y = (body.y + (PLAYER_BODY.height * PLAYER_BODY.originY));
      }
    });

    this.state.objects.forEach((obj, objID) => {
      const physicsBodyExists = (typeof this.physicsBodies[objID] !== 'undefined');

      if (physicsBodyExists) {
        const {texture: t} = obj;
        const body = this.physicsBodies[objID];
        
        obj.x = (body.x + (obj.flipX ? -1 : 1 * OBJECT_BODIES[t].width * OBJECT_BODIES[t].originX));
        obj.y = (body.y) + (OBJECT_BODIES[t].height * OBJECT_BODIES[t].originY);
      }
    });
  }

  onJoin (client: Client, options: any) {
    console.log(client.sessionId, "joined!");

    // Add state object for player
    this.state.players.set(client.sessionId, new Player(
      options.playerName,
      client.sessionId,
      PLAYER_BODY.width,
      PLAYER_BODY.height
    ));

    // Add body for player
    this.createPhysicsBody(
      client.sessionId,
      MAP_DATA.room_boundaries['L0'],
      0,
      PLAYER_BODY.width,
      PLAYER_BODY.height
    );

    // Add state object for sword
    this.state.objects.set(`sword_${client.sessionId}`, new AbstractObject(
      `sword_${client.sessionId}`,
      MAP_DATA.room_boundaries['L0'],
      0,
      OBJECT_BODIES['sword'].width,
      OBJECT_BODIES['sword'].height,
      OBJECT_BODIES['sword'].originX,
      OBJECT_BODIES['sword'].originY,
      'sword'
    ));

    // Add body for sword
    this.createPhysicsBody(
      `sword_${client.sessionId}`,
      MAP_DATA.room_boundaries['L0'],
      0,
      OBJECT_BODIES['sword'].width,
      OBJECT_BODIES['sword'].height
    );

    // Disable gravity on the sword body
    this.physicsBodies[`sword_${client.sessionId}`].setAllowGravity(false);

    // Add player v map collision detection
    this.playerColliders[client.sessionId] = this.physics.add.collider(
      this.physicsBodies[client.sessionId],
      this.physicsMap
    );

    // If both players have spawned, register sword overlaps
    const enemyID = this.getOtherPlayerID(client.sessionId);

    if (enemyID !== '') {
      const player = this.state.players.get(client.sessionId);
      const enemy = this.state.players.get(enemyID);
      const playerBody = this.physicsBodies[client.sessionId];
      const enemyBody = this.physicsBodies[enemyID];
      const playerSword = this.physicsBodies[`sword_${client.sessionId}`];
      const enemySword = this.physicsBodies[`sword_${enemyID}`];

      // Player sword vs enemy body
      this.physics.add.overlap(playerSword, enemyBody, () => {
        const swordIsHot = (typeof player !== 'undefined' && (player.animPrefix === 'sword' || playerSword.velocity.x !== 0));

        if (swordIsHot) {
          this.killPlayer(enemyID);
        }
      });

      // Enemy sword vs player body
      this.physics.add.overlap(enemySword, playerBody, () => {
        const swordIsHot = (typeof enemy !== 'undefined' && (enemy.animPrefix === 'sword' || enemySword.velocity.x !== 0));

        if (swordIsHot) {
          this.killPlayer(client.sessionId);
        }
      });

      // Sword vs sword (same-level knocback)
      this.physics.add.overlap(playerSword, enemySword, () => {
        const doBounce = (player.animPrefix === 'sword' && enemy.animPrefix === 'sword' && player.level === enemy.level);

        if (doBounce) {
          const playerDir = (player.flipX ? 1 : -1);
          const enemyDir = (enemy.flipX ? 1 : -1);

          playerBody.setVelocityX(SWORD_BOUNCEBACK * playerDir);
          enemyBody.setVelocityX(SWORD_BOUNCEBACK * enemyDir);

          player.isInputLocked = true;
          enemy.isInputLocked = true;

          this.clock.setTimeout(() => {
            player.isInputLocked = false;
            enemy.isInputLocked = false;
          }, SWORD_BOUNCEBACK_DELAY);
        }
      });
    }
  }

  onLeave (client: Client, consented: boolean) {
    console.log(client.sessionId, "left!");

    // Delete state reference
    this.state.players.delete(client.sessionId);

    // Delete hitboxDebug reference
    this.state.hitboxDebug.delete(client.sessionId);

    // Destroy & delete physics body
    this.physicsBodies[client.sessionId].destroy();
    delete this.physicsBodies[client.sessionId];
  }

  onDispose() {
    console.log("room", this.roomId, "disposing...");
  }

}
