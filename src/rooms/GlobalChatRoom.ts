import { Room, Client, ServerError } from "colyseus";
import { ChatRoomState, Message } from "./schema/ChatRoomState";

/**
 * The Global Chat Room should be the default room that all players first connect to.
 * Players can chat with any other player through this room.
 * 
 * When the Global Chat Room is initialized, it should pull previous chat history from the database.
 * Players should get a copy of chat history when they join the room.
 * 
 * FEATURES TO ADD:
 * @todo - Add a way to delete chats
 * @todo - Add authentication
 * @todo - Add a way to search chats (by username, message, etc., probably from Firestore)
 * @todo - Add a way to search for players (by username, etc., probably from Firestore)
 * @todo - Firestore integration
 */
export class GlobalChatRoom extends Room<ChatRoomState> {

    // One playerName may have multiple IDs attached to it.
    playerIDtoName: Map<string, string> = new Map();
    adminMessager: string = "Server";

    // Removes < and > from the message
    sanitizeMessage(input: string) {
        // Check for null inputs
        return (input !== null) ? input.replace(/^[<>]+$/g, '') : "";
    }
    
    onCreate(options: any) {
        this.setState(new ChatRoomState());

        // Allow Global Chat room to persist with no players in it
        this.autoDispose = false;

        // @todo Preload past chat history with API call to database

        // @todo Generate playerIDtoName map from Messages in chat history

        // Set participant [0] to be the server
        this.state.activeParticipants[0] = this.adminMessager;

        // Listen for messages from clients
        this.onMessage('chat-message', (client: Client, message: string) => {
            const pName = this.playerIDtoName.get(client.sessionId);
            this.addMessage(pName, client.sessionId, message);
        });

        console.log("Global Chat Room", this.roomId, "created...");
    }

    onJoin(client: Client, options: any) {
        // If the player doesn't exist in activeParticipants, add them.

        // Check that playerName doesn't already exist in room
        this.playerIDtoName.forEach((value, key, map) => {
            if(options.playerName == value)
                return;
        })

        console.log("Player", client.sessionId, "joined the global chat as " + options.playerName);
        // Associate connect client ID with playerName
        this.playerIDtoName.set(client.sessionId, options.playerName);
        // Push the client's player name to the list of participants if it doesn't exist
        this.state.activeParticipants.push(options.playerName);
        
        this.clock.setTimeout(() => {
            this.adminMessage(`${options.playerName} has joined the chat.`);
        }, 750); // Wait 750ms after playerjoin to send 'join' message, some players dont get it if sent too early
    }

    onLeave(client: Client, consented?: boolean): void | Promise<any> {
        // Find the player leaving in the activeParticipants, and remove
        this.state.activeParticipants.deleteAt(this.state.activeParticipants.indexOf(this.playerIDtoName.get(client.sessionId)));

        this.adminMessage(`${this.playerIDtoName.get(client.sessionId)} has left the chat.`);
    }

    /**
     * This method is used to send a message from the admin
     * @param message Message for the server to send
     */
    adminMessage(message: string) {
        this.addMessage(this.adminMessager, "0", message);
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
        messageObj.message = this.sanitizeMessage(message);
        
        this.state.messages.push(messageObj);
    }

    writeStateToDB() {
        // @todo Write changes of chat history to database infrequently (every thirty minutes perhaps)
    }
}