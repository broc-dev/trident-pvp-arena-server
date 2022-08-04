import { Room, Client, ServerError } from "colyseus";
import { ChatRoomState, Message } from "./schema/ChatRoomState";

/**
 * The Global Chat Room should be the default room that all players first connect to.
 * Players can chat with any other player through this room.
 * 
 * When the Global Chat Room is initialized, it should pull previous chat history from the database.
 * Players should get a copy of chat history when they join the room.
 */
export class CurrentGameChatRoom extends Room<ChatRoomState> {

    // One playerName may have multiple IDs attached to it.
    playerIDtoName: Map<string, string> = new Map();
    adminMessager: string = "Server";
    
    onCreate(options: any) {
        this.setState(new ChatRoomState());

        this.autoDispose = false;

        // Set participant [0] to be the server
        this.state.activeParticipants[0] = this.adminMessager;

        // Listen for messages from clients
        this.onMessage('chat-message', (client: Client, message: string) => {
            const pName = this.playerIDtoName.get(client.sessionId);
            this.addMessage(pName, client.sessionId, message);
        });

        console.log("Current Game Chat Room", this.roomId, "created...");
    }

    onJoin(client: Client, options: any) {
        // If the player doesn't exist in activeParticipants, add them.
        // if(this.state.activeParticipants.find(p => p === this.playerIDtoName.get(client.sessionId)) == undefined) {
        if(this.playerIDtoName.has(client.sessionId) == false) {
            console.log("Player", client.sessionId, "joined the room as " + options.playerName);
            // Associate connect client ID with playerName
            this.playerIDtoName.set(client.sessionId, options.playerName);
            // Push the client's player name to the list of participants if it doesn't exist
            this.state.activeParticipants.push(options.playerName);
            
            this.adminMessage(`${options.playerName} has joined the chat.`);
        } else return; // We can return because the client has already joined and been added
    }

    onLeave(client: Client, consented?: boolean): void | Promise<any> {
        // Find the player leaving in the activeParticipants, and remove
        this.state.activeParticipants.deleteAt(this.state.activeParticipants.indexOf(this.playerIDtoName.get(client.sessionId)));

        this.adminMessage(`${this.playerIDtoName.get(client.sessionId)} has left the room.`);
    }

    /**
     * This method is used to send a message from the admin
     * @param message Message for the server to send
     */
    adminMessage(message: string) {
        this.addMessage(this.adminMessager, "0", message);
    }

    shutdownRoom() {
        // this.writeStateToDB();
        this.disconnect();
    }

    /**
     * This method is used to add a message to the chat history.
     * @param from The participant that sent the message
     * @param message 
     */
    addMessage(fromName: string, fromID: string, message: string) {
        const timestamp = Date.now();
        const messageObj = new Message();
        messageObj.author = fromName;
        messageObj.authorID = fromID;
        messageObj.timestamp = timestamp;
        messageObj.message = message;
        
        this.state.messages.push(messageObj);
    }

    onDispose() {
        console.log(`Chat room ${this.roomId} shutting down...`);
    }

    writeStateToDB() {
        // @todo Write changes of chat history to database infrequently (every thirty minutes perhaps)
    }
}