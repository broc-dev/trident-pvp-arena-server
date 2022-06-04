"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ArenaRoom = void 0;
const colyseus_1 = require("colyseus");
const ArenaRoomState_1 = require("./schema/ArenaRoomState");
const arcade_physics_1 = require("arcade-physics");
const PLAYER_BODY = {
    width: 100,
    height: 200
};
const FPS = 60;
const PLAYER_SPEED = 300;
const PLAYER_JUMP_FORCE = 300;
class ArenaRoom extends colyseus_1.Room {
    constructor() {
        super(...arguments);
        this.maxClients = 2;
        this.physicsBodies = {};
        this.physics = null;
        this.physicsTick = 0;
        this.physicsMap = [];
    }
    onCreate(options) {
        this.setState(new ArenaRoomState_1.ArenaRoomState());
        this.onMessage('keyboard-input', (client, input) => {
            const { up, down, left, right } = input;
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
                queueDepthSort: () => { }
            }
        };
        this.physics = new arcade_physics_1.ArcadePhysics(config);
        this.physicsTick = 0;
        // Generate map bodies (TODO, single platform to start)
        this.physicsMap[0] = this.physics.add.staticBody((0 - (2400 / 2)), (300 - (100 / 2)), 2400, 100);
        this.physicsMap[1] = this.physics.add.staticBody((2400 - (2400 / 2)), (200 - (100 / 2)), 2400, 100);
        // Add collision detection in onJoin
        this.setSimulationInterval((deltaTime) => this.update(deltaTime));
        console.log("room", this.roomId, "created...");
    }
    update(deltaTime) {
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
    onJoin(client, options) {
        console.log(client.sessionId, "joined!");
        this.state.players.set(client.sessionId, new ArenaRoomState_1.Player(options.playerName, client.sessionId));
        this.physicsBodies[client.sessionId] = this.physics.add.body(0, 0, PLAYER_BODY.width, PLAYER_BODY.height);
        // Add collision detection
        this.physics.add.collider(this.physicsBodies[client.sessionId], this.physicsMap);
    }
    onLeave(client, consented) {
        console.log(client.sessionId, "left!");
        this.state.players.delete(client.sessionId);
    }
    onDispose() {
        console.log("room", this.roomId, "disposing...");
    }
}
exports.ArenaRoom = ArenaRoom;
