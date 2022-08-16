import { Room, Client, ServerError } from "colyseus";
import { OpenMatch, LobbyRoomState, ConnectedPlayer } from "./schema/LobbyRoomState";

import SharedState from "./LobbyState";
import LobbyState from "./LobbyState";

export class LobbyRoom extends Room<LobbyRoomState> {
  onCreate(options: any) {
    console.log('[SERVER] Lobby created.');

    // Prevent the lobby from being disposed if there are no players in it.
    this.autoDispose = false;

    this.setState(new LobbyRoomState());

    this.onMessage('create-fencing-match', (client, { roomID, creatorName }) => {
      console.log(`Client ${client.sessionId} (${creatorName}) created open match ${roomID}`);

      const newMatch = new OpenMatch(
        roomID,
        creatorName,
        'Fencing PvP',
        Date.now()
      );

      newMatch.connectedPlayers.set(client.sessionId, new ConnectedPlayer(true));
      
      this.state.openMatches.set(roomID, newMatch);

      this.broadcast('open-match-add', newMatch)
    });

    this.onMessage('connect-to-any-match', (client) => {
      const matches = [...this.state.openMatches.values()];

      for(let i = 0; i < matches.length; i++) {
        if (!matches[i].started) {
          const openMatch = this.state.openMatches.get(matches[i].roomID);
          openMatch.playerCount += 1;
          openMatch.connectedPlayers.set(client.sessionId, new ConnectedPlayer());
          client.send('connect-to-match-room', openMatch.roomID);
        }
      }
    });

    this.onMessage('connect-to-match-by-room-id', (client, roomID) => {
      const openMatch = this.state.openMatches.get(roomID);

      openMatch.playerCount += 1;
      openMatch.connectedPlayers.set(client.sessionId, new ConnectedPlayer());

      client.send('connect-to-match-room', openMatch.roomID);
    });

    this.onMessage('connected-player-ready', (client) => {
      const match = this.getOpenMatchContainingSessionID(client.sessionId);
      console.log('----------------------');
      console.log(match);

      if (match !== null) {
        const thisConnectedPlayer = match.connectedPlayers.get(client.sessionId);
        let allPlayersReady = true;

        thisConnectedPlayer.isClientReady = true;

        match.connectedPlayers.forEach((connectedPlayer: ConnectedPlayer) => {
          if (!connectedPlayer.isClientReady) {
            allPlayersReady = false;
          }
        });

        console.log(allPlayersReady);

        if (allPlayersReady) {
          this.broadcast('launch-match', match.roomID);

          this.broadcast('match-started', match.roomID);
          
          this.state.openMatches.get(match.roomID).started = true;
        }
      }
    });

    this.onMessage('match-finished', (client) => {
      const match = this.getOpenMatchContainingSessionID(client.sessionId);

      try {
        this.state.openMatches.delete(match.roomID);
        this.broadcast('open-match-remove', match.roomID);
      } catch (e) {}
    });

    // Every 15 seconds, check to the lobby state. If a match should close, the roomID will be removed from the lobby state.
    this.setSimulationInterval((delta) => {
      this.state.openMatches.forEach((match) => {
        if(!LobbyState.matches.includes(match.roomID)) {
          console.log(`Match ${match.roomID} has been removed from the lobby.`);
          this.state.openMatches.delete(match.roomID);
        }
      });
    }, 15000);
  }

  onLeave(client: Client, consented: boolean) {
    const playerID = client.sessionId;
    
    const playerMatch = this.getOpenMatchContainingSessionID(playerID);

    if (playerMatch !== null) {
      // It's not null fuck u
      // @ts-ignore
      playerMatch.connectedPlayers.delete(playerID);

      // @ts-ignore
      if (playerMatch.connectedPlayers.size === 0) {
        // @ts-ignore
        this.state.openMatches.delete(playerMatch.roomID);
        // @ts-ignore
        this.broadcast('open-match-remove', playerMatch.roomID);
      }
    }

    this.state.onlinePlayers--;
  }

  onJoin (client: Client, options: any) {
    // client.send('open-match-init', this.state.openMatches);
    this.state.onlinePlayers++;
  }

  onDispose() {
    console.log('Lobby down.');
  }

  getOpenMatchContainingSessionID(sessionID: string): any {
    let playerMatch = null; // Represents the match the player is currently in, if any

    this.state.openMatches.forEach((match) => {
      const playerIsInMatch = (typeof match.connectedPlayers.get(sessionID) !== 'undefined');

      if (playerIsInMatch) {
        playerMatch = match;
      }
    });

    return playerMatch;
  }
}