import { Room, Client } from "colyseus";
import { ArenaRoomState, Player } from "./schema/ArenaRoomState";
import { ArcadePhysics } from 'arcade-physics';
import { Body } from 'arcade-physics/lib/physics/arcade/Body';
import { StaticBody } from "arcade-physics/lib/physics/arcade/StaticBody";

const PLAYER_BODY = {
  width: 100,
  height: 200
};

const FPS = 60;

const PLAYER_SPEED = 300;

const PLAYER_JUMP_FORCE = 300;

export class ArenaRoom extends Room<ArenaRoomState> {

  maxClients: number = 2;
  physicsBodies: Record<string, Body> = {};
  physics: ArcadePhysics = null;
  physicsTick: number = 0;
  physicsMap: Array<StaticBody> = [];

  onCreate (options: any) {
    this.setState(new ArenaRoomState());

    this.onMessage('keyboard-input', (client: Client, input: Record<string, boolean>) => {
      const {up, down, left, right} = input;
      const playerBody = this.physicsBodies[client.sessionId];
      const isGrounded = (playerBody.blocked.down);

      // L/R movement
      if (left) {
        playerBody.setVelocityX(-PLAYER_SPEED);
      }
      else if (right) {
        playerBody.setVelocityX(PLAYER_SPEED);
      }
      else {
        playerBody.setVelocityX(0);
      }

      // Jump
      if (up && isGrounded) {
        playerBody.setVelocityY(-PLAYER_JUMP_FORCE);
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

    // Generate map bodies (TODO, single platform to start)
    this.physicsMap[0] = this.physics.add.staticBody((0 - (2400 / 2)), (300 - (100 / 2)), 2400, 100);
    this.physicsMap[1] = this.physics.add.staticBody((2400 - (2400 / 2)), (200 - (100 / 2)), 2400, 100);

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
        const player = this.state.players.get(sessionId);
        const body = this.physicsBodies[sessionId];
        
        player.x = (body.x + (PLAYER_BODY.width / 2));
        player.y = (body.y + (PLAYER_BODY.height / 2));
      }
    });
  }

  onJoin (client: Client, options: any) {
    console.log(client.sessionId, "joined!");
    this.state.players.set(client.sessionId, new Player(options.playerName, client.sessionId));

    this.physicsBodies[client.sessionId] = this.physics.add.body(0, 0, PLAYER_BODY.width, PLAYER_BODY.height);

    // Add collision detection
    this.physics.add.collider(this.physicsBodies[client.sessionId], this.physicsMap);
  }

  onLeave (client: Client, consented: boolean) {
    console.log(client.sessionId, "left!");
    this.state.players.delete(client.sessionId);
  }

  onDispose() {
    console.log("room", this.roomId, "disposing...");
  }

}
