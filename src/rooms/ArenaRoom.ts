import { Room, Client, ServerError, matchMaker } from "colyseus";
import { AbstractObject, ArenaRoomState, HitboxDebug, Player } from "./schema/ArenaRoomState";
import { ArcadePhysics } from 'arcade-physics';
import StateMachine from "javascript-state-machine";
import { Body } from 'arcade-physics/lib/physics/arcade/Body';
import { StaticBody } from "arcade-physics/lib/physics/arcade/StaticBody";
import SingularityMap from "../maps/SingularityMap";
// @ts-ignore
import {v4 as uuidv4} from 'uuid';

const DEBUG_ENABLED = true; // set to false in production build

const MAP_DATA = SingularityMap;

// @todo Server Logging Icons
const ICONS = {
  firstPlayer: '🟦',
  secondPlayer: '🟥',
  sword: '⚔️',
  death: '💀',
  left: '⬅️',
  right: '➡️',
}

const PLAYER_BODY = {
  width: 20,
  height: 40,
  originX: 0.5,
  originY: 1
};

const OBJECT_BODIES: Record<string, any> = {
  'sword': {
    width: 26,
    height: 6,
    originX: 0,
    originY: 0.5
  }
};

const MS_PER_FRAME = 100;

const SWORD_ATTACK_FRAME_XOFFSETS: Array<number> = [
  // 0,
  -1,
  -2,
  16,
  14,
  -2,
  -1
];

const FPS = 60;

const LUNGE_VELOCITY = 44;

const SWORD_BOUNCEBACK = 120;
const SWORD_BOUNCEBACK_DELAY = 150;

const KICK_DOWNWARDS_VELOCITY = 600;
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
  lastKillerID: string = '';
  playerData: Record<string, Record<string, any>> = {};
  initPlayerData: Record<string, any> = {
    isJumpKicking: false,
    direction: '',
  };
  firstPlayerID: string = '';
  secondPlayerID: string = '';

  /**
   * 
   * @param playerID PlayerID of player to find room direction for
   * @returns room direction 
   *  -1 left of given player
   *  1 right of given player
   */
  getWinRoomDirection(playerID: string): number {
    return 0
  }

  /**
   * Logging utility to quickly investigate player interactions
   * 
   * @param playerID 
   * @returns Neatly formatted & colored string for playerID
   */
  getPlayerTag(playerID: string): string | null {
    var tag = ''
    if(this.playerData[playerID]) {
      tag = "[" + this.playerData[playerID].icon + " " + this.state.players.get(playerID).playerName + "]"
    }
    return tag
  }

  /**
   * Sanitizes an input string to be used as a player name
   * @param input Player name to sanitize
   * @returns Sanitized player name
   */
  sanitize(input: string): string {
    return input.replace(/[^a-zA-Z0-9_$]/g, '');
  }
  
  LOGTYPES = {
    kill: '[INFO] [KILL]',
    changeRoom: '[INFO] [CHANGE-ROOM]',
    default: '[INFO]'
  }

  /**
   * Logging utility to give more information to the server log reader about happenings ingame
   * @todo Expand
   * @param type 
   * @param value 
   */
  serverLog(type: string, value: string | string[]) {
    var logPrefix = type;
    var timeStamp = ''; // @todo Get current timestamp
    console.log(timeStamp, " ", logPrefix, " ", value);
  }

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
    const killer = this.state.players.get(this.getOtherPlayerID(playerID))?.playerName;

    // Set the lastKillerID to the most recent killer's ID, if its a player
    if(typeof killerID !== 'undefined') this.lastKillerID = killerID;

    // If player is dead, don't kill again or if game is over
    if(this.state.players.get(playerID).isDead || this.gameOver) return;

    if (typeof player !== 'undefined' && !player.isDead) {
      console.log(`${killerID} [${killer}] killed ${playerID} [${player.playerName}]`);
      this.killCounts[killerID]++;

      // Prevent movement after death
      this.physicsBodies[playerID].setVelocityX(0);
  
      // Lock player to "dead state" (will also trigger animation)
      // Verifies that player exists before trying to kill him
      player.isDead = true;

      this.broadcast('update-killcount', {
        playerID: killerID,
        killCount: this.killCounts[killerID]
      });
    }
    // Prevent death if player doesn't exist
    else if (typeof player === 'undefined') {
      console.log(`Player ${playerID} no longer exists, cannot kill`);
    }
  }

  doJumpKick(playerID: string) {
    const playerBody = this.physicsBodies[playerID];
    const player = this.state.players.get(playerID);

    this.playerData[playerID].isJumpKicking = true;

    this.state.players.get(playerID).isAttacking = true;

    // Kick X velocity influenced by player's current X velocity
    const kickVelX = (
      (player.flipX ? -1 : 1)
      // * MAX_SPEED * 2
      * (Math.abs(0.5 * playerBody.velocity.x) + 350)
    );

    // 
    const kickVelY = (playerBody.velocity.y) + 250;

    playerBody.setVelocity(kickVelX, kickVelY);
  }

  doAttack(playerID: string) {
    const player = this.state.players.get(playerID);

    // Start clock 
    this.clock.start();
    
    // Lock input
    player.isInputLocked = true;

    // Set player to 'attacking'
    player.isAttacking = true;

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
      player.isAttacking = false;
    }, MS_PER_FRAME * SWORD_ATTACK_FRAME_XOFFSETS.length);
  }

  onCreate (options: any) {
    this.setState(new ArenaRoomState());

    // @todo Create new Current Game chat room. Add players to it as they join
    this.createChatRoom();

    // Decrease latency through more frequent network updates
    this.setPatchRate(16.6);

    // Create state machine for player states
    

    // Listen for first player to create chat room
    // this.onMessage('new-chat-room', (client: Client, id: string) => {
    //   console.log("New chat room created: ", id);
    //   this.state.chatRoomID = id;
    // });

    /**
     * Listen for players intention to change sword position & 
     */
    this.onMessage('change-stance', (client: Client, data: Record<string, string>) => {
      const {direction} = data;

      // Set player's intended direction change to the new direction
      this.playerData[client.sessionId].direction = direction;

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

    // Read direct keyboard input from player, move player accordingly
    this.onMessage('keyboard-input', (client: Client, input: Record<string, boolean>) => {
      const {up, left, right, down, attack: doAttack, jump} = input;
      const playerBody = this.physicsBodies[client.sessionId];
      const player = this.state.players.get(client.sessionId);
      const enemyID = this.getOtherPlayerID(client.sessionId);
      const isGrounded = (playerBody.blocked.down);
      const hasSword = (player.animPrefix === 'sword');
      const doResetJumpKick = (this.playerData[client.sessionId].isJumpKicking && isGrounded);

      // Reset jumpkick & attack status when they hit the ground
      if (doResetJumpKick) {
        this.playerData[client.sessionId].isAttacking = false;
        this.playerData[client.sessionId].isJumpKicking = false;
      }
      
      const { isJumpKicking, isFallenDown } = this.playerData[client.sessionId];
      
      if (!player.isDead && !player.isInputLocked) {
        // Attack (or throw attack)
        const throwReady = (player.level === 'high' && up && player.velX === 0 && !isJumpKicking);
        const doThrowAttack = (throwReady && doAttack);
  
        if (isGrounded && hasSword && doThrowAttack) {
          const sword = this.getAttachedSword(client.sessionId);
          const swordBody = this.getAttachedSwordBody(client.sessionId);

          const playerX = (playerBody.x + (PLAYER_BODY.width * PLAYER_BODY.originX));
          const playerY = (playerBody.y + (PLAYER_BODY.height * PLAYER_BODY.originY));

          const flipMod = (player.flipX ? -1 : 1);
          const flipOffset = (player.flipX ? swordBody.width : 0);

          // Enable sword texture
          sword.isTextureVisible = true;

          // Remove sword's attachedTo
          sword.attachedTo = '';
  
          // Flip sword according to player
          sword.flipX = player.flipX;

          // Set sword to lethal
          sword.isLethal = true;
          this.state.hitboxDebug.get(sword.id).isLethal = true;

          swordBody.x = playerX + (8 * flipMod) - flipOffset;
          swordBody.y = playerY - 40;
  
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
            // @todo Change player hitbox to be smaller when jumping
            player.isJumping = true;

            // playerBody.setSize(PLAYER_BODY.width, PLAYER_BODY.height - 18, false);
            // playerBody.y += 18;

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
                    // @todo Remove logging
                    console.log(`[${player.playerName}] picked up ${object.id}`);
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
          player.animMode = 'play-hold';
          player.anim = `${player.animPrefix}-jumpkick`;
        }
        else if(isFallenDown) {
          player.animMode = 'play-hold';
          player.anim = `layDown`;
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

    console.log("Room", this.roomId, "created...");
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

      // Check if player is falling, and make sure player hasn't been already killed
      if (playerBody.y > lowerEdge && !player.isDead) {
        this.killPlayer(player.id);

        // This circumvents players immediately being killed when respawning after a fall
        playerBody.y = -500;
        playerBody.setAllowGravity(false);
        playerBody.setVelocity(0, 0);

        const playerSwordBodyOld = this.getAttachedSwordBody(player.id);
        // Make sure player has sword before trying to affect sword
        if(playerSwordBodyOld !== null) {
          playerSwordBodyOld.y = -500;
          playerSwordBodyOld.setAllowGravity(false);
          playerSwordBodyOld.setVelocity(0, 0);
        }
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

      let currentRoomName = '';
  
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

      if(player.isDead && enemy == null) {
        const spawnLeft  = MAP_DATA.spawn_points.filter((room) => room.room === 'room_0').at(0);
        const spawnRight = MAP_DATA.spawn_points.filter((room) => room.room === 'room_0').at(1);
        const spawn = (this.playerWinRooms[player.id] === 'room_R6') ? spawnRight : spawnLeft;

        this.respawn(player.id, spawn.x, spawn.y);
      }

      // If both players are dead, respawn both at the same time in 2 seconds.
      if((player !== null && enemy !== null) && player.isDead && enemy.isDead) {
        const spawnLeft  = MAP_DATA.spawn_points.filter((room) => room.room === 'room_0').at(0);
        const spawnRight = MAP_DATA.spawn_points.filter((room) => room.room === 'room_0').at(1);
        if(this.playerWinRooms[player.id] == 'room_R6') {
          // If the player's win room is room_R6, they spawn on the left side
          this.respawn(player.id, spawnLeft.x, spawnLeft.y);
          this.respawn(enemyID, spawnRight.x, spawnRight.y);
        } else if(this.playerWinRooms[player.id] == 'room_R6') {
          // If the player's win room is room_R6, they spawn on the right side
          this.respawn(player.id, spawnRight.x, spawnRight.y);
          this.respawn(enemyID, spawnLeft.x, spawnLeft.y);
        }
      }

      if (doRespawnEnemy) {
        // Respawn the dead player based on their enemy's win room and if the lastKiller is their enemy as well
        const spawnPoint = this.getNextPlayerSpawnPoint(enemy);
        this.respawn(enemyID, spawnPoint.x, spawnPoint.y);
      }
      // Various checks to make when player changes rooms
      if (playerHasChangedRooms) {
        // Check if any players need to be respawned on player room change. Both players must be alive, otherwise handled above
        // Strip characters from player room name, then compare (e.g. room_L6 > room_L5)
        // @todo remove logging 
        console.warn(`Player ${this.getPlayerTag(player.id)} in room: ${currentRoomName.replace(/\D/g,'')}`)
        enemy !== null && console.log(`Enemy ${this.getPlayerTag(enemyID)} in room: ${this.playerRooms[enemyID].replace(/\D/g,'')}`)

        if (enemy && currentRoomName.replace(/\D/g,'') > this.playerRooms[enemyID].replace(/\D/g,'')
          && !['room_L6', 'room_R6'].includes(currentRoomName)
          && !player.isDead && !enemy.isDead
          // @todo Testing this condition out.
          // Should prevent new bug
          // NOTE: Not working, try different solution
          && this.lastKillerID == player.id) {
          const spawnPoint = this.getNextPlayerSpawnPoint(enemy);
          console.log(`Spawning ${player.playerName} in "${spawnPoint.room}" at X:${spawnPoint.x}, Y:${spawnPoint.y}`)
          this.respawn(enemyID, spawnPoint.x, spawnPoint.y);
        }

        // @todo Remove when altar is implemented
        // If the player is the last killer and enters the win room, they win
        if (currentRoomName === this.playerWinRooms[player.id] && this.lastKillerID == player.id) {
          console.log(`${player.id} has entered the win room!`);
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
        hitbox.width = body.width;
        hitbox.height = body.height;
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

          sword.isLethal = true;
          this.state.hitboxDebug.get(sword.id).isLethal = true;
  
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
              swordBody.x = playerX + (19 * flipMod) - flipOffset;
              swordBody.y = playerY - 22;
            }
            else if (player.level === 'mid') {
              swordBody.x = playerX + (19 * flipMod) - flipOffset;
              swordBody.y = playerY - 27;
            }
            else if (player.level === 'high') {
              swordBody.x = playerX + (19 * flipMod) - flipOffset;
              swordBody.y = playerY - 36;
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

        if(body.touching.down && player.isJumping) {
          player.isJumping = false;

          // @todo Needs to change when jumping hitbox is implemented
          // body.setSize(PLAYER_BODY.width, PLAYER_BODY.height, false);
          // body.y -= 19;

          body.setOffset(0, 0);
        }
        
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

    // Check for attached swords. If there is one, destroy it
    if(this.getAttachedSword(playerID) !== null) {
      this.deleteSword(this.getAttachedSword(playerID).id);
    }

    // Set velocity x & y to 0. This will prevent the player from moving when first respawning
    this.physicsBodies[playerID].velocity.x = this.physicsBodies[playerID].velocity.y = 0;
    // Set player's position to the spawn point
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
    console.log(`${this.getPlayerTag(playerID)} respawned with sword ${sword.id}`);

    // console.log(this.physicsBodies[playerID].)

    this.broadcast('player-respawn', playerID);
  }

  /**
   * 
   * @param player The player to check
   * @returns player spawnpoint, depends on this.lastKiller, and whether both players are dead or not
   */
  getNextPlayerSpawnPoint(player: Player): {room: string, x: number, y: number} {
    // Sort spawn points by x position so we can go through in order later
    const spawnPointsInOrder = MAP_DATA.spawn_points.slice().sort((a, b) => {
      return a.x - b.x;
    });

    var playerSpawnPoint;

    const enemyPlayerID = this.getOtherPlayerID(player.id);
    const enemy = this.state.players.get(enemyPlayerID);
    // If the other player is alive, and was the last killer, determine which room to spawn in
    if(!enemy.isDead && this.lastKillerID == enemyPlayerID) {
      const direction = this.playerWinRooms[enemyPlayerID] == 'room_R6' ? 1 : -2;
      // Find the spawn point directly after current enemy player position
      for (var i = 0; i < spawnPointsInOrder.length; i++) {
        if(spawnPointsInOrder.at(i).x > enemy.x) {
          // Get spawnpoint in correct direction
          playerSpawnPoint = spawnPointsInOrder.at(i + direction);
          break
        }
      }
      // If there's no last killer, guess which room to spawn in based on the player furthest from the map mid-point
    } else {
      const midPoint = (MAP_DATA.width * MAP_DATA.tile_width) / 2;
      // If enemy is furthest from the map midPoint, set spawn in room to block them
      const direction = (Math.abs(midPoint - player.x) > Math.abs(midPoint - enemy.x)) ? 1 : -2;
      // Find the spawn point directly after current enemy player position
      for (var i = 0; i < spawnPointsInOrder.length; i++) {
        if(spawnPointsInOrder.at(i).x > enemy.x) {
          // Get spawnpoint in correct direction
          playerSpawnPoint = spawnPointsInOrder.at(i + direction);
          break
        }
      }
    }
    return playerSpawnPoint;
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

  /**
   * Method for shorting the default UUID provided by uuidv4 to a shorter version
   *  and checking to make sure there are new duplicates
   */
  getNewUUID(): string {
    // This takes the first portion of the uuid returned by uuidv4
    const newUUID = uuidv4().split('-')[0];
    for(var key in Object.keys(this.physicsBodies)) {
      // If newUUID already exists in the keys of this.physicsBodies, try again
      if(key.includes(newUUID)) {
        return this.getNewUUID();
      }
    }
    return newUUID;
  }

  givePlayerSword(playerID: string) {
    // Add state object for sword
    const swordID = `sword_${this.getNewUUID()}`;
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

  // Should put player on the ground and immobilize them for a short period of time
  // Immobilized for 1.5 seconds
  playerFallDown(playerID: string) {
    // @todo change player animation to fall
    // Set player immobilized for 1.5-2.5 seconds. Animation will 
    // const duration = 1500 + (Math.random() * 1000);
    const duration = 2000;

    this.playerData[playerID].isInputLocked = true;
    this.playerData[playerID].isFallenDown = true;

    this.clock.setTimeout(() => {
      this.playerData[playerID].isInputLocked = false;
      this.playerData[playerID].isFallenDown = false;
      this.playerData[playerID].isKicked = false;
    }, duration)
  }

  // Should delete sword
  deleteSword(swordID: string) {
    this.state.objects.get(swordID).attachedTo = '';
    this.state.objects.delete(swordID); // Delete sword from objects
    this.state.hitboxDebug.delete(swordID); // Delete debug hitbox
    this.physicsBodies[swordID].destroy(); // Delete sword physics objects
    
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

      // Set sword to non-lethal
      sword.isLethal = false;
      this.state.hitboxDebug.get(sword.id).isLethal = false;
  
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

    var stateMachine = StateMachine.create({
      initial: "sword-idle-mid",
      events: [
          { name: "sword-idle-low", from: ["sword-crouch", "sword-idle-mid", "sword-run"], to: "sword-idle-low" },
          { name: "sword-idle-mid", from: ["sword-idle-low", "sword-idle-high", "sword-run"], to: "sword-idle-mid" },
          { name: "sword-idle-high", from: ["sword-idle-mid", "sword-throw-ready", "sword-run"], to: "sword-idle-high" },
          { name: "sword-attack-low", from: ["sword-idle-low"], to: "sword-attack-low" },
          { name: "sword-attack-mid", from: ["sword-idle-mid"], to: "sword-attack-mid" },
          { name: "sword-attack-high", from: ["sword-idle-high"], to: "sword-attack-high" },
          { name: "sword-forstep-low", from: ["sword-idle-low"], to: "sword-forstep-low" },
          { name: "sword-forstep-mid", from: ["sword-idle-mid"], to: "sword-forstep-mid" },
          { name: "sword-forstep-high", from: ["sword-idle-high"], to: "sword-forstep-high" },
          { name: "sword-backstep-low", from: ["sword-idle-low"], to: "sword-backstep-low" },
          { name: "sword-backstep-mid", from: ["sword-idle-mid"], to: "sword-backstep-mid" },
          { name: "sword-backstep-high", from: ["sword-idle-high"], to: "sword-backstep-high" },
          { name: "sword-crouch", from: ["sword-idle-low", "sword-crouch-jump", "sword-crouch-walk", "sword-crouch-attack"], to: "sword-crouch" },
          { name: "sword-crouch-walk", from: ["sword-crouch"], to: "sword-crouch-walk" },
          { name: "sword-crouch-jump", from: ["sword-crouch", "sword-crouch-walk"], to: "sword-crouch-jump" },
          { name: "sword-jump", from: ["sword-idle-low", "sword-idle-mid", "sword-idle-high", "sword-run", "sword-crouch-jump"], to: "sword-jump" },
          { name: "sword-jumpkick", from: "sword-jump", to: "sword-jumpkick" },
          { name: "sword-curbstomp", from: ["sword-idle-low", "sword-idle-mid", "sword-idle-high", 
            "sword-backstep-low", "sword-backstep-mid", "sword-backstep-high",
            "sword-forstep-low", "sword-forstep-mid", "sword-forstep-high"], to: "sword-curbstomp" },
          { name: "sword-cartwheel", from: ["sword-run"], to: "sword-cartwheel" },

          { name: "sword-run", from: ["sword-idle-low", "sword-idle-mid", "sword-idle-high", "sword-forstep-low", "sword-forstep-mid", "sword-forstep-high", "sword-backstep-low", "sword-backstep-mid", "sword-backstep-high"], to: "sword-run" },
          { name: "sword-throw-ready", from: ["sword-idle-high"], to: "sword-throw-ready" },
          { name: "throw", from: ["sword-throw-ready"], to: "throw" },

          { name: "nosword-idle", from: ["sword-idle-low", "sword-idle-mid", "sword-idle-high", "crouch"] , to: "nosword-idle" },
          { name: "nosword-attack", from: ["nosword-idle", "nosword-run"], to: "nosword-attack" },
          { name: "nosword-run", from: ["nosword-idle"], to: "nosword-run" },
          { name: "nosword-forstep", from: ["nosword-idle"], to: "nosword-forstep" },
          { name: "nosword-backstep", from: ["nosword-idle"], to: "nosword-backstep" },
          { name: "nosword-jumpkick", from: ["jump"], to: "nosword-jumpkick" },
          { name: "nosword-curbStomp", from: ["nosword-idle", "nosword-attack", "nosword-run", "nosword-forstep", "nosword-backstep"], to: "nosword-curbStomp" },
          { name: "nosword-rolling", from: ["nosword-idle", "nosword-run", "nosword-forstep", "nosword-backstep"], to: "rolling" },
          { name: "nosword-cartwheel", from: ["nosword-run"], to: "nosword-cartwheel" },
          { name: "crouch", from: ["nosword-idle", "nosword-run", "nosword-forstep", "nosword-backstep", "crouch-walk", "nosword-crouch-attack"], to: "crouch" },
          { name: "crouch-walk", from: ["crouch", "nosword-crouch-jump"], to: "crouch-walk" },
          { name: "nosword-crouch-jump", from: ["crouch", "crouch-walk"], to: "nosword-crouch-jump" },
          { name: "nosword-crouch-attack", from: ["crouch"], to: "nosword-crouch-attack" },
          { name: "nosword-rolling", from: ["nosword-run"], to: "nosword-rolling" },
          { name: "sword-rolling", from: ["sword-run"], to: "sword-rolling" },
          { name: "lay-down", from: ["*"], to: "lay-down" },

          { name: "death-stand", from: ["*"], to: "death-stand" },
          { name: "death-lay", from: [""], to: "death-lay" },
      ],
      callbacks: {
          onEnterState: (event, from, to) => {
            
            // const animString = event.replace(/^[A-Z]+$/g, '-$1').toLowerCase();

            console.log(to)
          },
          onSwordIdleLow: (event, from, to) => {

          },
          
      },
    });

    // A series of checks to run once each update tick, then provide to State Predicates for the State Machine
    // Useful for unifying player data checks and providing to the State Machine
    // Example:
    // ------------------------------------------------------------
    // const { hasSword, isGrounded, isCrouching, currentPlayerState, direction } = playerStateChecks(player)
    //
    // for (const t of this.playerData[player].stateMachine.transitions()) {
    //     if (t in this.playerData[player].stateMachinePredicates && this.playerData[player].stateMachinePredicates[t]()) {
    //         this.playerData[player].stateMachine[t]();
    //         break;
    //     }
    // }
    // ------------------------------------------------------------
    var playerStateChecks = (player: Player) => {
      return {
        hasSword: (player.animPrefix === 'sword'), // true if player has a sword equipped
        direction: this.playerData[player.id].direction, // Last given 'change-stance' input
        isAlive: !player.isDead, // Check if player is alive
        isAttacking: player.isAttacking, // true if player is attacking (stab, jump kick, crouch attack, curbstomp attack)
        isCrouching: (player.anim.includes('crouch')), // Check for currently crouching, sword or nosword
        currentPlayerState: this.playerData[player.id].stateMachine.state, // Check for current state in statemachine
        isKicked: this.playerData[player.id].isKicked, // Check if player is currently kicked
        isJumping: player.isJumping,
        isFallen: this.playerData[player.id].isFallen, // Check if player is currently fallen
        isRolling: this.playerData[player.id].isRolling, // Check if player is currently rolling
        isInputLocked: this.playerData[player.id].isInputLocked, // Check if input is locked
        isGrounded: this.playerData[player.id].isGrounded, // Check if player is on ground
      }
    }

    var stateMachinePredicates = {
      // Example:
      // idle: (player: Player) => { ...condition... },

      /**
       * ********* Sword Idle States *********
       */
      swordIdleLow: (player: Player, hasSword: boolean, direction: string, isAlive: boolean, isCrouching: boolean, isKicked: boolean, isFallen: boolean, isRolling: boolean, isInputLocked: boolean) => {
        // Check if player is holding sword,
        // and if player has signaled to change sword positions

        // Invalidating conditions, check for these first and then return false to skip further evaluation
        if(!hasSword || player.isDead 
          || isKicked || isFallen || isRolling || isInputLocked || player.velX != 0 || direction === '' 
          || !isCrouching) return false;

        // If the player is in the mid position, and signals down, reset the 'direction' change and return true for sword change;
        if (direction === 'low' && player.level === 'mid') {
          this.playerData[player.id].direction = '';
          player.level = 'low';
          return true;
        // If the player is crouching and signals up, reset the 'direction' change and return true for sword change;
        } else if(direction !== 'down' && isCrouching && player.level === 'low') {
          return true;
        }
      },
      swordIdleMid: (player: Player, hasSword: boolean, direction: string, isAlive: boolean, isCrouching: boolean, isKicked: boolean, isFallen: boolean, isRolling: boolean, isInputLocked: boolean) => {
        // Check if player is holding sword,
        // and if player has signaled to change sword positions

        // Invalidating conditions, check for these first and then return false to skip further evaluation
        if(!hasSword || player.isDead 
          || isKicked || isFallen || isRolling || isInputLocked || player.velX != 0 || direction === '' 
          || isCrouching) return false;
        
        // If player signals 'down' and is 'mid', reset the 'direction' change and return true for sword change;
        if (direction === 'low' && player.level === 'high') {
          this.playerData[player.id].direction = '';
          player.level = 'mid';
          return true;
        // If player signals 'up' and is 'low', reset the 'direction' change and return true for sword change;
        } else if(direction === 'up' && player.level === 'low') {
          this.playerData[player.id].direction = '';
          player.level = 'mid';
          return true;
        }
      },
      swordIdleHigh: (player: Player, hasSword: boolean, direction: string, isAlive: boolean, isCrouching: boolean, isKicked: boolean, isFallen: boolean, isRolling: boolean, isInputLocked: boolean) => {
        // Check if player is holding sword,
        // and if player has signaled to change sword positions

        // Invalidating conditions, check for these first and then return false to skip further evaluation
        if(!hasSword|| player.isDead 
          || isKicked || isFallen || isRolling || isInputLocked || player.velX != 0 // We don't check for direction === ''
          || !isCrouching) return false;
        
        // If player signals 'down' and is ready to throw sword, 
        if (direction === 'up' && player.level === 'mid') {
          this.playerData[player.id].direction = '';
          player.level = 'high';
          return true;
        }
      },
      /**
       * ********* Sword Attack States *********
       */
      swordAttackLow: (player: Player, hasSword: boolean, isGrounded: boolean, isCrouching: boolean, isAttacking: boolean, isKicked: boolean, isFallen: boolean, isRolling: boolean, isInputLocked: boolean) => {
        // Check if player is attacking, if he has a sword, is crouching and if player is grounded
        if(player.isDead || !isAttacking || !hasSword || !isGrounded || isCrouching) return false;
        
        // If player is attacking, and is grounded, return true for sword attack;
        if(player.level === 'low' && isAttacking) {
          return true;
        }
      },
      swordAttackMid: (player: Player, hasSword: boolean, isGrounded: boolean, isCrouching: boolean, isAttacking: boolean, isKicked: boolean, isFallen: boolean, isRolling: boolean, isInputLocked: boolean) => {
        // Check if player is dead, has been kicked, is rolling, is input locked,
        // make sure attacking, has sword is on the ground, and isn't crouching
        if(player.isDead || isKicked || isFallen || isRolling || isInputLocked || !isAttacking || !hasSword || !isGrounded || isCrouching) return false;
        
        // If player is attacking, and is grounded, return true for sword attack;
        if(player.level === 'mid' && isAttacking) {
          return true;
        }
      },
      swordAttackHigh: (player: Player, hasSword: boolean, isGrounded: boolean, isCrouching: boolean, isAttacking: boolean, isKicked: boolean, isFallen: boolean, isRolling: boolean, isInputLocked: boolean) => {
        // Check if player is dead, has been kicked, is rolling, is input locked,
        // make sure attacking, has sword is on the ground, and isn't crouching
        if(player.isDead || isKicked || isFallen || isRolling || isInputLocked || !isAttacking || !hasSword || !isGrounded || isCrouching) return false;
        
        // If player is attacking, and is grounded, return true for sword attack;
        if(player.level === 'high' && isAttacking) {
          return true;
        }
      },
      /**
       * ********* Sword Forward & Backward Step States *********
       */
      swordForstepLow: (player: Player, hasSword: boolean, isGrounded: boolean, isCrouching: boolean, isAttacking: boolean, isKicked: boolean, isFallen: boolean, isRolling: boolean, isInputLocked: boolean) => {
        // Check if player is dead, has been kicked, is rolling, is input locked,
        // make sure not attacking, has sword is on the ground, and isn't crouching
        if(player.isDead || isKicked || isFallen || isRolling || isInputLocked || isAttacking || !hasSword || !isGrounded || isCrouching) return false;
        
        // Check if player is facing direction he's moving
        var forstepping = (player.flipX && player.velX < 0) || (!player.flipX && player.velX > 0);

        // If player is attacking, and is grounded, return true for sword attack;
        if(player.velX !== 0 && forstepping && Math.abs(player.velX) < MAX_SPEED && player.level === 'low') {
          return true;
        }
      },
      swordForstepMid: (player: Player, hasSword: boolean, isGrounded: boolean, isCrouching: boolean, isAttacking: boolean, isKicked: boolean, isFallen: boolean, isRolling: boolean, isInputLocked: boolean) => {
        // Check if player is dead, has been kicked, is rolling, is input locked,
        // make sure not attacking, has sword is on the ground, and isn't crouching
        if(player.isDead || isKicked || isFallen || isRolling || isInputLocked || isAttacking || !hasSword || !isGrounded || isCrouching) return false;
        
        // Check if player is facing direction he's moving
        var forstepping = (player.flipX && player.velX < 0) || (!player.flipX && player.velX > 0);

        // If player is attacking, and is grounded, return true for sword attack;
        if(player.velX !== 0 && forstepping && Math.abs(player.velX) < MAX_SPEED && player.level === 'mid') {
          return true;
        }
      },
      swordForstepHigh: (player: Player, hasSword: boolean, isGrounded: boolean, isCrouching: boolean, isAttacking: boolean, isKicked: boolean, isFallen: boolean, isRolling: boolean, isInputLocked: boolean) => {
        // Check if player is dead, has been kicked, is rolling, is input locked,
        // make sure not attacking, has sword is on the ground, and isn't crouching
        if(player.isDead || isKicked || isFallen || isRolling || isInputLocked || isAttacking || !hasSword || !isGrounded || isCrouching) return false;
        
        // Check if player is facing direction he's moving (stepping forward)
        var forstepping = (player.flipX && player.velX < 0) || (!player.flipX && player.velX > 0);

        // If player is attacking, and is grounded, return true for sword attack;
        if(player.velX !== 0 && forstepping && Math.abs(player.velX) < MAX_SPEED && player.level === 'high') {
          return true;
        }
      },
      swordBackstepLow: (player: Player, hasSword: boolean, isGrounded: boolean, isCrouching: boolean, isAttacking: boolean, isKicked: boolean, isFallen: boolean, isRolling: boolean, isInputLocked: boolean) => {
        // Check if player is dead, has been kicked, is rolling, is input locked,
        // make sure not attacking, has sword is on the ground, and isn't crouching
        if(player.isDead || isKicked || isFallen || isRolling || isInputLocked || isAttacking || !hasSword || !isGrounded || isCrouching) return false;
        
        // Check if player is moving opposite direction he's facing (stepping back)
        var backstepping = (player.flipX && player.velX > 0) || (!player.flipX && player.velX < 0);

        // If player is attacking, and is grounded, return true for sword attack;
        if(player.velX !== 0 && backstepping && Math.abs(player.velX) === MAX_SPEED && player.level === 'low') {
          return true;
        }
      },
      swordBackstepMid: (player: Player, hasSword: boolean, isGrounded: boolean, isCrouching: boolean, isAttacking: boolean, isKicked: boolean, isFallen: boolean, isRolling: boolean, isInputLocked: boolean) => {
        // Check if player is dead, has been kicked, is rolling, is input locked,
        // make sure not attacking, has sword is on the ground, and isn't crouching
        if(player.isDead || isKicked || isFallen || isRolling || isInputLocked || isAttacking || !hasSword || !isGrounded || isCrouching) return false;
        
        // Check if player is moving opposite direction he's facing (stepping back)
        var backstepping = (player.flipX && player.velX > 0) || (!player.flipX && player.velX < 0);

        // If player is attacking, and is grounded, return true for sword attack;
        if(player.velX !== 0 && backstepping && Math.abs(player.velX) === MAX_SPEED && player.level === 'mid') {
          return true;
        }
      },
      swordBackstepHigh: (player: Player, hasSword: boolean, isGrounded: boolean, isCrouching: boolean, isAttacking: boolean, isKicked: boolean, isFallen: boolean, isRolling: boolean, isInputLocked: boolean) => {
        // Check if player is dead, has been kicked, is rolling, is input locked,
        // make sure not attacking, has sword is on the ground, and isn't crouching
        if(player.isDead || isKicked || isFallen || isRolling || isInputLocked || isAttacking || !hasSword || !isGrounded || isCrouching) return false;
        
        // Check if player is moving opposite direction he's facing (stepping back)
        var backstepping = (player.flipX && player.velX > 0) || (!player.flipX && player.velX < 0);

        // If player is attacking, and is grounded, return true for sword attack;
        if(player.velX !== 0 && backstepping && Math.abs(player.velX) === MAX_SPEED && player.level === 'high') {
          return true;
        }
      },
      /**
       * ********* Sword Crouch States *********
       */
      swordCrouch: (player: Player, hasSword: boolean, direction: string, isGrounded: boolean, isCrouching: boolean, isAttacking: boolean, isKicked: boolean, isFallen: boolean, isRolling: boolean, isInputLocked: boolean) => {
        // Check if player is dead, has been kicked, is rolling, is input locked,
        // make sure not attacking, has sword is on the ground, and is crouching
        if(player.isDead || isKicked || isFallen || isRolling || isInputLocked || isAttacking || !hasSword || !isGrounded || !isCrouching) return false;
        
        // If player sword is level 'low' and player is pressing 'down', then return true for crouching
        if(player.level === 'low' && direction === 'down') {
          return true;
        }
      },
      swordCrouchWalk: (player: Player, hasSword: boolean, direction: string, isGrounded: boolean, isCrouching: boolean, isAttacking: boolean, isKicked: boolean, isFallen: boolean, isRolling: boolean, isInputLocked: boolean) => {
        // Check if player is dead, has been kicked, is rolling, is input locked,
        // make sure not attacking, has sword is on the ground, and is crouching
        if(player.isDead || isKicked || isFallen || isRolling || isInputLocked || isAttacking || !hasSword || !isGrounded || !isCrouching) return false;
        
        // If player is level 'mid', is pressing 'down', and walking, then return true for crouch walking
        if(player.level === 'mid' && direction === 'down' && player.velX !== 0) {
          return true;
        }
      },
      swordCrouchJump: (player: Player, hasSword: boolean, direction: string, isGrounded: boolean, isCrouching: boolean, isAttacking: boolean, isKicked: boolean, isFallen: boolean, isRolling: boolean, isInputLocked: boolean) => {
        // Check if player is dead, has been kicked, is rolling, is input locked,
        // make sure not attacking, has sword is on the ground, and is crouching
        if(player.isDead || isKicked || isFallen || isRolling || isInputLocked || isAttacking || !hasSword || !isGrounded || !isCrouching) return false;
        
        // If player is level 'mid', is pressing 'down', and jumping, then return true for crouch jumping
        if(player.level === 'mid' && direction === 'down' && player.isJumping) {
          return true;
        }
      }
    };

    // Initialize playerData
    this.playerData[client.sessionId] = {
      ...this.initPlayerData,
      stateMachine: stateMachine,
      stateMachinePredicates: stateMachinePredicates,
    };

    // Init player kill count
    this.killCounts[client.sessionId] = 0;
    
    // Init player room tracker
    this.playerRooms[client.sessionId] = 'room_0';

    // Add state object for player
    this.state.players.set(client.sessionId, new Player(
      this.sanitize(options.playerName), // Sanitize player name incase it missed it on the client
      client.sessionId,
      PLAYER_BODY.width,
      PLAYER_BODY.height,
      options.playerColor
    ));

    const spawnPoints = MAP_DATA.spawn_points.filter((room) => room.room === 'room_0');

    const enemyID = this.getOtherPlayerID(client.sessionId);
    let spawnX = null;
    let spawnY = null;

    if (enemyID === '') {
      // We're alone in the room, pick random side of room_0
      
      const spawnPoint = spawnPoints[getRandomInt(0, spawnPoints.length - 1)];
      spawnX = spawnPoint.x;
      spawnY = spawnPoint.y;

      this.firstPlayerID = client.sessionId;

      // The first player to join a room (the creator) should create the associated chat room.
      // client.send('create-chat-room');
      // console.log("Telling player to create chat room");

      // Set logging icon for player 1 (blue)
      this.playerData[client.sessionId].icon = ICONS.firstPlayer;
    }
    else {
      const enemyBody = this.physicsBodies[enemyID];
      // If the first player's win room is on the RIGHT side, he spawned on the LEFT
      // so, spawn on the RIGHT side (aka LEFT side win room)
      const spawnPoint = (this.playerWinRooms[this.firstPlayerID] == 'room_R6'
        ? spawnPoints[1] : spawnPoints[0]);
      spawnX = spawnPoint.x;
      spawnY = spawnPoint.y;

      this.secondPlayerID = client.sessionId;

      // @todo When second player spawns in, respawn first player back in their spot (match has "begun");

      // Set logging icon for player 2 (red)
      this.playerData[client.sessionId].icon = ICONS.secondPlayer;
    }

    // Determine which room player needs to reach to win
    const didSpawnOnLeftSide = (spawnX === 5920);
    const didSpawnOnRightSide = !didSpawnOnLeftSide;

    if (didSpawnOnLeftSide) {
      this.playerWinRooms[client.sessionId] = this.state.players.get(client.sessionId).winRoom = 'room_R6';
    }
    else if (didSpawnOnRightSide) {
      this.playerWinRooms[client.sessionId] = this.state.players.get(client.sessionId).winRoom = 'room_L6';
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
      // Broadcast rooms to both players
      this.broadcast('player-data', {
        playerOne: {
          name: this.state.players.get(this.firstPlayerID).playerName,
          id: this.firstPlayerID,
          room: this.playerWinRooms[this.firstPlayerID]
        },
        playerTwo: 
        {
          name: this.state.players.get(this.secondPlayerID).playerName,
          id: this.secondPlayerID,
          room: this.playerWinRooms[this.secondPlayerID]
        },
      });

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

        // If both players are kicking each other
        if (playerIsJumpKicking && enemyIsJumpKicking) {
          this.disarmPlayer(player.id, 'up');
          this.disarmPlayer(enemy.id, 'up');

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
        else if ((playerIsJumpKicking && !enemy.isKicked && !enemy.isDead)
          || (enemyIsJumpKicking && !player.isKicked && !player.isDead)) {
          var playerA: Player;
          var playerB: Player;
          var playerAID: string;
          var playerBID: string;
          var playerABody: Body;
          var playerBBody: Body;

          if (playerIsJumpKicking) {
            // Enemy has been kicked once, do not allow player to kick again
            enemy.isKicked = true;

            playerA = player;
            playerB = enemy;
            playerAID = client.sessionId;
            playerBID = enemyID;
            playerABody = playerBody;
            playerBBody = enemyBody;
          } else {
            // Player has been kicked once, do not allow enemy to kick again
            player.isKicked = true;

            playerA = enemy;
            playerB = player;
            playerAID = enemyID;
            playerBID = client.sessionId;
            playerABody = enemyBody;
            playerBBody = playerBody;
          }

          /**
           * Refactored to remove duplicate code
           * 
           * PlayerA is the player who is kicking PlayerB
           * PlayerB is the player who is being kicked by PlayerA
           */
          // Disarm enemy
          this.disarmPlayer(playerBID, 'up');
          this.playerFallDown(playerBID);
          
          playerA.isInputLocked = true;
          playerB.isInputLocked = true;

          playerA.anim = `${playerA.animPrefix}-flip`;
          playerB.anim = `${playerB.animPrefix}-flip`;

          const playerADir = (playerA.flipX ? 1 : -1);
          const playerBDir = (playerB.flipX ? 1 : -1);
          
          playerABody.setVelocity(playerADir * (0.3 * KICK_DOWNWARDS_VELOCITY), -(PLAYER_JUMP_FORCE * 0.25));
          playerBBody.setVelocity(playerBDir * (0.5 * KICK_DOWNWARDS_VELOCITY), -(0.35 * PLAYER_JUMP_FORCE));

          this.clock.setTimeout(() => {
            // Reset input lock
            playerA.isInputLocked = false;
            playerB.isInputLocked = false;
            // Reset kicked status
            player.isKicked = false;
            enemy.isKicked = false
          }, KICK_BOUNCEBACK_DELAY);
        }
        // else if (enemyIsJumpKicking) {
        //   // Disarm player
        //   this.disarmPlayer(client.sessionId, 'up');

        //   player.isInputLocked = true;
        //   enemy.isInputLocked = true;

        //   player.anim = `${player.animPrefix}-flip`;
        //   enemy.anim = `${enemy.animPrefix}-flip`;

        //   const playerDir = (player.flipX ? 1 : -1);
        //   const enemyDir = (enemy.flipX ? 1 : -1);
          
        //   playerBody.setVelocity(playerDir * KICK_DOWNWARDS_VELOCITY, -PLAYER_JUMP_FORCE);
        //   enemyBody.setVelocity(enemyDir * KICK_DOWNWARDS_VELOCITY, -PLAYER_JUMP_FORCE);

        //   this.clock.setTimeout(() => {
        //     player.isInputLocked = false;
        //     enemy.isInputLocked = false;
        //   }, KICK_BOUNCEBACK_DELAY);
        // }
      });
    }
  }

  async createChatRoom() {
    var room = await matchMaker.createRoom('current_room', {});
    this.state.chatRoomID = room.roomId;
  }

  async shutdownChat() {
    await matchMaker.remoteRoomCall(this.state.chatRoomID, "shutdownRoom");
  }

  onLeave (client: Client, consented: boolean) {
    console.log(`${client.sessionId} [${this.state.players.get(client.sessionId).playerName}] ${consented ? 'left!' : 'was disconnected!'}`);

    const otherPlayerID = this.getOtherPlayerID(client.sessionId);

    if (otherPlayerID !== '' && !this.gameOver) {
      console.log('Client id', otherPlayerID, 'wins by default.');
      this.declareWinner(otherPlayerID, true);
    }
  }

  onDispose() {
    console.log("Room", this.roomId, "disposing...");
    try {
      this.shutdownChat();
    } catch (e) {}
  }

  declareWinner(playerID: string, winnerByDefault: boolean = false) {
    this.gameOver = true;
    const winningPlayer = this.state.players.get(playerID);

    this.broadcast('game-over', {
      winnerName: winningPlayer.playerName,
      winnerByDefault
    });

    this.disconnect();
  }

}
