import { Schema, ArraySchema, MapSchema, type } from "@colyseus/schema";

export class Message extends Schema {

    // Associate message with player Name
    @type('string')
    author = "";

    // Associate message with specific session IDs
    @type('string')
    authorID = "";

    // Unix Timestamp
    @type('number')
    timestamp = 0;

    @type('string')
    message = "";
}

export class ChatRoomState extends Schema {

    @type([ 'string' ])
    activeParticipants = new ArraySchema<string>();

    // Messages must be identified by player name as a string
    @type([ Message ])
    messages = new ArraySchema<Message>();

}