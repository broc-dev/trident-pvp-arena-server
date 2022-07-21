import { Room, Client, ServerError } from "colyseus";
import { AbstractObject, ArenaRoomState, HitboxDebug, Player } from "./schema/ArenaRoomState";
import { ArcadePhysics } from 'arcade-physics';
import { Body } from 'arcade-physics/lib/physics/arcade/Body';
import { StaticBody } from "arcade-physics/lib/physics/arcade/StaticBody";
import SingularityMap from "../maps/SingularityMap";
// @ts-ignore
import {v4 as uuidv4} from 'uuid';

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

const KICK_DOWNWARDS_VELOCITY = 400;
const KICK_BOUNCEBACK_DELAY = 350;

const MAX_SPEED = 360;
const ACCELERATION = 30;

const GRAVITY = 1400;

const PLAYER_JUMP_FORCE = 600;

const THROW_VELOCITY = 700;
const DISARM_VELOCITY = 200;

// https://stackoverflow.com/questions/1527803/generating-random-whole-numbers-in-javascript-in-a-specific-range
function getRandomInt(min: number, max: number) {
  min = Math.ceil(min);
  max = Math.floor(max);
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

export class ArenaRoom extends Room<ArenaRoomState> {

  gameOver: boolean = false;
  maxClients: number = 2;
  physicsBodies: Record<string, Body> = {};
  playerColliders: Record<string, any> = {};
  physics: ArcadePhysics = null;
  physicsTick: number = 0;
  physicsMap: Array<StaticBody> = [];
  playerRooms: Record<string, string> = {};
  playerWinRooms: Record<string, string> = {};
  killCounts: Record<string, number> = {};
  playerData: Record<string, Record<string, any>> = {};
  initPlayerData: Record<string, any> = {
    isJumpKicking: false
  };
  firstPlayerID: string = '';

  createPhysicsBody(id: string, x: number, y: number, width: number, height: number): Body {
    this.physicsBodies[id] = this.physics.add.body(x, y, width, height);
    
    if (DEBUG_ENABLED) {
      this.state.hitboxDebug.set(id, new HitboxDebug(id, x, y, width, height));
    }

    return this.physicsBodies[id];
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
    const killerID = this.getOtherPlayerID(playerID);
    const killer = this.state.players.get(this.getOtherPlayerID(playerID)).playerName;
    // If player is dead, don't kill again or if game is over
    if(this.state.players.get(playerID).isDead || this.gameOver) return;

    // Kill player
    player.isDead = true;

    console.log(`${killerID} [${killer}] killed ${playerID} [${player.playerName}]`);

    this.killCounts[killerID]++;

    this.broadcast('update-killcount', {
      playerID: killerID,
      killCount: this.killCounts[killerID]
    });

    if (typeof player !== 'undefined' && !player.isDead) {
      // Prevent movement after death
      this.physicsBodies[playerID].setVelocityX(0);
  
      // Lock player to "dead state" (will also trigger animation)
      // Verifies that player exists before trying to kill him
      player.isDead = true;
    }
    else if (typeof player === 'undefined') {
      console.log(`Player ${playerID} no longer exists, cannot kill`);
    }
  }

  doJumpKick(playerID: string) {
    const playerBody = this.physicsBodies[playerID];
    const player = this.state.players.get(playerID);

    this.playerData[playerID].isJumpKicking = true;

    const kickVelX = ((player.flipX ? -1 : 1) * MAX_SPEED * 2);
    const kickVelY = KICK_DOWNWARDS_VELOCITY;

    playerBody.setVelocity(kickVelX, kickVelY);
  }

  doAttack(playerID: string) {
    const player = this.state.players.get(playerID);

    // Start clock 
    this.clock.start();
    
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

    // @todo This might help reduce latency but it might also overload the server
    this.setPatchRate(16.6);

    this.onMessage('change-stance', (client: Client, data: Record<string, string>) => {
      const {direction} = data;
      const {sessionId: playerID} = client;
      const player = this.state.players.get(playerID);
      const hasSword = (player.animPrefix === 'sword');

      if (player !== undefined && !player.isDead && hasSword) {
        // Get enemy
        const enemyID = this.getOtherPlayerID(playerID);
        const enemy = this.state.players.get(enemyID);
        const hasEnemyWithSword = (enemyID !== '' && enemy.animPrefix === 'sword');

        // Get swords
        const playerSword = this.getAttachedSwordBody(playerID);
        const enemySword = this.getAttachedSwordBody(enemyID);
  
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
            this.disarmPlayer(enemyID, direction);
            this.broadcast('camera-flash');
          }
        }
      }
    });

    this.onMessage('keyboard-input', (client: Client, input: Record<string, boolean>) => {
      const {up, left, right, down, attack: doAttack, jump} = input;
      const playerBody = this.physicsBodies[client.sessionId];
      const player = this.state.players.get(client.sessionId);
      const enemyID = this.getOtherPlayerID(client.sessionId);
      const isGrounded = (playerBody.blocked.down);
      const hasSword = (player.animPrefix === 'sword');
      const doResetJumpKick = (this.playerData[client.sessionId].isJumpKicking && isGrounded);

      // Reset jumpkick when they hit the ground
      if (doResetJumpKick) {
        this.playerData[client.sessionId].isJumpKicking = false;
      }
      
      const {isJumpKicking} = this.playerData[client.sessionId];

      if (!player.isDead && !player.isInputLocked) {
        // Attack (or throw attack)
        const throwReady = (player.level === 'high' && up);
        const doThrowAttack = (throwReady && doAttack);
  
        if (isGrounded && hasSword && doThrowAttack) {
          const sword = this.getAttachedSword(client.sessionId);
          const swordBody = this.getAttachedSwordBody(client.sessionId);

          // Enable sword texture
          sword.isTextureVisible = true;

          // Remove sword's attachedTo
          sword.attachedTo = '';
  
          // Flip sword according to player
          sword.flipX = player.flipX;
  
          // Disable gravity when thrown
          swordBody.setAllowGravity(false);
  
          // Add overlap calls w/ other player
          // this.physics.add.overlap(this.physicsBodies[swordID], this.physicsBodies[enemyID], () => {
          //   this.killPlayer(enemyID);
          // });
  
          // Set sword body velocity (*(+/-)1(flipX?))
          swordBody.setVelocityX((sword.flipX ? -1 : 1) * THROW_VELOCITY);
  
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
        else if (!isGrounded && doAttack && !isJumpKicking) {
          this.doJumpKick(client.sessionId);
        }
        // Move / Idle / Default animation logic
        else if (!throwReady && !isJumpKicking) {
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
              
              if (!enemy.isDead) {
                if (enemy.x <= player.x) {
                  player.flipX = true;
                }
                else {
                  player.flipX = false;
                }
              }
            }
          }
    
          // Jump
          if (jump && isGrounded) {
            playerBody.setVelocityY(-PLAYER_JUMP_FORCE);
          }

          // Pickup sword
          if (down && isGrounded && !hasSword) {
            // Loop over swords and check for overlaps
            this.state.objects.forEach((object) => {
              if (object.id.startsWith('sword_')) {
                const swordBody = this.physicsBodies[object.id];
                const isOnGround = (swordBody.blocked.down);

                if (isOnGround) {
                  const isTouchingSword = this.physics.overlap(playerBody, swordBody, null, null, this);

                  if (isTouchingSword) {
                    object.attachedTo = player.id;
                    object.isTextureVisible = false;
                    swordBody.setAllowGravity(false);
                    player.animPrefix = 'sword';
                  }
                }
              }
            });
          }
  
          // Apply velocity for movement
          playerBody.setVelocityX(player.velX);
        }
  
        // Animation logic
        if (isJumpKicking) {
          player.animMode = 'loop';
          player.anim = `${player.animPrefix}-jumpkick`;
        }
        else if (hasSword && isGrounded && doThrowAttack) {
          player.animMode = 'play-hold';
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
        player.animMode = 'play-hold';
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
    this.watchForRespawnsAndWin();
    this.watchForFalls();
  }

  watchForFalls() {
    const lowerEdge = (MAP_DATA.height * MAP_DATA.tile_height);

    this.state.players.forEach((player) => {
      const playerBody = this.physicsBodies[player.id];

      if (playerBody.y > lowerEdge) {
        this.killPlayer(player.id);

        // This circumvents players immediately being killed when respawning after a fall
        playerBody.y = -500;
        playerBody.setAllowGravity(false);
        playerBody.setVelocity(0, 0);

        const playerSwordBodyOld = this.getAttachedSwordBody(player.id);
        playerSwordBodyOld.y = -500;
        playerSwordBodyOld.setAllowGravity(false);
        playerSwordBodyOld.setVelocity(0, 0);
      }
    });
  }

  watchForRespawnsAndWin() {
    // If player or enemy are dead, watch for the other to change rooms
    // When the room changes, find spawn point IN room, BUT furthest from player who entered
    // Respawn dead player there
    this.state.players.forEach((player) => {
      const enemyID = this.getOtherPlayerID(player.id);
      const {x} = player;
      let enemy = null;

      if (enemyID !== '') {
        enemy = this.state.players.get(enemyID);
      }

      let currentRoomName = null;
  
      MAP_DATA.rooms.forEach((r) => {
        const {x: rx, width} = r;
        if (x >= rx && x <= rx + width) {
          currentRoomName = r.name;
        }
      });

      const playerHasChangedRooms = (currentRoomName !== this.playerRooms[player.id]);
      const doRespawnEnemy = (
        enemy !== null &&
        playerHasChangedRooms &&
        enemy.isDead &&
        !['room_L6', 'room_R6'].includes(currentRoomName)
      );

      if (doRespawnEnemy) {
        const spawnPoint = this.getFurthestSpawnPointInRoom(currentRoomName, x);
        this.respawn(enemyID, spawnPoint.x, spawnPoint.y);
      }

      // If either player enters their opposite "win" room, game over, they win

      if (playerHasChangedRooms) {
        if (currentRoomName === this.playerWinRooms[player.id]) {

          // Wait 3 seconds, then declare the winner
          this.clock.setTimeout(() => {
            this.declareWinner(player.id);
          }, 3000);
        }
      }

      // Update for next frame's watch
      this.playerRooms[player.id] = currentRoomName;
    });

  }

  syncHitboxDebug() {
    this.state.hitboxDebug.forEach((hitbox, id) => {
      const body = this.physicsBodies[id];
      try {
        hitbox.x = body.x;
        hitbox.y = body.y;
      } catch (err) {
        console.log(err);
      }
    });
  }

  moveHeldSwords() {
    this.state.players.forEach((player, playerID) => {
      const isPlayerHoldingSword = (player.animPrefix === 'sword');
      const sword = this.getAttachedSword(playerID);
      const swordBody = this.getAttachedSwordBody(playerID);
      
      if (sword !== null) {
        const hitboxDebug = this.state.hitboxDebug.get(sword.id);
  
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

          const flipMod = (player.flipX ? -1 : 1);
          const flipOffset = (player.flipX ? swordBody.width : 0);
  
          if (isSwordOutAnim) {
            // Sync / offset sword in idle & stepping anims
            const playerBody = this.physicsBodies[playerID];
            const playerX = (playerBody.x + (PLAYER_BODY.width * PLAYER_BODY.originX));
            const playerY = (playerBody.y + (PLAYER_BODY.height * PLAYER_BODY.originY));
  
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
          else {
            swordBody.x = ((player.xSwordOffset * flipMod) - flipOffset);
          }
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

  respawn(playerID: string, x: number, y: number) {
    const player = this.state.players.get(playerID);

    this.physicsBodies[playerID].x = x;
    this.physicsBodies[playerID].y = y;
    this.physicsBodies[playerID].setAllowGravity(true);

    player.isDead = false;
    player.animMode = 'loop';
    player.animPrefix = 'sword';
    player.level = 'mid';
    player.anim = `${player.animPrefix}-flip`;

    this.givePlayerSword(playerID);
    const sword = this.getAttachedSword(playerID);
    this.initSwordOverlaps(sword.id);

    this.broadcast('player-respawn', playerID);
  }

  getFurthestSpawnPointInRoom(roomName: string, targetX: number) {
    const spawnPoints = MAP_DATA.spawn_points.filter((room) => room.room === roomName);
    let furthestSpawnPoint: any = null;

    spawnPoints.forEach((spawnPoint) => {
      if (furthestSpawnPoint === null) {
        furthestSpawnPoint = spawnPoint;
      }
      else {
        const d2fsp = Math.abs(furthestSpawnPoint.x - targetX);
        const d2nsp = Math.abs(spawnPoint.x - targetX);

        if (d2nsp > d2fsp) {
          furthestSpawnPoint = spawnPoint;
        }
      }
    });

    return furthestSpawnPoint;
  }

  getAttachedSword(playerID: string): AbstractObject {
    let sword = null;
    
    this.state.objects.forEach((object) => {
      if (object.texture === 'sword' && object.attachedTo === playerID) {
        sword = object;
      }
    });

    return sword;
  }

  getAttachedSwordBody(playerID: string): Body {
    const sword = this.getAttachedSword(playerID);

    if (sword === null) {
      return null;
    }
    else {
      return this.physicsBodies[sword.id];
    }
  }

  givePlayerSword(playerID: string) {
    // Add state object for sword
    const swordID = `sword_${uuidv4()}`;
    this.state.objects.set(swordID, new AbstractObject(
      swordID,
      0,
      0,
      OBJECT_BODIES['sword'].width,
      OBJECT_BODIES['sword'].height,
      OBJECT_BODIES['sword'].originX,
      OBJECT_BODIES['sword'].originY,
      'sword',
      playerID
    ));

    // Add body for sword
    this.createPhysicsBody(
      swordID,
      0,
      0,
      OBJECT_BODIES['sword'].width,
      OBJECT_BODIES['sword'].height
    );

    // Disable gravity on the sword body
    this.physicsBodies[swordID].setAllowGravity(false);
  }

  initSwordOverlaps(swordID: string) {
    const sword = this.state.objects.get(swordID);
    const swordBody = this.physicsBodies[swordID];

    // Initialize sword touching each player
    this.state.players.forEach((player) => {
      const playerBody = this.physicsBodies[player.id];

      // Sword vs player generic
      this.physics.add.overlap(swordBody, playerBody, () => {
        const swordIsOwnedByPlayer = (sword.attachedTo === player.id);
        const {isJumpKicking} = this.playerData[player.id];

        if (!swordIsOwnedByPlayer && !isJumpKicking) {
          const enemyID = this.getOtherPlayerID(player.id);

          if (enemyID !== '') {
            const swordIsOwnedByEnemy = (sword.attachedTo === enemyID);
            const swordIsHot = (swordIsOwnedByEnemy || swordBody.velocity.x !== 0);
      
            if (swordIsHot) {
              if (player.animPrefix === 'sword') {
                this.disarmPlayer(player.id, 'up');
              }
              this.killPlayer(player.id);
            }
          }
        }
      });
    });

    // Initialize sword touching each sword
    this.state.objects.forEach((object) => {
      // Make sure we're only examining OTHER SWORDS
      if (object.texture === 'sword' && object.id !== swordID) {
        let overlapExists = false;
        const otherSwordBody = this.physicsBodies[object.id];

        // Iterate over all active colliders in physics world
        this.physics.world.colliders.getActive().forEach((collider) => {
          // Only check overlaps, not colliders
          if (collider.overlapOnly) {
            if (
              collider.object1 === swordBody && collider.object2 === otherSwordBody ||
              collider.object2 === swordBody && collider.object1 === otherSwordBody
            ) {
              overlapExists = true;
            }
          }
        });

        // If no overlap between these two swords exists yet, make one
        if (!overlapExists) {
          this.physics.add.overlap(swordBody, otherSwordBody, () => {
            const bothSwordsAreHeld = (sword.attachedTo !== '' && object.attachedTo !== '');

            if (bothSwordsAreHeld) {
              const player = this.state.players.get(sword.attachedTo);
              const enemy = this.state.players.get(object.attachedTo);
              const playerBody = this.physicsBodies[player.id];
              const enemyBody = this.physicsBodies[enemy.id];

              const doBounce = (player.animPrefix === 'sword' && enemy.animPrefix === 'sword' && player.level === enemy.level && !player.isInputLocked && !enemy.isInputLocked);
  
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
            }
          });
        }
      }
    });
  }

  disarmPlayer(playerID: string, direction: string) {
    const player = this.state.players.get(playerID);
    const sword = this.getAttachedSword(playerID);
    const swordBody = this.getAttachedSwordBody(playerID);

    if (player.animPrefix === 'sword') {
      // Disarm enemy
      player.animPrefix = 'nosword';
      
      // Set sword texture to active
      sword.isTextureVisible = true;
  
      // Set sword so it's no longer attached to enemy
      sword.attachedTo = '';
  
      // Flip sword according to player
      sword.flipX = player.flipX;
  
      // Set sword body velocity (*(+/-)1(flipX?))
      swordBody.setVelocityY((direction === 'up' ? -1 : 1) * DISARM_VELOCITY);
  
      // Enable gravity on sword
      swordBody.setAllowGravity(true);
  
      // Add collider w/ map so sword will land
      this.physics.add.collider(swordBody, this.physicsMap);
    }
  }

  onJoin (client: Client, options: any) {
    console.log(client.sessionId, "joined as", options.playerName);

    // Initialize playerData
    this.playerData[client.sessionId] = {
      ...this.initPlayerData
    };

    // Init player kill count
    this.killCounts[client.sessionId] = 0;
    
    // Init player room tracker
    this.playerRooms[client.sessionId] = 'room_0';

    // Add state object for player
    this.state.players.set(client.sessionId, new Player(
      options.playerName,
      client.sessionId,
      PLAYER_BODY.width,
      PLAYER_BODY.height
    ));

    const enemyID = this.getOtherPlayerID(client.sessionId);
    let spawnX = null;
    let spawnY = null;

    if (enemyID === '') {
      // We're alone in the room, pick random side of room_0
      const spawnPoints = MAP_DATA.spawn_points.filter((room) => room.room === 'room_0');
      const spawnPoint = spawnPoints[getRandomInt(0, spawnPoints.length - 1)];
      spawnX = spawnPoint.x;
      spawnY = spawnPoint.y;

      this.firstPlayerID = client.sessionId;
    }
    else {
      const enemyBody = this.physicsBodies[enemyID];
      const spawnPoint = this.getFurthestSpawnPointInRoom('room_0', enemyBody.x);
      spawnX = spawnPoint.x;
      spawnY = spawnPoint.y;
    }

    // Determine which room player needs to reach to win
    const didSpawnOnLeftSide = (spawnX === 5920);
    const didSpawnOnRightSide = !didSpawnOnLeftSide;

    if (didSpawnOnLeftSide) {
      this.playerWinRooms[client.sessionId] = 'room_R6';
    }
    else if (didSpawnOnRightSide) {
      this.playerWinRooms[client.sessionId] = 'room_L6';
    }

    // Add body for player
    const playerBody = this.createPhysicsBody(
      client.sessionId,
      spawnX,
      spawnY,
      PLAYER_BODY.width,
      PLAYER_BODY.height
    );

    this.givePlayerSword(client.sessionId);

    // Add player v map collision detection
    this.playerColliders[client.sessionId] = this.physics.add.collider(
      this.physicsBodies[client.sessionId],
      this.physicsMap
    );

    if (enemyID !== '') {
      const enemyBody = this.physicsBodies[enemyID];
      
      // If both players have spawned, register sword overlaps
      this.state.objects.forEach((object) => {
        const isSword = (object.id.startsWith('sword_'));

        if (isSword) {
          this.initSwordOverlaps(object.id);
        }
      });

      // Check for player vs player overlaps (for dropkicks)
      this.physics.add.overlap(playerBody, enemyBody, () => {
        const {isJumpKicking: playerIsJumpKicking} = this.playerData[client.sessionId];
        const {isJumpKicking: enemyIsJumpKicking} = this.playerData[enemyID];
        const player = this.state.players.get(client.sessionId);
        const enemy = this.state.players.get(enemyID);

        if (playerIsJumpKicking && enemyIsJumpKicking) {
          // Handle jumpkick vs jumpkick collision
        }
        else if (playerIsJumpKicking) {
          // Disarm enemy
          this.disarmPlayer(enemyID, 'up');
          
          player.isInputLocked = true;
          enemy.isInputLocked = true;

          player.anim = `${player.animPrefix}-flip`;
          enemy.anim = `${enemy.animPrefix}-flip`;

          const playerDir = (player.flipX ? 1 : -1);
          const enemyDir = (enemy.flipX ? 1 : -1);
          
          playerBody.setVelocity(playerDir * KICK_DOWNWARDS_VELOCITY, -PLAYER_JUMP_FORCE);
          enemyBody.setVelocity(enemyDir * KICK_DOWNWARDS_VELOCITY, -PLAYER_JUMP_FORCE);

          this.clock.setTimeout(() => {
            player.isInputLocked = false;
            enemy.isInputLocked = false;
          }, KICK_BOUNCEBACK_DELAY);
        }
        else if (enemyIsJumpKicking) {
          // Disarm player
          this.disarmPlayer(client.sessionId, 'up');

          player.isInputLocked = true;
          enemy.isInputLocked = true;

          player.anim = `${player.animPrefix}-flip`;
          enemy.anim = `${enemy.animPrefix}-flip`;

          const playerDir = (player.flipX ? 1 : -1);
          const enemyDir = (enemy.flipX ? 1 : -1);
          
          playerBody.setVelocity(playerDir * KICK_DOWNWARDS_VELOCITY, -PLAYER_JUMP_FORCE);
          enemyBody.setVelocity(enemyDir * KICK_DOWNWARDS_VELOCITY, -PLAYER_JUMP_FORCE);

          this.clock.setTimeout(() => {
            player.isInputLocked = false;
            enemy.isInputLocked = false;
          }, KICK_BOUNCEBACK_DELAY);
        }
      });
    }
  }

  onLeave (client: Client, consented: boolean) {
    console.log(`${client.sessionId} [${this.state.players.get(client.sessionId).playerName}] ${consented ? 'left!' : 'was disconnected!'}`);

    const otherPlayerID = this.getOtherPlayerID(client.sessionId);

    if (otherPlayerID !== '') {
      console.log('Client id', otherPlayerID, 'wins by default.');
      this.declareWinner(otherPlayerID, true);
    }
  }

  onDispose() {
    console.log("Room", this.roomId, "disposing...");
  }

  declareWinner(playerID: string, winnerByDefault: boolean = false) {
    const winningPlayer = this.state.players.get(playerID);

    this.broadcast('game-over', {
      winnerName: winningPlayer.playerName,
      winnerByDefault
    });

    this.disconnect();
  }

}
