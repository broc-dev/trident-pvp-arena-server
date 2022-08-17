import { Room, Client, ServerError, matchMaker } from "colyseus";
import { AbstractObject, ArenaRoomState, HitboxDebug, Player } from "./schema/ArenaRoomState";
import { ArcadePhysics } from 'arcade-physics';
import StateMachine from "javascript-state-machine";
import { Body } from 'arcade-physics/lib/physics/arcade/Body';
import { StaticBody } from "arcade-physics/lib/physics/arcade/StaticBody";
import SingularityMap from "../maps/SingularityMap02";
// @ts-ignore
import {v4 as uuidv4} from 'uuid';

import LobbyState from "./LobbyState";

const DEBUG_ENABLED = true; // set to false in production build

const MAP_DATA = SingularityMap;

const PLAYER_BODY = {
  width: 20,
  height: 40,
  originX: 0.5,
  originY: 1
};

const PUNCH_KICK_BODY = {
  width: 30,
  height: 40
};

const PLAYER_BODY_CROUCH_HEIGHT_MODIFIER = 0.4;

const OBJECT_BODIES: Record<string, any> = {
  'sword': {
    width: 26,
    height: 3,
    originX: 0,
    originY: 0.5
  },
  'sword-tip': {
    width: 6,
    height: 3,
    originX: 1,
    originY: 0.5
  },
  'win-obj': {
    width: 50,
    height: 50,
    originX: 0.5,
    originY: 1,
  }
};

const MS_PER_FRAME = 50;

const SWORD_ATTACK_FRAME_XOFFSETS: Array<number> = [
  // 0,
  19,
  19,
  8,
  6,
  4,
  3,
  -1,
  0
];

const PUNCH_ATTACK_FRAME_XOFFSETS: Array<number> = [
  // 0,
  22,
  19,
  9,
  7,
  5,
  3,
  0,
];

const FPS = 60;

const LUNGE_VELOCITY = 15;

const SWORD_BOUNCEBACK = 30;
const SWORD_BOUNCEBACK_DELAY = 100;

const KICK_DOWNWARDS_VELOCITY = 600;
const KICK_BOUNCEBACK_DELAY = 350;

const MAX_SPEED = 360;
const ACCELERATION = 20;

const GRAVITY = 1400;

const PLAYER_JUMP_FORCE = 600;

const THROW_VELOCITY = 700;
const DISARM_VELOCITY = 200;

const ROLL_VELOCITY = 150;
const ROLL_NUM_FRAMES = 6;

// const ROLL_TURN_DELAY = 1250; // The number of MS it takes a player to turn after being rolled past
const ROLL_TURN_DELAY = 8000; // The number of MS it takes a player to turn after being rolled past


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
  winRoomObjs: Body[] = [];
  killCounts: Record<string, number> = {}; // ID => Count
  lastKillerID: string = '';
  playerData: Record<string, Record<string, any>> = {}; // ID => Item => Value
  swordLifespans: Map<string, number> = new Map<string, number>(); // ID => Time
  playerRespawnTimers: Map<string, number> = new Map<string, number>();
  initPlayerData: Record<string, any> = {
    keyPresses: {},
    respawnTimer: 0,
    isInvincible: false,
    isJumpKicking: false,
    isFallenDown: false,
    isKicked: false,
    direction: '',
    isRolling: false,
    willTurn: false,
    isCrouching: false,
    hasInput: false,
  };
  firstPlayerID: string = '';
  secondPlayerID: string = '';

  stateMachinePredicates: Record<string, (player: Player, playerFlags: Record<string, boolean>) => boolean> = {
    // Example:
    // idle: (player: Player) => { ...condition... },
    /**
     * @-+=================================================================================+-@
     * |                                SWORD PREDICATES                                     |
     * @-+=================================================================================+-@
     */
    /**
     * ********* Sword Idle States *********
     */
    swordIdleLow: (player: Player, playerFlags: Record<string, boolean>) => {
      var { hasSword, isAlive, isCrouching, isGrounded } = playerFlags;
      var direction = this.playerData[player.id].direction;
  
      if(!hasSword || !isAlive) return false;
      // If the player is in the mid position, and signals down, reset the 'direction' change and return true for sword change;
      if (direction === 'low' && player.level === 'mid') {
        this.playerData[player.id].direction = '';
        player.level = 'low';
        return true;
      // If the player is crouching and signals up, reset the 'direction' change and return true for sword change;
      } else if(direction === '' && isCrouching && player.level === 'low') {
        return true;
      } else if(isGrounded && player.velX === 0 && player.level === 'low') {
        return true;
      }
    },
    swordIdleMid: (player: Player, playerFlags: Record<string, boolean>) => {
      var { hasSword, isAlive, isCrouching, isGrounded } = playerFlags;
      var direction = this.playerData[player.id].direction;
  
      if(!hasSword || !isAlive) return false;

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
      }  else if(isGrounded && player.velX === 0 && player.level === 'mid') {
        return true;
      }
    },
    swordIdleHigh: (player: Player, playerFlags: Record<string, boolean>) => {
      var { hasSword, isAlive, isCrouching, isGrounded } = playerFlags;
      var direction = this.playerData[player.id].direction;
  
      if(!hasSword || !isAlive) return false;

      // If player signals 'down' and is ready to throw sword, 
      if (direction === 'up' && player.level === 'mid') {
        this.playerData[player.id].direction = '';
        player.level = 'high';
        return true;
      } else if(isGrounded && player.velX === 0 && player.level === 'high') {
        return true;
      }
    },
    /**
     * ********* Sword Attack States *********
     */
    swordAttackLow: (player: Player, playerFlags: Record<string, boolean>) => {
      var { hasSword, isAlive, isAttacking, isGrounded, isCrouching } = playerFlags;
      var direction = this.playerData[player.id].direction;
  
      if(!hasSword || !isAlive || !isGrounded ) return false;
      // If player is attacking, and is grounded, return true for sword attack;
      if(player.level === 'low' && isAttacking) {
        return true;
      }
    },
    swordAttackMid: (player: Player, playerFlags: Record<string, boolean>) => {
      var { hasSword, isAlive, isAttacking, isGrounded, isCrouching } = playerFlags;
      var direction = this.playerData[player.id].direction;
  
      if(!hasSword || !isAlive || !isGrounded ) return false;

      // If player is attacking, and is grounded, return true for sword attack;
      if(player.level === 'mid' && isAttacking) {
        return true;
      }
    },
    swordAttackHigh: (player: Player, playerFlags: Record<string, boolean>) => {
      var { hasSword, isAlive, isAttacking, isGrounded, isCrouching } = playerFlags;
      var direction = this.playerData[player.id].direction;
  
      if(!hasSword || !isAlive || !isGrounded ) return false;

      // If player is attacking, and is grounded, return true for sword attack;
      if(player.level === 'high' && isAttacking) {
        return true;
      }
    },
    swordCurbstomp: (player: Player, playerFlags: Record<string, boolean>) => {
      var { hasSword, isAlive, isAttacking } = playerFlags;
  
      if(!hasSword || !isAlive || this.getOtherPlayerID(player.id) == '') return false;
      
      // If player is attacking, and enemy is laying down, curb stomp that bih
      if(this.playerData[this.getOtherPlayerID(player.id)].isFallenDown && isAttacking) {
        return true;
      }
    },
    swordThrowReady: (player: Player, playerFlags: Record<string, boolean>) => {
      var { hasSword, isAlive, isAttacking, isCrouching } = playerFlags;
      var direction = this.playerData[player.id].direction;
  
      if(!hasSword || !isAlive) return false;
      // If player's sword level is high, he's holding up, and he's not attacking, return true;
      if(player.level === 'high' && direction === 'up' && !isAttacking) {
        return true;
      }
    },
    throw: (player: Player, playerFlags: Record<string, boolean>) => {
      var { hasSword, isAlive, isAttacking, isCrouching } = playerFlags;
      var direction = this.playerData[player.id].direction;
  
      if(!isAlive) return false;
    
      // If player's sword level is high, he's holding up, and he's not attacking, return true;
      if(player.level === 'high' && direction === 'up' && isAttacking) {
        return true;
      }
    },
    /**
     * ********* Sword Movement States *********
     */
    swordForstepLow: (player: Player, playerFlags: Record<string, boolean>) => {
      var { hasSword, isAlive, isAttacking, isCrouching } = playerFlags;
      var direction = this.playerData[player.id].direction;
  
      if(!hasSword || !isAlive) return false;
      // Check if player is facing direction he's moving
      var forstepping = (player.flipX && player.velX < 0) || (!player.flipX && player.velX > 0);
  
      // If player is attacking, and is grounded, return true for sword attack;
      if(player.velX !== 0 && forstepping && Math.abs(player.velX) < MAX_SPEED && player.level === 'low') {
        return true;
      }
    },
    swordForstepMid: (player: Player, playerFlags: Record<string, boolean>) => {
      var { hasSword, isAlive, isAttacking, isCrouching } = playerFlags;
      var direction = this.playerData[player.id].direction;
  
      if(!hasSword || !isAlive) return false;
      // Check if player is facing direction he's moving
      var forstepping = (player.flipX && player.velX < 0) || (!player.flipX && player.velX > 0);
  
      // If player is attacking, and is grounded, return true for sword attack;
      if(player.velX !== 0 && forstepping && Math.abs(player.velX) < MAX_SPEED && player.level === 'mid') {
        return true;
      }
    },
    swordForstepHigh: (player: Player, playerFlags: Record<string, boolean>) => {
      var { hasSword, isAlive, isAttacking, isCrouching } = playerFlags;
      var direction = this.playerData[player.id].direction;
  
      if(!hasSword || !isAlive) return false;
      // Check if player is facing direction he's moving (stepping forward)
      var forstepping = (player.flipX && player.velX < 0) || (!player.flipX && player.velX > 0);
  
      // If player is attacking, and is grounded, return true for sword attack;
      if(player.velX !== 0 && forstepping && Math.abs(player.velX) < MAX_SPEED && player.level === 'high') {
        return true;
      }
    },
    swordBackstepLow: (player: Player, playerFlags: Record<string, boolean>) => {
      var { hasSword, isAlive, isAttacking, isCrouching } = playerFlags;
      var direction = this.playerData[player.id].direction;
  
      if(!hasSword || !isAlive) return false;
      // Check if player is moving opposite direction he's facing (stepping back)
      var backstepping = (player.flipX && player.velX > 0) || (!player.flipX && player.velX < 0);
  
      // If player is attacking, and is grounded, return true for sword attack;
      if(player.velX !== 0 && backstepping && Math.abs(player.velX) === MAX_SPEED && player.level === 'low') {
        return true;
      }
    },
    swordBackstepMid: (player: Player, playerFlags: Record<string, boolean>) => {
      var { hasSword, isAlive, isAttacking, isCrouching } = playerFlags;
      var direction = this.playerData[player.id].direction;
  
      if(!hasSword || !isAlive) return false;
      // Check if player is moving opposite direction he's facing (stepping back)
      var backstepping = (player.flipX && player.velX > 0) || (!player.flipX && player.velX < 0);
  
      // If player is attacking, and is grounded, return true for sword attack;
      if(player.velX !== 0 && backstepping && Math.abs(player.velX) === MAX_SPEED && player.level === 'mid') {
        return true;
      }
    },
    swordBackstepHigh: (player: Player, playerFlags: Record<string, boolean>) => {
      var { hasSword, isAlive, isAttacking, isCrouching } = playerFlags;
      var direction = this.playerData[player.id].direction;
  
      if(!hasSword || !isAlive) return false;
      // Check if player is moving opposite direction he's facing (stepping back)
      var backstepping = (player.flipX && player.velX > 0) || (!player.flipX && player.velX < 0);
  
      // If player is attacking, and is grounded, return true for sword attack;
      if(player.velX !== 0 && backstepping && Math.abs(player.velX) === MAX_SPEED && player.level === 'high') {
        return true;
      }
    },
    swordCartwheel: (player: Player, playerFlags: Record<string, boolean>) => {
      var { hasSword, isAlive, isAttacking, isGrounded, isKicked, isFallen } = playerFlags;
      var direction = this.playerData[player.id].direction;
  
      if(!hasSword || !isAlive) return false;
      
      return (player.velX === MAX_SPEED && hasSword && isGrounded && direction == 'down' && !isAttacking && !isKicked && !isFallen);
    },
    swordRun: (player: Player, playerFlags: Record<string, boolean>) => {
      var { hasSword, isAlive, isAttacking, isRolling, isInputLocked } = playerFlags;
      var direction = this.playerData[player.id].direction;
  
      if(!hasSword || !isAlive || isRolling || isInputLocked || isAttacking) return false;
      
      // Check if player is running
      return (Math.abs(player.velX) === MAX_SPEED);
    },
    swordRolling: (player: Player, playerFlags: Record<string, boolean>) => {
      var { hasSword, isAlive, isRolling, isAttacking, isGrounded, isKicked, isFallen, isInputLocked } = playerFlags;
  
      if(!hasSword || !isAlive) return false;
      
      return (isRolling && hasSword && isGrounded && !isAttacking && !isKicked && !isFallen && !isInputLocked);
    },
    /**
     * ********* Sword Crouch *********
     */
    swordCrouch: (player: Player, playerFlags: Record<string, boolean>) => {
      var { hasSword, isGrounded, isAttacking, isCrouching } = playerFlags;
      return (isGrounded && hasSword && !isAttacking && isCrouching && player.velX === 0);
    },
    swordCrouchWalk: (player: Player, playerFlags: Record<string, boolean>) => {
      var { hasSword, isGrounded, isAttacking, isCrouching } = playerFlags;
      return (isGrounded && hasSword && !isAttacking && isCrouching && player.velX !== 0);
    },
    swordCrouchJump: (player: Player, playerFlags: Record<string, boolean>) => {
      var { hasSword, isGrounded, isAttacking, isCrouching, isJumping } = playerFlags;
      return (isGrounded && hasSword && !isAttacking && isCrouching && isJumping);
    },
    swordCrouchAttack: (player: Player, playerFlags: Record<string, boolean>) => {
      var { hasSword, isGrounded, isAttacking, isCrouching } = playerFlags;
      return (isGrounded && hasSword && isAttacking && isCrouching);
    },
    /**
     * ********* Sword Jump States *********
     */
    swordJump: (player: Player, playerFlags: Record<string, boolean>) => {
      var { hasSword, isGrounded, isAttacking, isCrouching } = playerFlags;
      var direction = this.playerData[player.id].direction;
      // If player is level 'mid', is pressing 'down', and jumping, then return true for crouch jumping
      if(hasSword && player.level === 'mid' && direction === 'down' && player.isJumping) {
        return true;
      }
    },
    swordJumpKick: (player: Player, playerFlags: Record<string, boolean>) => {
      var { hasSword, isGrounded, isAttacking, isCrouching } = playerFlags;
      var direction = this.playerData[player.id].direction;
      // If player is level 'mid', is pressing 'down', and jumping, then return true for crouch jumping
      if(hasSword && player.level === 'mid' && direction === 'down' && player.isJumping) {
        return true;
      }
    },
    /**
     * @-+=================================================================================+-@
     * |                               NO SWORD PREDICATES                                   |
     * @-+=================================================================================+-@
     */
    /**
     * ********* No Sword Idle *********
     */
    noswordIdle: (player: Player, playerFlags: Record<string, boolean>) => {
      var { hasSword, isGrounded, isAttacking, isCrouching, isKicked, isFallen } = playerFlags;
      return (!hasSword && isGrounded && !isKicked && !isFallen && player.velX == 0 && !isAttacking);
    },
    /**
     * ********* No Sword Attack *********
     */
    noswordAttack: (player: Player, playerFlags: Record<string, boolean>) => {
      var { hasSword, isGrounded, isAttacking, isCrouching, isKicked, isFallen } = playerFlags;
      // If player is level 'low', is not pressing 'down', and not attacking, then return true for no sword idle
      return (isGrounded && isAttacking && !hasSword)
    },
    noswordCurbstomp: (player: Player, playerFlags: Record<string, boolean>) => {
      var { hasSword, isGrounded, isAttacking, isCrouching, isKicked, isFallen } = playerFlags;

      if(!hasSword || !isGrounded || this.getOtherPlayerID(player.id) == '') return false;

      // If player is attacking, and enemy is laying down, curb stomp that bih
      if(this.playerData[this.getOtherPlayerID(player.id)].isFallenDown && isAttacking && !hasSword) {
        return true;
      }
    },
    /**
     * ********* No Sword Movement States *********
     */
    noswordBackStep: (player: Player, playerFlags: Record<string, boolean>) => {
      var { hasSword, isGrounded, isAttacking, isCrouching, isKicked, isFallen } = playerFlags;
      // If player is level 'low', is not pressing 'down', and not attacking, then return true for no sword idle
      var backstepping = (player.flipX && player.velX > 0) || (!player.flipX && player.velX < 0);
      
      return (isGrounded && !hasSword && !isAttacking && backstepping);
    },
    noswordForwardStep: (player: Player, playerFlags: Record<string, boolean>) => {
      var { hasSword, isGrounded, isAttacking, isCrouching, isKicked, isFallen } = playerFlags;
      // If player is level 'low', is not pressing 'down', and not attacking, then return true for no sword idle
      var forstepping = (player.flipX && player.velX < 0) || (!player.flipX && player.velX > 0);
      
      return (isGrounded && !hasSword && !isAttacking && forstepping);
    },
    noswordRun: (player: Player, playerFlags: Record<string, boolean>) => {
      var { hasSword, isGrounded, isAttacking, isCrouching, isKicked, isFallen } = playerFlags;
      // If player is level 'low', is not pressing 'down', and not attacking, then return true for no sword idle
      return (isGrounded && !hasSword && player.velX === MAX_SPEED);
    },
    noswordRolling: (player: Player, playerFlags: Record<string, boolean>) => {
      var { hasSword, isGrounded, isAttacking, isRolling, isKicked, isFallen, isInputLocked } = playerFlags;
      return (isRolling && !hasSword && isGrounded && !isAttacking && !isKicked && !isFallen && !isInputLocked);
    },
    noswordCartwheel: (player: Player, playerFlags: Record<string, boolean>) => {
      var { hasSword, isGrounded, isAttacking, isCrouching, isKicked, isFallen } = playerFlags;
      var direction = this.playerData[player.id].direction;
      return (player.velX === MAX_SPEED && hasSword && isGrounded && direction == 'down' && !isAttacking && !isKicked && !isFallen);
    },
    /**
     * ********* No Sword Jump *********
     */
    noswordJump: (player: Player, playerFlags: Record<string, boolean>) => {
      var { hasSword, isGrounded, isAttacking, isJumping } = playerFlags;
      // If player is level 'low', is not pressing 'down', and not attacking, then return true for no sword idle
      return (isGrounded && !hasSword && !isAttacking && isJumping);
    },
    noswordJumpKick: (player: Player, playerFlags: Record<string, boolean>) => {
      var { hasSword, isGrounded, isAttacking, isJumping } = playerFlags;
      // If player is level 'low', is not pressing 'down', and not attacking, then return true for no sword idle
      return (isGrounded && !hasSword && isAttacking && isJumping);
    },
    /**
     * ********* No Sword Crouch *********
     */
    noswordCrouch: (player: Player, playerFlags: Record<string, boolean>) => {
      var { hasSword, isGrounded, isAttacking, isCrouching } = playerFlags;
      return (isGrounded && !hasSword && !isAttacking && isCrouching && player.velX === 0);
    },
    noswordCrouchWalk: (player: Player, playerFlags: Record<string, boolean>) => {
      var { hasSword, isGrounded, isAttacking, isCrouching } = playerFlags;
      return (isGrounded && !hasSword && !isAttacking && isCrouching && player.velX !== 0);
    },
    noswordCrouchJump: (player: Player, playerFlags: Record<string, boolean>) => {
      var { hasSword, isGrounded, isAttacking, isCrouching, isJumping } = playerFlags;
      return (isGrounded && !hasSword && !isAttacking && isCrouching && isJumping);
    },
    noswordCrouchAttack: (player: Player, playerFlags: Record<string, boolean>) => {
      var { hasSword, isGrounded, isAttacking, isCrouching } = playerFlags;
      return (isGrounded && !hasSword && isAttacking && isCrouching);
    },
    noswordCrouchRolling: (player: Player, playerFlags: Record<string, boolean>) => {
      var { hasSword, isGrounded, isAttacking, isRolling, isKicked, isFallen, isInputLocked } = playerFlags;
      return (isRolling && !hasSword && isGrounded && !isAttacking && !isKicked && !isFallen && !isInputLocked);
    },
    /**
     * @-+=================================================================================+-@
     * |                                OTHER PREDICATES                                     |
     * @-+=================================================================================+-@
     */
    layDown: (player: Player, playerFlags: Record<string, boolean>) => {
      var { hasSword, isGrounded, isAttacking, isFallen } = playerFlags;
      return (isGrounded && !hasSword && !isAttacking && isFallen);
    },
    deathStand: (player: Player, playerFlags: Record<string, boolean>) => {
      var { isAlive, isFallen } = playerFlags;
      return (!isAlive && !isFallen);
    },
    deathLay: (player: Player, playerFlags: Record<string, boolean>) => {
      var { isAlive, isFallen } = playerFlags;
      return (!isAlive && isFallen);
    }
  };

  /**
   * Logging utility to quickly investigate player interactions
   * 
   * @param playerID 
   * @returns Neatly formatted & colored string for playerID
   */
  getPlayerTag(playerID: string): string | null {
    var tag = ''
    if(this.playerData[playerID]) {
      tag = "[" + this.state.players.get(playerID).playerName + "]"
    }
    return tag
  }

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
  playerStateChecks(player: Player): Record<string, boolean> {
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

  /**
   * Sanitizes an input string to be used as a player name
   * Player names cannot have special characters other than _ or $.
   * Player names cannot be > 14 characters
   * @param input Player name to sanitize
   * @returns Sanitized player name
   */
  sanitize(input: string): string {
    var output = input.replace(/[^a-zA-Z0-9_$]/g, '');
    if(output.length > 14) {
      output = output.substring(0, 14);
    }
    return output;
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

  createPhysicsBody(id: string, x: number, y: number, width: number, height: number, type: string): Body {
    this.physicsBodies[id] = this.physics.add.body(x, y, width, height);
    // this.physicsBodies[id].setDragX(175);
    
    if (DEBUG_ENABLED) {
      this.state.hitboxDebug.set(id, new HitboxDebug(id, x, y, width, height, type));
    }

    return this.physicsBodies[id];
  }

  getOtherPlayerID(sessionId: string): string {
    let otherPlayerID = '';

    Object.keys(this.physicsBodies).forEach((key) => {
      if (!key.startsWith('sword_') && !key.startsWith('tip_')  && !key.startsWith('punchkick_') && !key.startsWith('winObj') && key !== sessionId) {
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

    if (typeof player !== 'undefined' && !player.isDead && !this.playerData[playerID].isInvincible && !this.gameOver) {
      console.log(`${killerID} [${killer}] killed ${playerID} [${player.playerName}]`);
      this.killCounts[killerID]++;

      // Prevent movement after death
      this.physicsBodies[playerID].setVelocityX(0);

      this.disarmPlayer(playerID, 'down');
  
      // Lock player to "dead state" (will also trigger animation)
      // Verifies that player exists before trying to kill him
      player.isDead = true;

      this.broadcast('update-killcount', {
        playerID: killerID,
        killCount: this.killCounts[killerID]
      });

      // Alert clients that player has been killed
      this.broadcast('player-killed', {
        playerID: playerID,
        isLaying: this.playerData[playerID].isFallenDown,
      });

      // Respawn player in 3 seconds
      this.playerRespawnTimers.set(playerID, 3000);
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

    this.broadcast('player-jumpkick', playerID);

    this.clock.setTimeout(() => {
      if(this.playerData[playerID].isJumpKicking) {
        this.playerData[playerID].isJumpKicking = false;
      }
    }, 5000);
  }

  doRoll(playerID: string) {
    const player = this.state.players.get(playerID);

    this.clock.start();

    player.isInputLocked = true;
    this.playerData[playerID].isRolling = true;
    this.state.players.get(playerID).isRolling = true;

    const dir = (player.flipX ? -1 : 1);

    this.physicsBodies[playerID].setVelocityX(dir * ROLL_VELOCITY);

    this.clock.setTimeout(() => {
      player.isInputLocked = false;
      this.playerData[playerID].isRolling = false;
      this.state.players.get(playerID).isRolling = false;
    }, MS_PER_FRAME * ROLL_NUM_FRAMES);
  }

  doAttack(playerID: string) {
    const player = this.state.players.get(playerID);
    const playerBody = this.physicsBodies[playerID];
    const enemyID = this.getOtherPlayerID(playerID);
    const hasSword = (player.animPrefix === 'sword');
    const {isCrouching} = this.playerData[playerID];

    if(player.isAttacking) return;
    // Start clock 
    this.clock.start();
    
    // Lock input
    player.isInputLocked = true;

    // Set player to 'attacking'
    player.isAttacking = true;

    if (isCrouching) {
      this.clock.setTimeout(() => {
        player.isInputLocked = false;
        player.isAttacking = false;
      }, MS_PER_FRAME * 8); // @todo replace w/ constant
    }
    else {
      // Move in direction of attack
      if (hasSword) {
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
      else {
        // Adjust punch hitbox by mapped xoffset / frame
        let frame = 0;
        const hitboxShiftInterval = this.clock.setInterval(() => {
          player.xPunchOffset = PUNCH_ATTACK_FRAME_XOFFSETS[frame];

          const armIsExtended = ([5, 6].includes(frame));

          if (armIsExtended) {
            const enemyID = this.getOtherPlayerID(playerID);
            const enemyBody = this.physicsBodies[enemyID];
            const playerPunchKickBox = this.physicsBodies[`punchkick_${playerID}`];
            const { isFallenDown: enemyIsFallenDown } = this.playerData[enemyID];
            // Check overlap per frame

            if (!enemyIsFallenDown && this.physics.overlap(playerPunchKickBox, enemyBody, null, null, this)) {
              this.disarmPlayer(enemyID, 'up');
              this.playerFallDown(enemyID);
            }
          }

          frame++;
        }, MS_PER_FRAME);
    
        // Clear after last frame
        this.clock.setTimeout(() => {
          player.xPunchOffset = 0;
          hitboxShiftInterval.clear();
          player.isInputLocked = false;
          player.isAttacking = false;
        }, MS_PER_FRAME * SWORD_ATTACK_FRAME_XOFFSETS.length);
      }
    }
  }

  exitCrouch(playerID: string) {
    this.playerData[playerID].isCrouching = false;
    this.physicsBodies[playerID].setSize(PLAYER_BODY.width, PLAYER_BODY.height);
    this.physicsBodies[playerID].y -= (PLAYER_BODY.height * (1 - PLAYER_BODY_CROUCH_HEIGHT_MODIFIER));
  }

  enterCrouch(playerID: string) {
    this.playerData[playerID].isCrouching = true;
    this.physicsBodies[playerID].setSize(PLAYER_BODY.width, PLAYER_BODY.height * PLAYER_BODY_CROUCH_HEIGHT_MODIFIER);
  }

  onCreate(options: any) {
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
      // Get direction and associated message ID from message data
      const { direction, messageID } = data;

      const {sessionId: playerID} = client;
      const player = this.state.players.get(playerID);
      const playerData = this.playerData[playerID];
      const hasSword = (player.animPrefix === 'sword');

      if (player !== undefined && !player.isDead && hasSword && !playerData.isRolling && !playerData.isJumpKicking && !playerData.isCrouching && !player.isAttacking && !player.isJumping) {
        // Set player's intended direction change to the new direction
        this.playerData[client.sessionId].direction = direction;
        // Get enemy
        const enemyID = this.getOtherPlayerID(playerID);
        const enemy = this.state.players.get(enemyID);
        const hasEnemyWithSword = (enemyID !== '' && enemy.animPrefix === 'sword');

        // Get swords
        const playerSword = this.getAttachedSwordBodies(playerID);
        const enemySword = this.getAttachedSwordBodies(enemyID);
  
        if (direction === 'up') {
          if (player.level === 'low') {
            player.level = 'mid';
            this.broadcast('player-change-level', { messageID: messageID, playerID: playerID, level: 'mid' });
          }
          else if (player.level === 'mid') {
            player.level = 'high';
            this.broadcast('player-change-level', { messageID: messageID, playerID: playerID, level: 'high' });
          }
        }
        else if (direction === 'down') {
          if (player.level === 'high') {

            player.level = 'mid';
            this.broadcast('player-change-level', { messageID: messageID, playerID: playerID, level: 'mid' });
          }
          else if (player.level === 'mid') {

            player.level = 'low';
            this.broadcast('player-change-level', { messageID: messageID, playerID: playerID, level: 'low' });
          }
        }

        // Reposition physics body of sword based on new level
        this.moveAttackBoxes();

        if (hasEnemyWithSword) {
          const areSwordsTouching = this.physics.overlap(playerSword, enemySword, null, null, this);
          
          if (areSwordsTouching) {
            this.disarmPlayer(enemyID, direction);
            this.broadcast('player-disarm', enemyID);
            this.broadcast('camera-flash');
          }
        }
      }
    });

    // Read direct keyboard input from player, move player accordingly
    this.onMessage('keyboard-input', (client: Client, input: Record<string, boolean>) => {
      const { up, left, right, down, attack: doAttack, jump, messageID } = input;

      // No input until checked otherwise.
      this.playerData[client.sessionId].hasInput = false;

      for (var key in input) {
        if(typeof input[key] == 'boolean' && input[key]) {
          this.playerData[client.sessionId].hasInput = true;
          break;
        }
      }
      
      const playerBody = this.physicsBodies[client.sessionId];
      const player = this.state.players.get(client.sessionId);
      const enemyID = this.getOtherPlayerID(client.sessionId);
      const isGrounded = (playerBody.blocked.down);
      const hasSword = (player.animPrefix === 'sword');
      const doResetJumpKick = (this.playerData[client.sessionId].isJumpKicking && isGrounded);

      this.playerData[client.sessionId].keyPresses = input;

      // Reset jumpkick & attack status when they hit the ground
      if (doResetJumpKick) {
        this.state.players.get(client.sessionId).isAttacking = false;
        this.playerData[client.sessionId].isAttacking = false;
        this.playerData[client.sessionId].isJumpKicking = false;
      }
      
      const { isJumpKicking, isFallenDown, isRolling, isCrouching } = this.playerData[client.sessionId];
      
      if (!player.isDead && !player.isInputLocked) {
        // Attack (or throw attack)
        const throwReady = (player.level === 'high' && up && player.velX === 0 && !isJumpKicking);
        const doThrowAttack = (throwReady && doAttack);
  
        if (isGrounded && hasSword && doThrowAttack) {
          const sword = this.getAttachedSword(client.sessionId);
          const swordBody = this.getAttachedSwordBodies(client.sessionId);

          const playerX = (playerBody.x + (PLAYER_BODY.width * PLAYER_BODY.originX));
          const playerY = (playerBody.y + (PLAYER_BODY.height * PLAYER_BODY.originY));

          const flipMod = (player.flipX ? -1 : 1);
          const flipOffset = (player.flipX ? swordBody[0].width : 0);

          // Enable sword texture
          sword[0].isTextureVisible = true;
          sword[1].isTextureVisible = true;

          // Remove sword's attachedTo
          sword[0].attachedTo = '';
          sword[1].attachedTo = '';
  
          // Flip sword according to player
          sword[0].flipX = player.flipX;
          sword[1].flipX = player.flipX;

          // Set sword to lethal
          sword[1].isLethal = true;
          this.state.hitboxDebug.get(sword[1].id).isLethal = true;

          swordBody[0].x = playerX + (8 * flipMod) - flipOffset;
          swordBody[0].y = playerY - 38;
          swordBody[1].x = playerX + (8 * flipMod) - flipOffset;
          swordBody[1].y = playerY - 38;
  
          // Disable gravity when thrown
          swordBody[0].setAllowGravity(false);
          swordBody[1].setAllowGravity(false);
  
          // Add overlap calls w/ other player
          // this.physics.add.overlap(this.physicsBodies[swordID], this.physicsBodies[enemyID], () => {
          //   this.killPlayer(enemyID);
          // });
  
          // Set sword body velocity (*(+/-)1(flipX?))
          swordBody[0].setVelocityX((sword[0].flipX ? -1 : 1) * THROW_VELOCITY);
          swordBody[1].setVelocityX((sword[1].flipX ? -1 : 1) * THROW_VELOCITY);

          this.swordLifespans.set(sword[0].id, 15000); // Begin sword lifespan (15 seconds)
          
          this.state.players.get(client.sessionId).hasSword = false;
          // Set animPrefix to nosword (done in anim code below)
        }
        else if (isGrounded && doAttack) {
          // Do curbstomp
          if(Math.abs(this.physicsBodies[player.id].center.x - this.physicsBodies[enemyID].center.x) < 36
            && this.playerData[enemyID].isFallenDown
            && !this.state.players.get(enemyID).isDead) {
            player.velX = 0;
            playerBody.setVelocityX(0);
            player.isInputLocked = true;
            this.playerData[client.sessionId].isAttacking = true;
            
            this.broadcast('player-curbstomp', { playerID: client.sessionId });
            this.killPlayer(enemyID);

            this.clock.setTimeout(() => {
              this.playerData[client.sessionId].isAttacking = false;
              player.isInputLocked = false;
            }, 650);
          // Trigger win
          // If player attacks on grave, is in win room, and is last killer, he wins.
          } else if(this.physics.overlap(playerBody, this.winRoomObjs, null, null, this)
          && this.lastKillerID == player.id && this.getCurrentRoom(player.id) == this.playerWinRooms[player.id]) {
            this.broadcast('player-curbstomp', { playerID: client.sessionId });
            this.declareWinner(player.id, false);
          } else {
            this.broadcast('player-attack', {
              playerID: client.sessionId,
              hasSword,
              level: player.level,
              isCrouching
            });
  
            player.velX = 0;
            playerBody.setVelocityX(0);
  
            this.doAttack(client.sessionId);
          }
        }
        else if (!isGrounded && doAttack && !isJumpKicking) {
          this.doJumpKick(client.sessionId);
        }
        // Move / Idle / Default animation logic
        else if (!throwReady && !isJumpKicking && !isRolling) {
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
              const {willTurn} = this.playerData[client.sessionId];
              const {isRolling: enemyIsRolling} = this.playerData[enemyID];
              
              if (!enemy.isDead && !willTurn) {
                // Delay turning if enemy is rolling to give enemy a chance to land a punch
                if (enemy.x <= player.x && !player.flipX ) {
                  this.playerData[client.sessionId].willTurn = true;
                  
                  this.clock.setTimeout(() => {
                  player.flipX = true;
                    this.playerData[client.sessionId].willTurn = false;
                  }, (enemyIsRolling ? ROLL_TURN_DELAY : 0));
                }
                else if (enemy.x > player.x && player.flipX) {
                  this.playerData[client.sessionId].willTurn = true;

                  this.clock.setTimeout(() => {
                  player.flipX = false;
                    this.playerData[client.sessionId].willTurn = false;
                  }, (enemyIsRolling ? ROLL_TURN_DELAY : 0));
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
            client.send('player-jump', { messageID, playerID: client.sessionId });
          }

          // Handle rolling and crouching
          if (down && isGrounded) {
            // If running and down is pressed, roll
            if (!isCrouching && Math.abs(player.velX) >= MAX_SPEED) {
              this.doRoll(client.sessionId);
            }
            // If standing still, sword in low level, and down is pressed, crouch
            else if (!isCrouching && player.velX === 0 && player.level === 'low') {
              this.playerData[client.sessionId].isCrouching = true;
              player.anim = `${player.animPrefix}-crouch-idle`;

              this.broadcast('player-crouch', {
                playerID: client.sessionId,
                isCrouching: true
              });
            }
          }
          // If down is released, and they're crouching, stand back up
          else if (!down && isCrouching) {
            this.playerData[client.sessionId].isCrouching = false;
            player.anim = `${player.animPrefix}-idle-low`;

            this.broadcast('player-crouch', {
              playerID: client.sessionId,
              isCrouching: false
            });
          }

          // Pickup sword
          if (down && isGrounded && !hasSword) {
            // Loop over swords and check for overlaps
            this.state.objects.forEach((object) => {
              if (object.id.startsWith('sword_')) {
                const swordTipID = object.id.replace('sword_', 'tip_');
                const swordBody = this.physicsBodies[object.id];
                const swordTipBody = this.physicsBodies[swordTipID];
                const isOnGround = (swordBody.blocked.down);

                if (isOnGround) {
                  const isTouchingSword = this.physics.overlap(playerBody, swordBody, null, null, this);

                  if (isTouchingSword && player.animPrefix !== 'sword') {
                    // Player pickup sword body + tip
                    object.attachedTo = player.id;
                    this.state.objects.get(swordTipID).attachedTo = player.id;

                    // @todo Remove logging
                    console.log(`[${player.playerName}] picked up ${object.id}`);
                    this.broadcast('player-pickup', player.id);
                    object.isTextureVisible = false;
                    swordBody.setAllowGravity(false);
                    swordTipBody.setAllowGravity(false);
                    player.animPrefix = 'sword';

                    player.hasSword = true;
                  }
                }
              }
            });
          }
  
          // Apply velocity for movement
          playerBody.setVelocityX(player.velX);
          this.broadcast('player-move', { messageID, playerID: client.sessionId, velX: player.velX });
        }
  
        // Animation logic
        if (isCrouching) {
          if (isGrounded) {
            player.animMode = 'loop';

            if (player.velX === 0) {
              player.anim = `${player.animPrefix}-crouch-idle`;
            }
            else {
              player.anim = `${player.animPrefix}-crouch-walk`;
            }
          }
          else {
            player.anim = `${player.animPrefix}-crouch-jump`;
          }
        }
        else {
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
            // @todo JUMP ANIM
            player.animMode = 'play-hold';
            player.anim = `${player.animPrefix}-jump`;
          }
        }
      }
      else if (player.isInputLocked) {
        if (isRolling) {
          player.animMode = 'loop';
          player.anim = `${player.animPrefix}-rolling`;
        }
      }
      else if (player.isDead) {
        player.animMode = 'play-hold';
        player.anim = `death-stand`;
      }
    });

    // Listen for player commands
    this.onMessage('server-command', (client: Client, message: any) => {
      const { command } = message;
      console.log(`[SERVER] Receieved "${command}" command from ${client.sessionId} [${this.playerData[client.sessionId].playerName}]`);

      if(command == 'objects') {
        var counter = 1;
        var msg: any[] = ['====== OBJECTS ======'];
        this.state.objects.forEach((object) => {
          msg.push(`[${counter}] ${object.id} [Attached to: ${object.attachedTo}] - X: ${object.x}, Y: ${object.y}`);
          counter++;
        });
        client.send('server-message', msg);
      }
      else if(command == 'players') {
        var counter = 1;
        var msg: any[] = ['====== PLAYERS ======'];
        this.state.players.forEach((player) => {
          msg.push(`[${counter}] ${player.id} [${player.playerName}] - X: ${player.x}, Y: ${player.y}`);
          counter++;
        });
        client.send('server-message', msg);
      }
      else if(command == 'hitboxes') {
        var counter = 1;
        var msg: any[] = [`====== HITBOXES ======`];
        this.state.objects.forEach((object) => {
          msg.push(`[${counter}] ${object.id} - X: ${object.x}, Y: ${object.y}`);
          counter++;
        });
        client.send('server-message', msg);
      }
      else if(command == 'colliders') {
        var msg: any[] = [`====== COLLIDERS ======`];
        var counter = 1;
        this.physics.world.colliders.getActive().forEach((collider) => {
          msg.push(`[${counter}] ${collider.name} ${collider.active}`);
          counter++;
        });
        client.send('server-message', msg);
      }
      else if(command == 'pbodies') {
        var msg: any[] = [`====== PHYSICS BODIES ======`];
        var counter = 1;
        Object.keys(this.physicsBodies).forEach((key) => {
          msg.push(`[${counter}] ${key} - X: ${this.physicsBodies[key].x}, Y: ${this.physicsBodies[key].y}`);
          counter++;
        });
        client.send('server-message', msg);
      }
      else if(command == 'win') {
        this.declareWinner(client.sessionId, false);
      }
    })

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
    this.moveAttackBoxes();
    this.syncStateWithPhysics();
    this.syncHitboxDebug();
    this.watchForRespawnsAndWin();
    this.updatePlayerStates();
    this.watchForFalls();
    this.checkPlayerRespawnTimers(deltaTime);
    this.checkObjectLives(deltaTime);

    // Debugging animations
    // const player = this.state.players.get(this.firstPlayerID);
    
    // if (typeof player !== 'undefined') {
    //   console.log(player.anim);
    // }
  }

  checkPlayerRespawnTimers(d: number) {
    if(typeof this.playerRespawnTimers !== undefined) {
      var keys = [...this.playerRespawnTimers.keys()];
      
      for(var i in keys) {
        var newVal = this.playerRespawnTimers.get(keys[i]) - d;
        this.playerRespawnTimers.set(keys[i], newVal);
        if(newVal <= 0) {
          const player = this.state.players.get(keys[i]);
          const spawnPoint = this.getNextPlayerSpawnPoint(player);
          // Retry if spawn point glitch
          if(typeof spawnPoint.x != undefined)
            this.respawn(keys[i], spawnPoint.x, spawnPoint.y);
        }
      }
    }
  }

  // Remove swords that have lived past their expiry (for swords in air, and on ground)
  checkObjectLives(d: number) {
    if(typeof this.swordLifespans !== undefined) {
      var keys = [...this.swordLifespans.keys()];
      
      for(var i in keys) {
        var newVal = this.swordLifespans.get(keys[i]) - d;
        this.swordLifespans.set(keys[i], newVal);
        if(newVal <= 0) {
          this.swordLifespans.delete(keys[i]);
          this.deleteSword(keys[i]);
        }
        // If we find that a sword in the list has been picked up, remove it from the list
        else if(this.state.objects.get(keys[i]).attachedTo !== '') 
        {
          console.log(`Removing ${keys[i]} from swordLifespans`);
          this.swordLifespans.delete(keys[i]);
        }
      }
    }
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

        const playerSwordBodyOld = this.getAttachedSwordBodies(player.id);
        // Make sure player has sword before trying to affect sword
        if(playerSwordBodyOld !== null) {
          playerSwordBodyOld[0].y = -500;
          playerSwordBodyOld[1].y = -500;
          playerSwordBodyOld[0].setAllowGravity(false);
          playerSwordBodyOld[0].setVelocity(0, 0);
          playerSwordBodyOld[1].setAllowGravity(false);
          playerSwordBodyOld[1].setVelocity(0, 0);
        }
      }
    });
  }

  getCurrentRoom(playerID: string) {
    const {x} = this.state.players.get(playerID);

    let currentRoomName = '';
  
    MAP_DATA.rooms.forEach((r) => {
      const {x: rx, width} = r;
      if (x >= rx && x <= rx + width) {
        currentRoomName = r.name;
      }
    });

    return currentRoomName;
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

      let currentRoomName = this.getCurrentRoom(player.id);

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
        if(typeof spawnPoint != undefined) {
          this.respawn(enemyID, spawnPoint.x, spawnPoint.y);
        } else {
          return;
        }
      }
      // Various checks to make when player changes rooms
      if (playerHasChangedRooms) {
        // Check if any players need to be respawned on player room change. Both players must be alive, otherwise handled above
        // Strip characters from player room name, then compare (e.g. room_L6 > room_L5)
        // @todo remove logging
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
        // if (currentRoomName === this.playerWinRooms[player.id] && this.lastKillerID == player.id) {
        //   console.log(`${player.id} has entered the win room!`);
        //   // Wait 3 seconds, then declare the winner
        //   this.clock.setTimeout(() => {
        //     this.declareWinner(player.id);
        //   }, 3000);
        // }
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

  /**
   * This method moves attached "attack" boxes (like swords) of players.
   */
  moveAttackBoxes() {
    this.state.players.forEach((player, playerID) => {
      const isPlayerHoldingSword = (player.animPrefix === 'sword');
      const sword = this.getAttachedSword(playerID);
      const swordBody = this.getAttachedSwordBodies(playerID);
      const playerBody = this.physicsBodies[playerID];
      const playerX = (playerBody.x + (PLAYER_BODY.width * PLAYER_BODY.originX));
      const playerY = (playerBody.y + (PLAYER_BODY.height * PLAYER_BODY.originY));
      const flipMod = (player.flipX ? -1 : 1);
      
      if (sword[0] !== null && sword[1] !== null) {
        const hitboxDebugBody = this.state.hitboxDebug.get(sword[0].id);
        const hitboxDebugTip = this.state.hitboxDebug.get(sword[1].id);

        hitboxDebugBody.isActive = sword[0].isTextureVisible; // If the texture is visible, it means it's been parried or thrown
        hitboxDebugTip.isActive = sword[1].isTextureVisible;

        if (isPlayerHoldingSword) {
          const player = this.state.players.get(playerID);

          // Set sword tip lethal
          sword[1].isLethal = true;
          this.state.hitboxDebug.get(sword[1].id).isLethal = true;
  
          const isSwordOutAnim = (
            player.anim.startsWith('sword-idle') ||
            player.anim.startsWith('sword-forstep') ||
            player.anim.startsWith('sword-backstep')
          );
  
          sword[0].isActive = isSwordOutAnim;
          hitboxDebugBody.isActive = isSwordOutAnim;
          sword[1].isActive = isSwordOutAnim;
          hitboxDebugTip.isActive = isSwordOutAnim;

          const flipOffset = (player.flipX ? swordBody[0].width : 0);
          const flipTipOffset = (player.flipX ? swordBody[1].width : 0);
  
          if (isSwordOutAnim) {
            // console.log(swordBody[0], swordBody[1]);
            // Sync / offset sword in idle & stepping anims
            // WARNING -- MAGIC NUMBERS INCOMING
            // @todo Update values for sword tip here
            if (player.level === 'low') {
              swordBody[0].x = playerX + (19 * flipMod) - flipOffset;
              swordBody[0].y = playerY - 19;
              swordBody[1].x = playerX + (39 * flipMod) - flipTipOffset;
              swordBody[1].y = playerY - 19;
            }
            else if (player.level === 'mid') {
              swordBody[0].x = playerX + (19 * flipMod) - flipOffset;
              swordBody[0].y = playerY - 27;
              swordBody[1].x = playerX + (39 * flipMod) - flipTipOffset;
              swordBody[1].y = playerY - 27;
            }
            else if (player.level === 'high') {
              swordBody[0].x = playerX + (19 * flipMod) - flipOffset;
              swordBody[0].y = playerY - 36;
              swordBody[1].x = playerX + (39 * flipMod) - flipTipOffset;
              swordBody[1].y = playerY - 36;
            }
  
            // Adjust for additional x offset
            swordBody[0].x += (player.xSwordOffset * flipMod);
            swordBody[1].x += (player.xSwordOffset * flipMod);
          }
          else {
            swordBody[0].x = ((player.xSwordOffset * flipMod) - flipOffset);
            swordBody[1].x = ((player.xSwordOffset * flipMod) - flipTipOffset);
          }
        }
      }

      const playerPunchKickBox = this.physicsBodies[`punchkick_${player.id}`];
      
      playerPunchKickBox.x = playerBody.x;

      if (player.flipX) {
        playerPunchKickBox.x -= PUNCH_KICK_BODY.width;
      }
      else {
        playerPunchKickBox.x += PLAYER_BODY.width;
      }

      playerPunchKickBox.y = playerBody.y;
    });
  }

  updatePlayerStates() {
    this.state.players.forEach((player, playerID) => {
      // Check player state via flag checking method
      const playerFlags = this.playerStateChecks(player);

      for (const t of this.playerData[player.id].stateMachine.transitions()) {
        // Convert 't' in statemachine transitions into corresponding predicte function name
        // Example:
        // 'sword-idle-mid' -> 'swordIdleMid'
        const predicateName = t.substring(0,1) + t.replace(/(\b[a-z](?!\s))/g, (char: string) => {return char.toUpperCase()}).replace(/-/g, '').substring(1);
        // Pass player state to state machine predicates
        if (predicateName in this.stateMachinePredicates && this.stateMachinePredicates[predicateName](player, playerFlags)) {
            // If a predicate condition is met, transition to the next state
            this.playerData[playerID].stateMachine[t]();
            break;
        }
      }
    });
  }

  syncStateWithPhysics() {
    this.state.players.forEach((player, sessionId) => {
      const physicsBodyExists = (typeof this.physicsBodies[sessionId] !== 'undefined');
      const pData = this.playerData[sessionId];
      
      if (physicsBodyExists) {
        const body = this.physicsBodies[sessionId];

        // State checks removed from the keyboard input method
        if(body.touching.down && !player.isDead)
        {
          const hasSword = (player.animPrefix === 'sword');
          // If player still in jumping state and touches ground, take him out
          if(player.isJumping) {
            player.isJumping = false;

            if (pData.isCrouching) {
              player.anim = `${player.animPrefix}-crouch-idle`;
            }
            else {
              player.anim = (hasSword ? `sword-idle-${player.level}` : 'nosword-idle');
            }

            player.isGrounded = true;
          // If the player is on the ground, not giving input, isn't actively rolling or jumpkicking, but is moving still, stop him.
          } else if (!pData.hasInput && Math.abs(player.velX) > 0 && !pData.isRolling && !pData.isJumpKicking) {
            player.velX = 0;
            body.setVelocityX(0);
            if (pData.isCrouching) {
              player.anim = `${player.animPrefix}-crouch-idle`;
            }
            else {
              player.anim = (hasSword ? `sword-idle-${player.level}` : 'nosword-idle');
            }
          // If the player is on the ground and not moving, set him to idle anim
          } else if (Math.abs(player.velX) < 10) {
            if (pData.isCrouching) {
              player.anim = `${player.animPrefix}-crouch-idle`;
            }
            else {
              player.anim = (hasSword ? `sword-idle-${player.level}` : 'nosword-idle');
            }
          }

          // @todo Needs to change when jumping hitbox is implemented
          // body.setSize(PLAYER_BODY.width, PLAYER_BODY.height, false);
          // body.y -= 19;

          body.setOffset(0, 0);
        } else if (!body.touching.down){
          player.isGrounded = false;
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

    // Flip new spawned player to face the enemy
    player.flipX = (this.state.players.get(this.getOtherPlayerID(playerID)).x > x) ? false : true;

    // Check for attached swords. If there is one, destroy it
    if(this.getAttachedSword(playerID)[0] !== null && this.getAttachedSword(playerID)[1] !== null) {
      this.deleteSword(this.getAttachedSword(playerID)[0].id);
    }

    // Make player invincible for a short period of time
    this.playerData[playerID].isInvincible = true;

    // Remove player respawn timer.
    this.playerRespawnTimers.delete(playerID);

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

    this.givePlayerSword(playerID);
    const sword = this.getAttachedSword(playerID);
    this.initSwordOverlaps(sword[0].id);
    console.log(`${this.getPlayerTag(playerID)} respawned with sword ${sword[0].id} | ${sword[1].id}`);

    // console.log(this.physicsBodies[playerID].)

    this.broadcast('player-respawn', playerID);
    // After 1 second, player is no longer invincible
    this.clock.setTimeout(() => {
      this.playerData[playerID].isInvincible = false;
    }, 2000);
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
      var direction = this.playerWinRooms[enemyPlayerID] == 'room_R6' ? 2 : -3;
      // If enemy is *in* win room, you need to spawn behind them.
      if(this.getCurrentRoom(enemyPlayerID) == this.playerWinRooms[enemyPlayerID]) {
        let dir = this.playerWinRooms[enemyPlayerID] == 'room_R6' ? spawnPointsInOrder.length - 1 : 0;
        return spawnPointsInOrder[dir];
      }
      // Find the spawn point directly after current enemy player position
      for (var i = 0; i < spawnPointsInOrder.length; i++) {
        if(spawnPointsInOrder.at(i).x > enemy.x) {
          // Get spawnpoint in correct direction
          // If the next spawnpoint is too close, chose further away one
          // Make sure that the index used is not out of bounds
          if((i + direction) >= 0 && (i + direction) < spawnPointsInOrder.length && i + (2 * direction) < spawnPointsInOrder.length) {
            if(Math.abs(spawnPointsInOrder.at(i + direction).x - enemy.x) < 100) {
              return spawnPointsInOrder.at(i + (2 * direction));
            } else {
              return spawnPointsInOrder.at(i + direction);
            }
          } else {
            return spawnPointsInOrder.at(i);
          }
        }
      }
      // If there's no spawnpoint found, the player is further than the last spawn
      return spawnPointsInOrder[spawnPointsInOrder.length - 1];
    // If there's no last killer, guess which room to spawn in based on the player furthest from the map mid-point
    } else {
      const midPoint = (MAP_DATA.width * MAP_DATA.tile_width) / 2;
      // If enemy is furthest from the map midPoint, set spawn in room to block them
      const direction = (Math.abs(midPoint - player.x) > Math.abs(midPoint - enemy.x)) ? 2 : -3;
      // Find the spawn point directly after current enemy player position
      for (var i = 0; i < spawnPointsInOrder.length; i++) {
        if(spawnPointsInOrder.at(i).x > enemy.x) {
          // Get spawnpoint in correct direction
          return spawnPointsInOrder.at(i + direction);
        }
      }
    }
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

  getAttachedSword(playerID: string): AbstractObject[] {
    let sword = null;
    let swordTip = null;
    
    this.state.objects.forEach((object) => {
      if (object.texture === 'sword' && object.id.includes('sword_') && object.attachedTo === playerID) {
        sword = object;
      }
      if (object.texture === 'sword-tip' && object.id.includes('tip_') && object.attachedTo === playerID) {
        swordTip = object;
      }
    });

    return [sword, swordTip];
  }

  getAttachedSwordBodies(playerID: string): Body[] {

    const sword = this.getAttachedSword(playerID);

    if (sword[0] === null && sword[1] === null) {
      return null;
    }
    else {
      return [this.physicsBodies[sword[0].id], this.physicsBodies[sword[1].id]];
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
    // Tip has same UUID as sword
    const swordTipID = `tip_${swordID.split('_')[1]}`;

    // console.log(swordTipID);
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

    this.state.objects.set(swordTipID, new AbstractObject(
      swordTipID,
      0,
      0,
      OBJECT_BODIES['sword-tip'].width,
      OBJECT_BODIES['sword-tip'].height,
      OBJECT_BODIES['sword-tip'].originX,
      OBJECT_BODIES['sword-tip'].originY,
      'sword-tip',
      playerID,
    ));


    // Add body for sword
    this.createPhysicsBody(
      swordID,
      0,
      0,
      OBJECT_BODIES['sword'].width,
      OBJECT_BODIES['sword'].height,
      'sword'
    );
    this.createPhysicsBody(
      swordTipID,
      0,
      0,
      OBJECT_BODIES['sword-tip'].width,
      OBJECT_BODIES['sword-tip'].height,
      'sword-tip'
    );

    // Disable gravity on the sword body
    this.physicsBodies[swordID].setAllowGravity(false);
    this.physicsBodies[swordTipID].setAllowGravity(false);

    this.state.players.get(playerID).hasSword = true;
  }

  initSwordOverlaps(swordID: string) {
    const sword = this.state.objects.get(swordID);
    const swordTip = this.state.objects.get(`tip_${swordID.split('_')[1]}`);

    const swordBody = this.physicsBodies[swordID];
    const swordTipBody = this.physicsBodies[`tip_${swordID.split('_')[1]}`];

    // Initialize sword touching each player
    this.state.players.forEach((player) => {
      const playerBody = this.physicsBodies[player.id];

      // // Sword Body vs player generic
      // this.physics.add.overlap(swordBody, playerBody, () => {
      //   const swordIsOwnedByPlayer = (sword.attachedTo === player.id);
      //   const {isJumpKicking, isRolling} = this.playerData[player.id];

      //   if (!swordIsOwnedByPlayer && !isJumpKicking && !isRolling) {
      //     const enemyID = this.getOtherPlayerID(player.id);

      //     if (enemyID !== '') {
      //       const swordIsOwnedByEnemy = (sword.attachedTo === enemyID);
      //       const swordIsHot = (swordIsOwnedByEnemy || swordBody.velocity.x !== 0);
      
      //       if (swordIsHot) {
      //         // Sword Body disarms player
      //         if (player.animPrefix === 'sword') {
      //           this.disarmPlayer(player.id, 'up');
      //         }
      //       }
      //     }
      //   }
      // });
      // Sword tip vs player generic
      this.physics.add.overlap(swordTipBody, playerBody, () => {
        const swordIsOwnedByPlayer = (swordTip.attachedTo === player.id);
        const {isJumpKicking, isRolling} = this.playerData[player.id];

        if (!swordIsOwnedByPlayer && !isJumpKicking) {
          const enemyID = this.getOtherPlayerID(player.id);

          if (enemyID !== '') {
            const swordIsThrown = (swordBody.velocity.x !== 0);
            const enemy = this.state.players.get(enemyID);
            const swordIsOwnedByEnemy = (swordTip.attachedTo === enemyID);
            const swordIsHot = (swordIsOwnedByEnemy || swordTipBody.velocity.x !== 0);

            if (isRolling) {
              if (
                swordIsThrown ||
                (swordIsOwnedByEnemy && enemy.level === 'high')
              ) {
                return;
              }
            }
      
            if (swordIsHot) {
              // Sword tip kills player, unless fallen
              if(!this.playerData[player.id].isFallenDown) {
                this.killPlayer(player.id);
              }

              // Cancel roll
              player.isInputLocked = false;
              this.playerData[player.id].isRolling = false;
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
        const otherSwordId = object.id.replace('sword_', 'tip_')
        const otherSwordTipBody = this.physicsBodies[otherSwordId];

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
  
                playerBody.setVelocity(SWORD_BOUNCEBACK * playerDir, -SWORD_BOUNCEBACK * playerDir);
                enemyBody.setVelocity(SWORD_BOUNCEBACK * enemyDir, -SWORD_BOUNCEBACK * enemyDir);
  
                player.isInputLocked = true;
                enemy.isInputLocked = true;
  
                this.clock.setTimeout(() => {
                  playerBody.setVelocityX(0);
                  enemyBody.setVelocityX(0);
                  player.isInputLocked = false;
                  enemy.isInputLocked = false;
                }, SWORD_BOUNCEBACK_DELAY);
              }
            }
            // Handle thrown sword parrying
            else {
              const isSword1Thrown = (sword.attachedTo === '');
              const isSword2Thrown = (object.attachedTo === '');

              if (isSword1Thrown && !isSword2Thrown) {
                if (swordBody.velocity.x !== 0) {
                  swordBody.setVelocity(0, 0);
                  swordBody.setAllowGravity(true);
                  this.physics.add.collider(swordBody, this.physicsMap);
                  swordTipBody.setVelocity(0, 0);
                  swordTipBody.setAllowGravity(true);
                  this.physics.add.collider(swordTipBody, this.physicsMap);
                  this.broadcast('thrown-sword-parry');
                  this.broadcast('camera-flash');
                }
              }
              else if (isSword2Thrown && !isSword1Thrown) {
                
                if (otherSwordBody.velocity.x !== 0) {
                  otherSwordBody.setVelocity(0, 0);
                  otherSwordBody.setAllowGravity(true);
                  this.physics.add.collider(otherSwordBody, this.physicsMap);
                  otherSwordTipBody.setVelocity(0, 0);
                  otherSwordTipBody.setAllowGravity(true);
                  this.physics.add.collider(otherSwordTipBody, this.physicsMap);
                  this.broadcast('thrown-sword-parry');
                  this.broadcast('camera-flash');
                }
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
    // Set player immobilized for 2750ms

    this.broadcast('player-fall-down', playerID);

    this.state.players.get(playerID).isInputLocked = true;
    this.playerData[playerID].isInputLocked = true;
    this.playerData[playerID].isFallenDown = true;

    this.clock.setTimeout(() => {
      this.state.players.get(playerID).isInputLocked = false;
      this.playerData[playerID].isInputLocked = false;
      this.playerData[playerID].isFallenDown = false;
      this.playerData[playerID].isKicked = false;
    }, 2750)
  }

  /**
   * A method that takes the ID of a sword body, and deletes both the sword body and the tip
   * @param swordID sword body ID
   */
  deleteSword(swordID: string) {
    const swordTipID = swordID.replace('sword_', 'tip_');

    if(typeof this.physicsBodies[swordID] !== 'undefined') {

      this.state.objects.get(swordID).attachedTo = '';
      this.state.objects.delete(swordID); // Delete sword from objects
      this.state.hitboxDebug.delete(swordID); // Delete debug hitbox
      this.physicsBodies[swordID].destroy(); // Delete sword physics objects
      // Delete tip
      this.state.objects.get(swordTipID).attachedTo = '';
      this.state.objects.delete(swordTipID); // Delete sword tip from objects
      this.state.hitboxDebug.delete(swordTipID); // Delete tip debug hitbox
      this.physicsBodies[swordTipID].destroy(); // Delete sword tip physics objects
      }
  }

  disarmPlayer(playerID: string, direction: string) {
    const player = this.state.players.get(playerID);
    const sword = this.getAttachedSword(playerID);
    const swordBody = this.getAttachedSwordBodies(playerID);

    if (player.animPrefix === 'sword') {
      // Disarm enemy
      player.animPrefix = 'nosword';
      
      // Set sword texture to active
      sword[0].isTextureVisible = true;
  
      // Set sword so it's no longer attached to enemy
      sword[0].attachedTo = '';
      sword[1].attachedTo = '';
      // Flip sword according to player
      sword[0].flipX = player.flipX;
      sword[1].flipX = player.flipX;

      // Set sword to non-lethal
      sword[1].isLethal = false;

      this.state.hitboxDebug.get(sword[1].id).isLethal = false;
  
      // Set sword body velocity (*(+/-)1(flipX?))
      swordBody[0].setVelocityY((direction === 'up' ? -1 : 1) * DISARM_VELOCITY);
      swordBody[1].setVelocityY((direction === 'up' ? -1 : 1) * DISARM_VELOCITY);
  
      // Enable gravity on sword
      swordBody[0].setAllowGravity(true);
      swordBody[1].setAllowGravity(true);

      this.swordLifespans.set(sword[0].id, 25000); // Begin sword lifespan (25 seconds)
  
      // Add collider w/ map so sword will land
      this.physics.add.collider(swordBody, this.physicsMap);

      this.state.players.get(playerID).hasSword = false;
    }
  }

  onJoin(client: Client, options: any) {
    console.log(client.sessionId, "joined as", options.playerName);

    var stateMachine = StateMachine.create({
      initial: "sword-idle-mid",
      events: [
        { name: "sword-idle-low", from: ["sword-crouch", "sword-idle-mid", "sword-run", "sword-attack-low", "sword-backstep-low", "sword-forstep-low"], to: "sword-idle-low" },
        { name: "sword-idle-mid", from: ["sword-idle-low", "sword-idle-high", "sword-run", "sword-attack-mid", "sword-backstep-mid", "sword-forstep-mid"], to: "sword-idle-mid" },
        { name: "sword-idle-high", from: ["sword-idle-mid", "sword-throw-ready", "sword-run", "sword-attack-high", "sword-backstep-high", "sword-forstep-high"], to: "sword-idle-high" },
        { name: "sword-attack-low", from: ["sword-idle-low", "sword-run"], to: "sword-attack-low" },
        { name: "sword-attack-mid", from: ["sword-idle-mid", "sword-run"], to: "sword-attack-mid" },
        { name: "sword-attack-high", from: ["sword-idle-high", "sword-run"], to: "sword-attack-high" },
        { name: "sword-forstep-low", from: ["sword-idle-low", "sword-forstep-low", "sword-backstep-low", "sword-run"], to: "sword-forstep-low" },
        { name: "sword-forstep-mid", from: ["sword-idle-mid", "sword-forstep-mid", "sword-backstep-mid", "sword-run"], to: "sword-forstep-mid" },
        { name: "sword-forstep-high", from: ["sword-idle-high", "sword-forstep-high", "sword-backstep-high", "sword-run"], to: "sword-forstep-high" },
        { name: "sword-backstep-low", from: ["sword-idle-low", "sword-forstep-low", "sword-backstep-low", "sword-run"], to: "sword-backstep-low" },
        { name: "sword-backstep-mid", from: ["sword-idle-mid", "sword-forstep-mid", "sword-backstep-mid", "sword-run"], to: "sword-backstep-mid" },
        { name: "sword-backstep-high", from: ["sword-idle-high", "sword-forstep-high", "sword-backstep-high", "sword-run"], to: "sword-backstep-high" },
        { name: "sword-crouch", from: ["sword-idle-low", "sword-crouch-jump", "sword-crouch-walk", "sword-crouch-attack", "sword-attack-low"], to: "sword-crouch" },
        { name: "sword-crouch-walk", from: ["sword-crouch"], to: "sword-crouch-walk" },
        { name: "sword-crouch-jump", from: ["sword-crouch", "sword-crouch-walk"], to: "sword-crouch-jump" },
        { name: "sword-jump", from: ["sword-idle-low", "sword-idle-mid", "sword-idle-high", "sword-run", "sword-crouch-jump"], to: "sword-jump" },
        { name: "sword-jumpkick", from: "sword-jump", to: "sword-jumpkick" },
        { name: "sword-curbstomp", from: ["sword-idle-low", "sword-idle-mid", "sword-idle-high", 
          "sword-backstep-low", "sword-backstep-mid", "sword-backstep-high",
          "sword-forstep-low", "sword-forstep-mid", "sword-forstep-high",
          "sword-run"], to: "sword-curbstomp" },
        { name: "sword-cartwheel", from: ["sword-run"], to: "sword-cartwheel" },

        { name: "sword-run", from: ["sword-idle-low", "sword-idle-mid", "sword-idle-high", "sword-forstep-low", "sword-forstep-mid", "sword-forstep-high", "sword-backstep-low", "sword-backstep-mid", "sword-backstep-high", "sword-jumping", "sword-rolling"], to: "sword-run" },
        { name: "sword-throw-ready", from: ["sword-idle-high"], to: "sword-throw-ready" },
        { name: "throw", from: ["sword-throw-ready"], to: "throw" },

        { name: "nosword-idle", from: ["sword-idle-low", "sword-idle-mid", "sword-idle-high", "crouch"] , to: "nosword-idle" },
        { name: "nosword-attack", from: ["nosword-idle", "nosword-run"], to: "nosword-attack" },
        { name: "nosword-run", from: ["nosword-idle"], to: "nosword-run" },
        { name: "nosword-forstep", from: ["nosword-idle"], to: "nosword-forstep" },
        { name: "nosword-backstep", from: ["nosword-idle"], to: "nosword-backstep" },
        { name: "nosword-jump", from: ["nosword-idle", "nosword-run", "nosword-backstep", "nosword-forstep"], to: "nosword-jump" },
        { name: "nosword-jumpkick", from: ["sword-jump"], to: "nosword-jumpkick" },
        { name: "nosword-curbstomp", from: ["nosword-idle", "nosword-attack", "nosword-run", "nosword-forstep", "nosword-backstep"], to: "nosword-curbStomp" },
        { name: "nosword-rolling", from: ["nosword-idle", "nosword-run", "nosword-forstep", "nosword-backstep"], to: "rolling" },
        { name: "nosword-cartwheel", from: ["nosword-run"], to: "nosword-cartwheel" },
        { name: "nosword-crouch", from: ["nosword-idle", "nosword-run", "nosword-forstep", "nosword-backstep", "crouch-walk", "nosword-crouch-attack"], to: "crouch" },
        { name: "nosword-crouch-walk", from: ["crouch", "nosword-crouch-jump"], to: "crouch-walk" },
        { name: "nosword-crouch-jump", from: ["crouch", "crouch-walk"], to: "nosword-crouch-jump" },
        { name: "nosword-crouch-attack", from: ["crouch"], to: "nosword-crouch-attack" },
        { name: "nosword-rolling", from: ["nosword-run"], to: "nosword-rolling" },
        { name: "sword-rolling", from: ["sword-run"], to: "sword-rolling" },
        { name: "lay-down", from: ["*"], to: "lay-down" },

        { name: "death-stand", from: ["*"], to: "death-stand" },
        { name: "death-lay", from: ["*"], to: "death-lay" },
      ],
      callbacks: {
        onenterstate: (event, from, to) => {
          // console.log(`Changed state from ${from} to ${to}`);
        },          
      },
    });

    // Initialize playerData
    this.playerData[client.sessionId] = {
      ...this.initPlayerData,
      stateMachine: stateMachine,
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

    const spawnPoints = MAP_DATA.spawn_points
      .filter((spawn) => spawn.room === 'room_0' && spawn.type === 'initialSpawn');

    const enemyID = this.getOtherPlayerID(client.sessionId);
    let spawnX = null;
    let spawnY = null;

    if (enemyID === '') {
      // We're alone in the room, pick random side of room_0
      
      const spawnPoint = spawnPoints[getRandomInt(0, spawnPoints.length - 1)];

      console.log("PLAYER ONE SPAWN =============");
      console.log(spawnPoint);
      
      spawnX = spawnPoint.x;
      spawnY = spawnPoint.y;

      this.firstPlayerID = client.sessionId;
    }
    else {
      // If the first player's win room is on the RIGHT side, he spawned on the LEFT
      // so, spawn on the RIGHT side (aka LEFT side win room)
      const spawnPoint = (this.playerWinRooms[this.firstPlayerID] == 'room_R6'
        ? spawnPoints[1] : spawnPoints[0]);

      console.log("PLAYER TWO SPAWN =============");
      console.log(spawnPoint);

      spawnX = spawnPoint.x;
      spawnY = spawnPoint.y;

      this.secondPlayerID = client.sessionId;
    }

    // Determine which room player needs to reach to win
    const didSpawnOnLeftSide = (spawnX < MAP_DATA.width * MAP_DATA.tile_width / 2);
    const didSpawnOnRightSide = !didSpawnOnLeftSide;

    if (didSpawnOnLeftSide) {
      this.playerWinRooms[client.sessionId] = this.state.players.get(client.sessionId).winRoom = 'room_R6';
    }
    else if (didSpawnOnRightSide) {
      this.playerWinRooms[client.sessionId] = this.state.players.get(client.sessionId).winRoom = 'room_L6';
    }

    // Add body for player
    var playerBody = this.createPhysicsBody(
      client.sessionId,
      spawnX,
      spawnY,
      PLAYER_BODY.width,
      PLAYER_BODY.height,
      'player'
    );

    playerBody.setDragX(225);

    const playerPunchKickBox = this.createPhysicsBody(
      `punchkick_${client.sessionId}`,
      spawnX,
      spawnY,
      PUNCH_KICK_BODY.width,
      PUNCH_KICK_BODY.height,
      'attack_box'
    );
    playerPunchKickBox.setAllowGravity(false);

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

        // If both players are kicking each other
        if (playerIsJumpKicking && enemyIsJumpKicking) {
          this.disarmPlayer(player.id, 'up');
          this.disarmPlayer(enemy.id, 'up');
          

          player.isInputLocked = true;
          enemy.isInputLocked = true;

          const playerDir = (player.flipX ? 1 : -1);
          const enemyDir = (enemy.flipX ? 1 : -1);
          
          playerBody.setVelocity(playerDir * KICK_DOWNWARDS_VELOCITY, -PLAYER_JUMP_FORCE);
          enemyBody.setVelocity(enemyDir * KICK_DOWNWARDS_VELOCITY, -PLAYER_JUMP_FORCE);

          this.clock.setTimeout(() => {
            player.isInputLocked = false;
            enemy.isInputLocked = false;
          }, KICK_BOUNCEBACK_DELAY);
        }
        else if ((playerIsJumpKicking && !enemy.isFallenDown && !enemy.isDead)
          || (enemyIsJumpKicking && !player.isFallenDown && !player.isDead)) {
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

          const playerADir = (playerA.flipX ? 1 : -1);
          const playerBDir = (playerB.flipX ? 1 : -1);
          
          playerABody.setVelocity(playerADir * (0.3 * KICK_DOWNWARDS_VELOCITY), -(PLAYER_JUMP_FORCE * 0.25));
          playerBBody.setVelocity(playerBDir * (0.5 * KICK_DOWNWARDS_VELOCITY), -(0.35 * PLAYER_JUMP_FORCE));

          this.clock.setTimeout(() => {
            // Reset input lock
            playerA.isInputLocked = false;
            // Reset kicked status
            player.isKicked = false;
            enemy.isKicked = false
          }, KICK_BOUNCEBACK_DELAY);
        }
        // @todo Pls fix
        // // If a player jumps onto another player, they fall down
        // } else if(!playerIsJumpKicking && !enemyIsJumpKicking && !player.isDead && !enemy.isDead && !player.isKicked && !enemy.isKicked) {
        //   // If Enemy jumps on Player's head, knock down player
        //   if(playerBody.touching.up && enemyBody.touching.down) {
        //     this.disarmPlayer(player.id, 'up');
        //     this.playerFallDown(player.id);
        //   }
        // }
      });

      // Create win room Objs
      this.winRoomObjs = [
        this.createPhysicsBody('winObj0', MAP_DATA.win_objects[0].x - 25, MAP_DATA.win_objects[0].y - 50, 50, 50, 'win-obj'),
        this.createPhysicsBody('winObj1', MAP_DATA.win_objects[1].x - 25, MAP_DATA.win_objects[1].y - 50, 50, 50, 'win-obj'),
      ];

      this.state.objects.set('winObj0', new AbstractObject('winObj0', MAP_DATA.win_objects[0].x - 25, MAP_DATA.win_objects[0].y - 50, 50, 50, 0.5, 1, 'win-obj', ''));
      this.state.objects.set('winObj1', new AbstractObject('winObj1', MAP_DATA.win_objects[1].x - 25, MAP_DATA.win_objects[1].y - 50, 50, 50, 0.5, 1, 'win-obj', ''));


      this.physics.add.collider(this.winRoomObjs, this.physicsMap);
    
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
    delete LobbyState.matches[LobbyState.matches.indexOf(this.roomId)];

    try {
      this.shutdownChat();
    } catch (e) {}
  }

  declareWinner(playerID: string, winnerByDefault: boolean = false) {
    this.gameOver = true;1418
    const winningPlayer = this.state.players.get(playerID);

    this.broadcast('game-over', {
      winnerID: playerID,
      winnerName: winningPlayer.playerName,
      winnerByDefault
    });

    this.disconnect();
  }

}
