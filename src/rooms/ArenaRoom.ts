import { Room, Client } from "colyseus";
import { AbstractObject, ArenaRoomState, Player } from "./schema/ArenaRoomState";
import { ArcadePhysics } from 'arcade-physics';
import { Body } from 'arcade-physics/lib/physics/arcade/Body';
import { StaticBody } from "arcade-physics/lib/physics/arcade/StaticBody";
import arena from "../maps/arena";

const PLAYER_BODY = {
  width: 32,
  height: 64,
  originX: 0.5,
  originY: 1
};

const FPS = 60;

const MAX_SPEED = 300;
const ACCELERATION = 10;

const PLAYER_JUMP_FORCE = 300;

export class ArenaRoom extends Room<ArenaRoomState> {

  maxClients: number = 2;
  physicsBodies: Record<string, Body> = {};
  attackBodies: Record<string, Body> = {};
  playerColliders: Record<string, any> = {};
  physics: ArcadePhysics = null;
  physicsTick: number = 0;
  physicsMap: Array<StaticBody> = [];

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

    // Knock player up
    this.physicsBodies[playerID].setVelocityY(-300);

    // Destroy player's map collider
    this.physics.world.removeCollider(this.playerColliders[playerID]);

    // Lock player to "dead state" (will also triger animation)
    player.isDead = true;
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
  
        // Check for overlaps w/ atkBodies
        let isAtkBodiesTouching = false;

        if (enemyID !== '') {
          const pAtkBody = this.attackBodies[playerID];
          const eAtkBody = this.attackBodies[enemyID];
          const pAtkLeft = pAtkBody.x;
          const pAtkRight = (pAtkBody.x + pAtkBody.width);
          const eAtkLeft = eAtkBody.x;
          const eAtkRight = (eAtkBody.x + eAtkBody.width);
    
          isAtkBodiesTouching = (
            pAtkLeft < eAtkRight && pAtkLeft > eAtkLeft ||
            pAtkRight < eAtkRight && pAtkRight > eAtkLeft
          );
        }
  
        let doSpawnSword = false;
  
        if (direction === 'up') {
          if (player.level === 'low') {
            player.level = 'mid';
  
            if (isAtkBodiesTouching && enemy.level === 'mid') {
              enemy.animPrefix = 'nosword';
              doSpawnSword = true;
            }
          }
          else if (player.level === 'mid') {
            player.level = 'high';
  
            if (isAtkBodiesTouching && enemy.level === 'high') {
              enemy.animPrefix = 'nosword';
              doSpawnSword = true;
            }
          }
        }
        else if (direction === 'down') {
          if (player.level === 'high') {
            player.level = 'mid';
  
            if (isAtkBodiesTouching && enemy.level === 'mid') {
              enemy.animPrefix = 'nosword';
              doSpawnSword = true;
            }
          }
          else if (player.level === 'mid') {
            player.level = 'low';
  
            if (isAtkBodiesTouching && enemy.level === 'low') {
              enemy.animPrefix = 'nosword';
              doSpawnSword = true;
            }
          }
        }
  
        if (doSpawnSword) {
          const swordID = `sword_${enemyID}`;
          // const swordX = (playerBody.x + (player.flipX ? 25 : -25));
          const swordX = (enemy.x + (enemy.flipX ? -30 : 30));
          // const swordY = (playerBody.y - playerBody.height + 10);
          const swordY = (enemy.y - enemy.height + 25);
          const swordW = 25;
          const swordH = 6;
          const swordVelocity = 200;
          
          // Spawn a new sword in state
          this.state.objects.set(swordID, new AbstractObject(
            swordID,
            swordX,
            swordY,
            'sword'
          ));
  
          const sword = this.state.objects.get(swordID);
  
          // Flip sword according to player
          sword.flipX = enemy.flipX;
  
          // Spawn a new sword physics body
          this.physicsBodies[swordID] = this.physics.add.body(swordX, swordY, swordW, swordH);
  
          // Set sword body velocity (*(+/-)1(flipX?))
          this.physicsBodies[swordID].setVelocityY((direction === 'up' ? -1 : 1) * swordVelocity);
  
          // Add collider w/ map so sword will land
          this.physics.add.collider(this.physicsBodies[swordID], this.physicsMap);
        }
      }
    });

    this.onMessage('keyboard-input', (client: Client, input: Record<string, boolean>) => {
      const {up, left, right, attack: doAttack, jump} = input;
      const playerBody = this.physicsBodies[client.sessionId];
      const player = this.state.players.get(client.sessionId);
      const isGrounded = (playerBody.blocked.down);

      if (!player.isDead) {

        // Attack (or throw attack)
        const hasSword = (player.animPrefix === 'sword');
        const throwReady = (player.level === 'high' && up);
        const doThrowAttack = (throwReady && doAttack);
  
        if (hasSword && doThrowAttack) {
          const swordID = `sword_${client.sessionId}`;
          // const swordX = (playerBody.x + (player.flipX ? 25 : -25));
          const swordX = (player.x + (player.flipX ? -30 : 30));
          // const swordY = (playerBody.y - playerBody.height + 10);
          const swordY = (player.y - player.height + 25);
          const swordW = 25;
          const swordH = 6;
          const swordVelocity = 400;
          
          // Spawn a new sword in state
          this.state.objects.set(swordID, new AbstractObject(
            swordID,
            swordX,
            swordY,
            'sword'
          ));
  
          const sword = this.state.objects.get(swordID);
  
          // Flip sword according to player
          sword.flipX = player.flipX;
  
          // Spawn a new sword physics body
          this.physicsBodies[swordID] = this.physics.add.body(swordX, swordY, swordW, swordH);
          this.physicsBodies[swordID].setAllowGravity(false); // Disable gravity when thrown
  
          // Add overlap calls w/ other player
          const enemyID = this.getOtherPlayerID(client.sessionId);
  
          this.physics.add.overlap(this.physicsBodies[swordID], this.physicsBodies[enemyID], () => {
            this.killPlayer(enemyID);
          });
  
          // Set sword body velocity (*(+/-)1(flipX?))
          this.physicsBodies[swordID].setVelocityX((sword.flipX ? -1 : 1) * swordVelocity);
  
          // Set animPrefix to nosword (done in anim code below)
        }
        else if (doAttack) {
          this.broadcast('player-attack', {
            playerID: client.sessionId,
            hasSword,
            level: player.level
          });
  
          player.velX = 0;
          playerBody.setVelocityX(0);
        }
        // Move / Idle / Default animation logic
        else {
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
              player.anim = `${player.animPrefix}-backstep-${player.level}`;
            }
            else {
              player.anim = `${player.animPrefix}-backstep`;
            }
          }
          else if (
            player.flipX && player.velX > 0 && player.velX < MAX_SPEED ||
            !player.flipX && player.velX < 0 && player.velX > -MAX_SPEED
          ) {
            if (hasSword) {
              player.anim = `${player.animPrefix}-forstep-${player.level}`;
            }
            else {
              player.anim = `${player.animPrefix}-forstep`;
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
      else {
        player.animMode = 'loop';
        player.anim = `${player.animPrefix}-temp-death`;
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
              y: 300
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

    for (let y = 0; y < arena.height; y++) {
      for (let x = 0; x < arena.width; x++) {
        const px = (x * arena.tile_width);
        const py = (y * arena.tile_height);
        const i = (y * arena.width + x);
        const isBlocking = (arena.data[i] === 1);

        if (isBlocking) {
          this.physicsMap = [
            ...this.physicsMap,
            this.physics.add.staticBody(px, py, arena.tile_width, arena.tile_height)
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

    this.syncPhysicsBodies();
  }

  syncPhysicsBodies() {
    this.state.players.forEach((player, sessionId) => {
      const physicsBodyExists = (typeof this.physicsBodies[sessionId] !== 'undefined');
      
      if (physicsBodyExists) {
        const body = this.physicsBodies[sessionId];
        const attackBodyExists = (typeof this.attackBodies[sessionId] !== 'undefined');
        
        player.x = (body.x + (PLAYER_BODY.width * PLAYER_BODY.originX));
        player.y = (body.y + (PLAYER_BODY.height * PLAYER_BODY.originY));

        if (attackBodyExists) {
          const atkBody = this.attackBodies[sessionId];
  
          // Attack body originX is 0, so offset full width when flipped
          atkBody.x = ((body.x + (PLAYER_BODY.width * PLAYER_BODY.originX)) + (player.flipX ? -PLAYER_BODY.width : PLAYER_BODY.width / 2));
          atkBody.y = (body.y + (PLAYER_BODY.height * PLAYER_BODY.originY));
        }
      }
    });

    this.state.objects.forEach((obj, objID) => {
      const physicsBodyExists = (typeof this.physicsBodies[objID] !== 'undefined');

      if (physicsBodyExists) {
        const body = this.physicsBodies[objID];
        
        obj.x = (body.x);
        obj.y = (body.y);
      }
    });
  }

  onJoin (client: Client, options: any) {
    console.log(client.sessionId, "joined!");
    this.state.players.set(client.sessionId, new Player(options.playerName, client.sessionId, PLAYER_BODY.width, PLAYER_BODY.height));

    this.physicsBodies[client.sessionId] = this.physics.add.body(arena.room_boundaries['L0'], 0, PLAYER_BODY.width, PLAYER_BODY.height);

    this.attackBodies[client.sessionId] = this.physics.add.body(arena.room_boundaries['L0'] + PLAYER_BODY.width / 2, 0, PLAYER_BODY.width / 2, PLAYER_BODY.height);

    // Add collision detection
    this.playerColliders[client.sessionId] = this.physics.add.collider(this.physicsBodies[client.sessionId], this.physicsMap);
  }

  onLeave (client: Client, consented: boolean) {
    console.log(client.sessionId, "left!");
    this.state.players.delete(client.sessionId);
  }

  onDispose() {
    console.log("room", this.roomId, "disposing...");
  }

}
