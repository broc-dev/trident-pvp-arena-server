import { Room, Client, ServerError } from "colyseus";
import { OpenMatch, LobbyRoomState, ConnectedPlayer } from "./schema/LobbyRoomState";

export class LobbyRoom extends Room<LobbyRoomState> {
  onCreate(options: any) {
    console.log('Lobby up.');

    this.setState(new LobbyRoomState());

    this.onMessage('create-fencing-match', (client, { roomID, creatorName }) => {
      console.log(`Client ${client.sessionId} (${creatorName}) created open match ${roomID}`);

      const newMatch = new OpenMatch(
        roomID,
        creatorName,
        'Fencing PvP'
      );

      newMatch.connectedPlayers.set(client.sessionId, new ConnectedPlayer(true));
      
      this.state.openMatches.set(roomID, newMatch);

      this.broadcast('open-match-add', newMatch)
    });

    this.onMessage('connect-to-any-match', (client) => {
      const keysIterator = this.state.openMatches.keys();
      const firstKey = keysIterator.next().value;
      const openMatch = this.state.openMatches.get(firstKey);

      openMatch.connectedPlayers.set(client.sessionId, new ConnectedPlayer());

      client.send('connect-to-match-room', openMatch.roomID);
    });

    this.onMessage('connect-to-match-by-room-id', (client, roomID) => {
      const openMatch = this.state.openMatches.get(roomID);

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
          
          this.state.openMatches.delete(match.roomID);

          this.broadcast('open-match-remove', match.roomID);
        }
      }

      console.log('----------------------');
    });
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
  }

  onJoin (client: Client, options: any) {
    client.send('open-match-init', this.state.openMatches);
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