"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ArenaRoomState = exports.Player = exports.AbstractObject = exports.HitboxDebug = void 0;
const schema_1 = require("@colyseus/schema");
class HitboxDebug extends schema_1.Schema {
    constructor(id, x, y, width, height) {
        super();
        this.id = '';
        this.x = 0;
        this.y = 0;
        this.width = 0;
        this.height = 0;
        this.isActive = true;
        this.id = id;
        this.x = x;
        this.y = y;
        this.width = width;
        this.height = height;
    }
}
__decorate([
    schema_1.type('string')
], HitboxDebug.prototype, "id", void 0);
__decorate([
    schema_1.type('number')
], HitboxDebug.prototype, "x", void 0);
__decorate([
    schema_1.type('number')
], HitboxDebug.prototype, "y", void 0);
__decorate([
    schema_1.type('number')
], HitboxDebug.prototype, "width", void 0);
__decorate([
    schema_1.type('number')
], HitboxDebug.prototype, "height", void 0);
__decorate([
    schema_1.type('boolean')
], HitboxDebug.prototype, "isActive", void 0);
exports.HitboxDebug = HitboxDebug;
class AbstractObject extends schema_1.Schema {
    constructor(id, x, y, width, height, originX, originY, texture) {
        super();
        this.id = '';
        this.x = 0;
        this.y = 0;
        this.width = 0;
        this.height = 0;
        this.originX = 0.5;
        this.originY = 0.5;
        this.flipX = false;
        this.texture = '';
        this.isTextureVisible = false;
        this.isActive = true;
        this.id = id;
        this.x = x;
        this.y = y;
        this.width = width;
        this.height = height;
        this.originX = originX;
        this.originY = originY;
        this.texture = texture;
    }
}
__decorate([
    schema_1.type('string')
], AbstractObject.prototype, "id", void 0);
__decorate([
    schema_1.type('number')
], AbstractObject.prototype, "x", void 0);
__decorate([
    schema_1.type('number')
], AbstractObject.prototype, "y", void 0);
__decorate([
    schema_1.type('number')
], AbstractObject.prototype, "width", void 0);
__decorate([
    schema_1.type('number')
], AbstractObject.prototype, "height", void 0);
__decorate([
    schema_1.type('number')
], AbstractObject.prototype, "originX", void 0);
__decorate([
    schema_1.type('number')
], AbstractObject.prototype, "originY", void 0);
__decorate([
    schema_1.type('boolean')
], AbstractObject.prototype, "flipX", void 0);
__decorate([
    schema_1.type('string')
], AbstractObject.prototype, "texture", void 0);
__decorate([
    schema_1.type('boolean')
], AbstractObject.prototype, "isTextureVisible", void 0);
__decorate([
    schema_1.type('boolean')
], AbstractObject.prototype, "isActive", void 0);
exports.AbstractObject = AbstractObject;
class Player extends schema_1.Schema {
    constructor(playerName, id, width, height) {
        super();
        this.x = 0;
        this.y = 0;
        this.width = 0;
        this.height = 0;
        this.anim = 'sword-idle-mid';
        this.animMode = 'loop'; // loop, play-hold, play-once
        this.animNext = ''; // The key of the next anim to chain (when animMode = play-then-loop)
        this.animLock = false;
        this.animPrefix = 'sword';
        this.level = 'mid';
        this.flipX = false;
        this.playerName = '';
        this.id = '';
        this.velX = 0;
        this.isDead = false;
        this.xSwordOffset = 0;
        this.playerName = playerName;
        this.id = id;
        this.width = width;
        this.height = height;
    }
}
__decorate([
    schema_1.type('number')
], Player.prototype, "x", void 0);
__decorate([
    schema_1.type('number')
], Player.prototype, "y", void 0);
__decorate([
    schema_1.type('number')
], Player.prototype, "width", void 0);
__decorate([
    schema_1.type('number')
], Player.prototype, "height", void 0);
__decorate([
    schema_1.type('string')
], Player.prototype, "anim", void 0);
__decorate([
    schema_1.type('string')
], Player.prototype, "animMode", void 0);
__decorate([
    schema_1.type('string')
], Player.prototype, "animNext", void 0);
__decorate([
    schema_1.type('boolean')
], Player.prototype, "animLock", void 0);
__decorate([
    schema_1.type('string')
], Player.prototype, "animPrefix", void 0);
__decorate([
    schema_1.type('string')
], Player.prototype, "level", void 0);
__decorate([
    schema_1.type('boolean')
], Player.prototype, "flipX", void 0);
__decorate([
    schema_1.type('string')
], Player.prototype, "playerName", void 0);
__decorate([
    schema_1.type('string')
], Player.prototype, "id", void 0);
__decorate([
    schema_1.type('number')
], Player.prototype, "velX", void 0);
__decorate([
    schema_1.type('boolean')
], Player.prototype, "isDead", void 0);
__decorate([
    schema_1.type('number')
], Player.prototype, "xSwordOffset", void 0);
exports.Player = Player;
class ArenaRoomState extends schema_1.Schema {
    constructor() {
        super(...arguments);
        this.players = new schema_1.MapSchema();
        this.objects = new schema_1.MapSchema();
        this.hitboxDebug = new schema_1.MapSchema();
    }
}
__decorate([
    schema_1.type({ map: Player })
], ArenaRoomState.prototype, "players", void 0);
__decorate([
    schema_1.type({ map: AbstractObject })
], ArenaRoomState.prototype, "objects", void 0);
__decorate([
    schema_1.type({ map: HitboxDebug })
], ArenaRoomState.prototype, "hitboxDebug", void 0);
exports.ArenaRoomState = ArenaRoomState;
